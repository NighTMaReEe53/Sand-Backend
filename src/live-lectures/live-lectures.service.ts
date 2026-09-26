import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentStatus, LiveLectureStatus, Prisma, Role } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../shared/prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit/audit-log.service';
import { LiveKitService } from './livekit.service';
import { CreateLiveLectureDto } from './dto/create-live-lecture.dto';
import { UpdateLiveLectureDto } from './dto/update-live-lecture.dto';

export const LECTURE_INCLUDE = {
  course: {
    select: { id: true, title: true, subject: true, thumbnailUrl: true },
  },
  teacher: {
    select: { id: true, fullName: true, photoUrl: true, specialization: true },
  },
  _count: { select: { attendances: true } },
} satisfies Prisma.LiveLectureInclude;

@Injectable()
export class LiveLecturesService {
  private readonly logger = new Logger(LiveLecturesService.name);

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly livekit: LiveKitService,
    protected readonly notifications: NotificationsService,
    protected readonly audit: AuditLogService,
  ) {}

  // ─── Teacher CRUD & Lifecycle ─────────────────────────────────────

  async create(user: AuthenticatedUser, dto: CreateLiveLectureDto) {
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId: user.id },
    });
    if (!teacher) throw new ForbiddenException('Teacher profile not found.');

    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
      select: { id: true, title: true, teacherId: true, isDeleted: true },
    });
    if (!course || course.isDeleted) throw new NotFoundException('Course not found.');
    if (course.teacherId !== teacher.id) {
      throw new ForbiddenException('You can only schedule lectures for your own courses.');
    }

    const scheduledAt = new Date(dto.scheduledAt);
    const lecture = await this.prisma.liveLecture.create({
      data: {
        courseId: course.id,
        teacherId: teacher.id,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        scheduledAt,
        roomName: `lecture_${crypto.randomUUID()}`,
      },
      include: LECTURE_INCLUDE,
    });

    void this.audit.log({
      userId: user.id,
      action: 'LECTURE_CREATED',
      entity: 'LiveLecture',
      entityId: lecture.id,
      metadata: { courseId: course.id, scheduledAt },
    });

    this.notifications.notifyEnrolledStudents(course.id, {
      type: 'LIVE_LECTURE_NEW',
      title: 'محاضرة مباشرة جديدة',
      body: `محاضرة مباشرة "${lecture.title}" في كورس ${course.title} — ${scheduledAt.toLocaleString('ar-EG')}.`,
      linkUrl: `/live-lectures/${lecture.id}`,
    });

    return lecture;
  }

  async getById(id: string, user: AuthenticatedUser) {
    const lecture = await this.loadLecture(id);

    const isOwner = await this.isLectureOwner(lecture, user);
    if (!isOwner && user.role === Role.STUDENT) {
      const enrolled = await this.isActiveEnrolledStudent(lecture.courseId, user.id);
      if (!enrolled) throw new ForbiddenException('You are not enrolled in this course.');
    } else if (!isOwner) {
      throw new ForbiddenException('You do not have access to this lecture.');
    }

    return lecture;
  }

  async update(id: string, user: AuthenticatedUser, dto: UpdateLiveLectureDto) {
    const lecture = await this.loadLecture(id);
    await this.assertOwnerOrThrow(lecture, user);

    if (lecture.status !== LiveLectureStatus.SCHEDULED) {
      throw new ConflictException('Only scheduled lectures can be edited.');
    }

    const updated = await this.prisma.liveLecture.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.description !== undefined && { description: dto.description.trim() || null }),
        ...(dto.scheduledAt !== undefined && { scheduledAt: new Date(dto.scheduledAt) }),
      },
      include: LECTURE_INCLUDE,
    });

    void this.audit.log({
      userId: user.id,
      action: 'LECTURE_UPDATED',
      entity: 'LiveLecture',
      entityId: id,
      metadata: { fields: Object.keys(dto) },
    });

    return updated;
  }

  /** Soft delete — keeps attendance history intact. */
  async remove(id: string, user: AuthenticatedUser) {
    const lecture = await this.loadLecture(id);
    await this.assertOwnerOrThrow(lecture, user);

    if (lecture.status === LiveLectureStatus.LIVE) {
      throw new ConflictException('Cannot delete a lecture while it is live. End it first.');
    }

    await this.prisma.liveLecture.update({
      where: { id },
      data: { isDeleted: true, status: LiveLectureStatus.CANCELLED },
    });

    void this.audit.log({
      userId: user.id,
      action: 'LECTURE_CANCELLED',
      entity: 'LiveLecture',
      entityId: id,
      metadata: { via: 'DELETE' },
    });

    // NOTE: silent delete — no notification is sent to students.
    return { message: 'Lecture deleted.' };
  }

  async start(id: string, user: AuthenticatedUser) {
    const lecture = await this.loadLecture(id);
    await this.assertOwnerOrThrow(lecture, user);
    this.assertTransition(lecture.status, LiveLectureStatus.LIVE);

    const updated = await this.prisma.liveLecture.update({
      where: { id },
      data: { status: LiveLectureStatus.LIVE, startedAt: new Date() },
      include: LECTURE_INCLUDE,
    });

    void this.audit.log({
      userId: user.id,
      action: 'LECTURE_STARTED',
      entity: 'LiveLecture',
      entityId: id,
    });

    this.notifications.notifyEnrolledStudents(lecture.courseId, {
      type: 'LIVE_LECTURE_STARTED',
      title: 'المحاضرة بدأت الآن 🔴',
      body: `محاضرة "${lecture.title}" بدأت الآن — انضم سريعاً!`,
      linkUrl: `/live-lectures/${id}`,
    });

    return updated;
  }

  async end(id: string, user: AuthenticatedUser) {
    const lecture = await this.loadLecture(id);
    await this.assertOwnerOrThrow(lecture, user);
    this.assertTransition(lecture.status, LiveLectureStatus.ENDED);

    const endedAt = new Date();
    const updated = await this.prisma.liveLecture.update({
      where: { id },
      data: { status: LiveLectureStatus.ENDED, endedAt },
      include: LECTURE_INCLUDE,
    });

    // Force-close still-open attendance rows
    await this.closeOpenAttendances(id, endedAt);

    // Kick every connected participant out of the LiveKit room immediately
    await this.livekit.deleteRoom(lecture.roomName);

    // Notify enrolled students that the lecture has ended
    this.notifyEnded(lecture.courseId, lecture.title, id);

    void this.audit.log({
      userId: user.id,
      action: 'LECTURE_ENDED',
      entity: 'LiveLecture',
      entityId: id,
    });

    return updated;
  }

  async cancel(id: string, user: AuthenticatedUser) {
    const lecture = await this.loadLecture(id);
    await this.assertOwnerOrThrow(lecture, user);
    this.assertTransition(lecture.status, LiveLectureStatus.CANCELLED);

    const updated = await this.prisma.liveLecture.update({
      where: { id },
      data: { status: LiveLectureStatus.CANCELLED },
      include: LECTURE_INCLUDE,
    });

    // If it was live, disconnect everyone right away
    if (lecture.status === LiveLectureStatus.LIVE) {
      await this.livekit.deleteRoom(lecture.roomName);
    }

    void this.audit.log({
      userId: user.id,
      action: 'LECTURE_CANCELLED',
      entity: 'LiveLecture',
      entityId: id,
    });

    this.notifyCancelled(lecture.courseId, lecture.title, id);
    return updated;
  }

  // ─── Join & Token ─────────────────────────────────────────────────

  /**
   * Server-side authorization chain per plan §5.
   * The frontend never sends a role and never receives anything but a
   * short-lived token scoped to its real identity.
   */
  async join(id: string, user: AuthenticatedUser) {
    const lecture = await this.loadLecture(id);
    const isOwner = await this.isLectureOwner(lecture, user);

    let displayName = 'مستخدم';
    if (isOwner) {
      const teacher = await this.prisma.teacherProfile.findUnique({
        where: { userId: user.id },
        select: { fullName: true },
      });
      displayName = teacher?.fullName || 'المعلم';
    } else if (user.role === Role.STUDENT) {
      const student = await this.isActiveEnrolledStudentWithProfile(lecture.courseId, user.id);
      if (!student) {
        throw new ForbiddenException('You must be actively enrolled in this course to join.');
      }
      displayName = student.fullName;
    } else {
      throw new ForbiddenException('You do not have access to this lecture.');
    }

    if (lecture.status === LiveLectureStatus.SCHEDULED) {
      // Lobby state — no token until the teacher starts the lecture
      return { lobby: true, status: lecture.status, lecture };
    }
    if (lecture.status !== LiveLectureStatus.LIVE) {
      throw new ConflictException('This lecture is no longer available.');
    }

    const isHost = isOwner;
    const { token, identity } = await this.livekit.generateToken({
      identity: user.id,
      name: displayName,
      roomName: lecture.roomName,
      canPublish: isHost,
      canSubscribe: true,
      roomAdmin: isHost,
    });

    // Attendance side-effect (students only) — fire-and-forget
    if (user.role === Role.STUDENT) {
      void this.upsertAttendanceJoin(id, user.id).catch((err) =>
        this.logger.warn(`attendance join failed: ${String(err)}`),
      );
    }

    return {
      lobby: false,
      status: lecture.status,
      serverUrl: this.serverUrl,
      roomName: lecture.roomName,
      token,
      identity,
      role: isHost ? 'HOST' : 'AUDIENCE',
    };
  }

  // ─── Listings ─────────────────────────────────────────────────────

  async getStudentUpcoming(user: AuthenticatedUser) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!student) return [];

    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
      select: { courseId: true },
    });
    if (enrollments.length === 0) return [];

    return this.prisma.liveLecture.findMany({
      where: {
        isDeleted: false,
        courseId: { in: enrollments.map((e) => e.courseId) },
        status: { in: [LiveLectureStatus.SCHEDULED, LiveLectureStatus.LIVE] },
      },
      orderBy: [{ status: 'desc' }, { scheduledAt: 'asc' }], // LIVE lectures first
      include: LECTURE_INCLUDE,
    });
  }

  async getTeacherUpcoming(user: AuthenticatedUser) {
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!teacher) return [];

    return this.prisma.liveLecture.findMany({
      where: {
        isDeleted: false,
        teacherId: teacher.id,
        status: { in: [LiveLectureStatus.SCHEDULED, LiveLectureStatus.LIVE] },
      },
      orderBy: [{ status: 'desc' }, { scheduledAt: 'asc' }],
      include: LECTURE_INCLUDE,
    });
  }

  async getTeacherHistory(user: AuthenticatedUser) {
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!teacher) return [];

    return this.prisma.liveLecture.findMany({
      where: {
        isDeleted: false,
        teacherId: teacher.id,
        status: { in: [LiveLectureStatus.ENDED, LiveLectureStatus.CANCELLED] },
      },
      orderBy: { scheduledAt: 'desc' },
      take: 50,
      include: LECTURE_INCLUDE,
    });
  }

  // ─── Helpers (shared with participants/attendance service) ────────

  async loadLecture(id: string) {
    const lecture = await this.prisma.liveLecture.findUnique({
      where: { id },
      include: LECTURE_INCLUDE,
    });
    if (!lecture || lecture.isDeleted) {
      throw new NotFoundException('Lecture not found.');
    }
    return lecture;
  }

  async isLectureOwner(lecture: { teacherId: string }, user: AuthenticatedUser): Promise<boolean> {
    if (user.role === Role.ADMIN) return true;
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    return Boolean(teacher && lecture.teacherId === teacher.id);
  }

  async assertOwnerOrThrow(lecture: { teacherId: string }, user: AuthenticatedUser) {
    const owner = await this.isLectureOwner(lecture, user);
    if (!owner) throw new ForbiddenException('Only the lecture owner can perform this action.');
  }

  get serverUrl(): string {
    return this.livekit.publicServerUrl;
  }

  /** Upsert — reconnects reopen the same row (no duplicates ever). */
  private async upsertAttendanceJoin(lectureId: string, userId: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!student) return;

    const now = new Date();
    await this.prisma.liveLectureAttendance.upsert({
      where: { lectureId_studentId: { lectureId, studentId: student.id } },
      create: { lectureId, studentId: student.id, joinedAt: now, lastJoinedAt: now, leftAt: null },
      update: { lastJoinedAt: now, leftAt: null },
    });
  }

  private notifyCancelled(courseId: string, title: string, lectureId: string) {
    this.notifications.notifyEnrolledStudents(courseId, {
      type: 'LIVE_LECTURE_CANCELLED',
      title: 'إلغاء محاضرة',
      body: `تم إلغاء المحاضرة المباشرة "${title}".`,
      linkUrl: `/live-lectures/${lectureId}`,
    });
  }

  private notifyEnded(courseId: string, title: string, lectureId: string) {
    this.notifications.notifyEnrolledStudents(courseId, {
      type: 'LIVE_LECTURE_ENDED',
      title: 'انتهت المحاضرة',
      body: `انتهت المحاضرة المباشرة "${title}" — شكراً لحضورك!`,
      linkUrl: `/live-lectures/${lectureId}`,
    });
  }

  /** Strict state machine — only legal transitions pass. */
  private assertTransition(current: LiveLectureStatus, target: LiveLectureStatus) {
    const allowed: Record<LiveLectureStatus, LiveLectureStatus[]> = {
      SCHEDULED: [LiveLectureStatus.LIVE, LiveLectureStatus.CANCELLED],
      LIVE: [LiveLectureStatus.ENDED],
      ENDED: [],
      CANCELLED: [],
    };
    if (!allowed[current].includes(target)) {
      throw new ConflictException(
        `Invalid transition: cannot move a ${current} lecture to ${target}.`,
      );
    }
  }

  private async isActiveEnrolledStudent(courseId: string, userId: string): Promise<boolean> {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!student) return false;
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId: student.id, courseId, status: EnrollmentStatus.ACTIVE },
      select: { id: true },
    });
    return Boolean(enrollment);
  }

  private async isActiveEnrolledStudentWithProfile(courseId: string, userId: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true, fullName: true },
    });
    if (!student) return null;
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId: student.id, courseId, status: EnrollmentStatus.ACTIVE },
      select: { id: true },
    });
    return enrollment ? student : null;
  }

  private async closeOpenAttendances(lectureId: string, endedAt: Date) {
    try {
      const open = await this.prisma.liveLectureAttendance.findMany({
        where: { lectureId, leftAt: null },
      });
      await Promise.all(
        open.map((row) => {
          const sessionSeconds = Math.max(
            0,
            Math.floor((endedAt.getTime() - row.lastJoinedAt.getTime()) / 1000),
          );
          return this.prisma.liveLectureAttendance.update({
            where: { id: row.id },
            data: { leftAt: endedAt, durationSeconds: row.durationSeconds + sessionSeconds },
          });
        }),
      );
    } catch (err) {
      this.logger.error(`closeOpenAttendances failed for ${lectureId}: ${String(err)}`);
    }
  }
}
