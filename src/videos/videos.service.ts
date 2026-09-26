import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { UpsertCourseVideoDto } from './dtos/upsert-course-video.dto';

interface AuthUser {
  id: string;
  role: Role;
}

@Injectable()
export class VideosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the teacher profile for the current user.
   */
  private async getTeacherProfile(userId: string) {
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId },
    });
    if (!teacher) throw new ForbiddenException('Teacher profile not found.');
    return teacher;
  }

  /**
   * Verify the course exists and is owned by the given teacher (admins bypass).
   */
  private async assertCourseOwnership(courseId: string, user: AuthUser) {
    if (user.role === Role.ADMIN) return;

    const teacher = await this.getTeacherProfile(user.id);
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, teacherId: teacher.id, isDeleted: false },
      select: { id: true },
    });
    if (!course) {
      throw new ForbiddenException('You do not own this course.');
    }
  }

  // ─── Endpoints ─────────────────────────────────────────────────

  /** POST /courses/:courseId/video — create or replace the course video (owner only). */
  async upsertVideo(
    courseId: string,
    dto: UpsertCourseVideoDto,
    user: AuthUser,
  ) {
    await this.assertCourseOwnership(courseId, user);

    const video = await this.prisma.courseVideo.upsert({
      where: { courseId },
      create: {
        courseId,
        teacherId: (
          await this.prisma.course.findUniqueOrThrow({
            where: { id: courseId },
            select: { teacherId: true },
          })
        ).teacherId,
        videoUrl: dto.videoUrl.trim(),
        title: dto.title?.trim() || null,
      },
      update: {
        videoUrl: dto.videoUrl.trim(),
        title: dto.title?.trim() || null,
      },
    });

    return { message: 'Course video saved successfully.', video };
  }

  /** GET /courses/:courseId/video — PUBLIC free preview, visible to everyone. */
  async getVideo(courseId: string) {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, isDeleted: false },
      select: { id: true },
    });
    if (!course) throw new NotFoundException('Course not found.');

    const video = await this.prisma.courseVideo.findUnique({
      where: { courseId },
    });
    return { video: video ?? null };
  }

  /** DELETE /courses/:courseId/video — owner teacher or admin only. */
  async deleteVideo(courseId: string, user: AuthUser) {
    await this.assertCourseOwnership(courseId, user);

    const existing = await this.prisma.courseVideo.findUnique({
      where: { courseId },
    });
    if (!existing) throw new NotFoundException('No video set for this course.');

    await this.prisma.courseVideo.delete({ where: { courseId } });
    return { message: 'Course video removed successfully.' };
  }
}
