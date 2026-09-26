import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { LiveLectureStatus } from '@prisma/client';
import { TrackSource } from '@livekit/protocol';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { LiveKitService } from './livekit.service';
import { LiveLecturesService } from './live-lectures.service';

/**
 * Attendance tracking + teacher room controls.
 * Split from the core service to keep both focused and small.
 */
@Injectable()
export class LiveLectureRoomService {
  constructor(
    private readonly core: LiveLecturesService,
    private readonly prisma: PrismaService,
    private readonly livekit: LiveKitService,
    private readonly audit: AuditLogService,
  ) {}

  // ─── Attendance ───────────────────────────────────────────────────

  async getAttendance(lectureId: string, user: AuthenticatedUser) {
    const lecture = await this.core.loadLecture(lectureId);
    await this.core.assertOwnerOrThrow(lecture, user);

    const rows = await this.prisma.liveLectureAttendance.findMany({
      where: { lectureId },
      orderBy: { joinedAt: 'asc' },
      include: {
        student: { select: { userId: true, fullName: true, photoUrl: true } },
      },
    });

    return {
      totalStudents: rows.length,
      attendances: rows.map((r) => ({
        id: r.id,
        studentUserId: r.student.userId,
        studentName: r.student.fullName,
        photoUrl: r.student.photoUrl,
        joinedAt: r.joinedAt,
        leftAt: r.leftAt,
        durationSeconds: r.durationSeconds,
        isOnline: !r.leftAt,
      })),
    };
  }

  /** Upsert — reconnects reopen the same row (no duplicates ever). */
  async markJoin(lectureId: string, userId: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const now = new Date();
    await this.prisma.liveLectureAttendance.upsert({
      where: { lectureId_studentId: { lectureId, studentId: student.id } },
      create: { lectureId, studentId: student.id, joinedAt: now, lastJoinedAt: now, leftAt: null },
      update: { lastJoinedAt: now, leftAt: null },
    });
    return { message: 'Joined.' };
  }

  async markLeave(lectureId: string, userId: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!student) return { message: 'Nothing to update.' };

    const row = await this.prisma.liveLectureAttendance.findUnique({
      where: { lectureId_studentId: { lectureId, studentId: student.id } },
    });
    if (!row || row.leftAt) return { message: 'Nothing to update.' };

    await this.closeRow(row.id, row.lastJoinedAt, row.durationSeconds);
    return { message: 'Left.' };
  }

  // ─── Teacher Room Controls ────────────────────────────────────────

  async muteParticipant(lectureId: string, identity: string, actor: AuthenticatedUser) {
    const lecture = await this.assertLiveOwner(lectureId, actor);
    if (identity === actor.id) throw new BadRequestException('You cannot mute yourself.');

    // Revoke publishing entirely (canPublish:false) but PRESERVE the list of
    // already-granted sources so re-granting one source later doesn't silently
    // resurrect or erase the others.
    await this.livekit
      .updateParticipantPermissions(lecture.roomName, identity, {
        canPublish: false,
      })
      .catch(() => undefined);
    await this.livekit.muteParticipant(lecture.roomName, identity);
    void this.audit.log({
      userId: actor.id,
      action: 'PARTICIPANT_MUTED',
      entity: 'LiveLecture',
      entityId: lectureId,
      metadata: { participantIdentity: identity },
    });
    return { message: 'Participant muted.' };
  }

  async removeParticipant(lectureId: string, identity: string, actor: AuthenticatedUser) {
    const lecture = await this.core.loadLecture(lectureId);
    await this.core.assertOwnerOrThrow(lecture, actor);
    if (identity === actor.id) throw new BadRequestException('You cannot remove yourself.');

    await this.livekit.removeParticipant(lecture.roomName, identity);
    void this.audit.log({
      userId: actor.id,
      action: 'PARTICIPANT_REMOVED',
      entity: 'LiveLecture',
      entityId: lectureId,
      metadata: { participantIdentity: identity },
    });
    return { message: 'Participant removed.' };
  }

  async allowSpeaking(lectureId: string, identity: string, actor: AuthenticatedUser) {
    return this.setPublishPermission(lectureId, identity, 'microphone', true, actor);
  }

  /**
   * Grant or revoke a single publish source (microphone / camera / screen)
   * for a participant. Sources are additive — granting the camera keeps an
   * already-granted microphone intact.
   */
  async setPublishPermission(
    lectureId: string,
    identity: string,
    source: 'microphone' | 'camera' | 'screen',
    granted: boolean,
    actor: AuthenticatedUser,
  ) {
    const lecture = await this.assertLiveOwner(lectureId, actor);

    const trackSource =
      source === 'camera'
        ? TrackSource.CAMERA
        : source === 'screen'
          ? TrackSource.SCREEN_SHARE
          : TrackSource.MICROPHONE;

    if (granted) {
      await this.livekit.grantPublishSource(lecture.roomName, identity, trackSource);
    } else {
      await this.livekit.revokePublishSource(lecture.roomName, identity, trackSource);
    }

    void this.audit.log({
      userId: actor.id,
      action: granted ? 'PARTICIPANT_PUBLISH_GRANTED' : 'PARTICIPANT_PUBLISH_REVOKED',
      entity: 'LiveLecture',
      entityId: lectureId,
      metadata: { participantIdentity: identity, source },
    });
    return { message: granted ? `Publish permission (${source}) granted.` : `Publish permission (${source}) revoked.` };
  }

  async muteAll(lectureId: string, actor: AuthenticatedUser) {
    const lecture = await this.assertLiveOwner(lectureId, actor);

    const participants = await this.livekit.listParticipants(lecture.roomName);
    const targets = participants.filter((p) => p.identity !== actor.id);
    await Promise.all(
      targets.map((p) =>
        this.livekit.muteParticipant(lecture.roomName, p.identity).catch(() => undefined),
      ),
    );
    void this.audit.log({
      userId: actor.id,
      action: 'MUTE_ALL',
      entity: 'LiveLecture',
      entityId: lectureId,
      metadata: { affected: targets.length },
    });
    return { message: 'All participants muted.' };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private async assertLiveOwner(lectureId: string, actor: AuthenticatedUser) {
    const lecture = await this.core.loadLecture(lectureId);
    await this.core.assertOwnerOrThrow(lecture, actor);
    if (lecture.status !== LiveLectureStatus.LIVE) {
      throw new ConflictException('The lecture is not live.');
    }
    return lecture;
  }

  private async closeRow(rowId: string, lastJoinedAt: Date, previousDuration: number) {
    const now = new Date();
    const sessionSeconds = Math.max(0, Math.floor((now.getTime() - lastJoinedAt.getTime()) / 1000));
    await this.prisma.liveLectureAttendance.update({
      where: { id: rowId },
      data: { leftAt: now, durationSeconds: previousDuration + sessionSeconds },
    });
  }
}
