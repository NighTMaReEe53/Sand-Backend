import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EnrollmentStatus, Role } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

interface AuthUser {
  id: string;
  role: Role;
}

@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureStudent(userId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');
    return student;
  }

  private async ensureEnrolledLesson(studentId: string, lessonId: string) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, isDeleted: false },
      select: { id: true, courseId: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found.');

    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId: lesson.courseId,
        status: EnrollmentStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (!enrollment) {
      throw new ForbiddenException('You must have an active enrollment in this course.');
    }
    return lesson;
  }

  async createNote(
    userId: string,
    dto: { lessonId: string; content: string; videoTimestampSeconds?: number },
  ) {
    const student = await this.ensureStudent(userId);
    await this.ensureEnrolledLesson(student.id, dto.lessonId);

    const note = await this.prisma.note.create({
      data: {
        studentId: student.id,
        lessonId: dto.lessonId,
        content: dto.content.trim(),
        videoTimestampSeconds: dto.videoTimestampSeconds ?? null,
      },
    });
    return { message: 'Note created successfully.', note };
  }

  async updateNote(
    userId: string,
    noteId: string,
    dto: { content?: string; videoTimestampSeconds?: number | null },
  ) {
    const student = await this.ensureStudent(userId);

    const note = await this.prisma.note.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Note not found.');
    if (note.studentId !== student.id) {
      throw new ForbiddenException('You can only edit your own notes.');
    }

    const updated = await this.prisma.note.update({
      where: { id: noteId },
      data: {
        ...(dto.content !== undefined && { content: dto.content.trim() }),
        ...(dto.videoTimestampSeconds !== undefined && {
          videoTimestampSeconds: dto.videoTimestampSeconds,
        }),
      },
    });
    return { message: 'Note updated successfully.', note: updated };
  }

  async deleteNote(userId: string, noteId: string) {
    const student = await this.ensureStudent(userId);

    const note = await this.prisma.note.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Note not found.');
    if (note.studentId !== student.id) {
      throw new ForbiddenException('You can only delete your own notes.');
    }

    await this.prisma.note.delete({ where: { id: noteId } });
    return { message: 'Note deleted successfully.' };
  }

  async listNotes(
    userId: string,
    query: { courseId?: string; lessonId?: string; search?: string; page?: number; limit?: number },
  ) {
    const student = await this.ensureStudent(userId);

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 20, 100);

    const where = {
      studentId: student.id,
      ...(query.courseId && { lesson: { courseId: query.courseId, isDeleted: false as never } }),
      ...(query.lessonId && { lessonId: query.lessonId }),
      ...(query.search && {
        content: { contains: query.search, mode: 'insensitive' as never },
      }),
    };

    const [notes, total] = await Promise.all([
      this.prisma.note.findMany({
        where,
        include: {
          lesson: { select: { id: true, title: true, courseId: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.note.count({ where }),
    ]);

    return {
      notes: notes.map((n) => ({
        id: n.id,
        lessonId: n.lessonId,
        lessonTitle: n.lesson.title,
        courseId: n.lesson.courseId,
        content: n.content,
        videoTimestampSeconds: n.videoTimestampSeconds,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }
}
