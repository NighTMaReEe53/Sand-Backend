import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EnrollmentStatus } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

@Injectable()
export class BookmarksService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureEnrolledStudent(userId: string, lessonId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, isDeleted: false },
      select: { id: true, courseId: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found.');

    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId: student.id,
        courseId: lesson.courseId,
        status: EnrollmentStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (!enrollment) {
      throw new ForbiddenException('You must have an active enrollment in this course.');
    }

    return { student, lesson };
  }

  async createBookmark(
    userId: string,
    dto: { lessonId: string; videoTimestampSeconds?: number; pdfPageNumber?: number },
  ) {
    const { student } = await this.ensureEnrolledStudent(userId, dto.lessonId);

    // Prevent exact duplicates
    const existing = await this.prisma.bookmark.findFirst({
      where: {
        studentId: student.id,
        lessonId: dto.lessonId,
        videoTimestampSeconds: dto.videoTimestampSeconds ?? null,
        pdfPageNumber: dto.pdfPageNumber ?? null,
      },
    });
    if (existing) {
      return { message: 'Bookmark already exists.', bookmark: existing };
    }

    const bookmark = await this.prisma.bookmark.create({
      data: {
        studentId: student.id,
        lessonId: dto.lessonId,
        videoTimestampSeconds: dto.videoTimestampSeconds ?? null,
        pdfPageNumber: dto.pdfPageNumber ?? null,
      },
    });
    return { message: 'Bookmark created successfully.', bookmark };
  }

  async deleteBookmark(userId: string, bookmarkId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const bookmark = await this.prisma.bookmark.findUnique({ where: { id: bookmarkId } });
    if (!bookmark) throw new NotFoundException('Bookmark not found.');
    if (bookmark.studentId !== student.id) {
      throw new ForbiddenException('You can only delete your own bookmarks.');
    }

    await this.prisma.bookmark.delete({ where: { id: bookmarkId } });
    return { message: 'Bookmark deleted successfully.' };
  }

  async listBookmarks(userId: string, query: { courseId?: string; lessonId?: string }) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const bookmarks = await this.prisma.bookmark.findMany({
      where: {
        studentId: student.id,
        ...(query.courseId && { lesson: { courseId: query.courseId, isDeleted: false as never } }),
        ...(query.lessonId && { lessonId: query.lessonId }),
      },
      include: { lesson: { select: { id: true, title: true, courseId: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      bookmarks: bookmarks.map((b) => ({
        id: b.id,
        lessonId: b.lessonId,
        lessonTitle: b.lesson.title,
        courseId: b.lesson.courseId,
        videoTimestampSeconds: b.videoTimestampSeconds,
        pdfPageNumber: b.pdfPageNumber,
        createdAt: b.createdAt,
      })),
    };
  }
}
