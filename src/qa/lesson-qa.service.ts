import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentStatus, Role } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

interface AuthUser {
  id: string;
  role: Role;
}

@Injectable()
export class LessonQaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── Access helpers ─────────────────────────────────────────────

  private async getStudent(userId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');
    return student;
  }

  private async assertLessonAccess(lessonId: string, user: AuthUser) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, isDeleted: false },
      select: { id: true, courseId: true, course: { select: { teacherId: true } } },
    });
    if (!lesson) throw new NotFoundException('Lesson not found.');

    if (user.role === Role.TEACHER) {
      const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id } });
      if (!teacher || teacher.id !== lesson.course.teacherId) {
        throw new ForbiddenException('You do not own this course.');
      }
      return lesson;
    }

    if (user.role === Role.ADMIN) return lesson;

    // STUDENT — must be actively enrolled
    const student = await this.getStudent(user.id);
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
    return lesson;
  }

  private async findQuestionWithAccess(questionId: string, user: AuthUser) {
    const question = await this.prisma.lessonQuestion.findFirst({
      where: { id: questionId },
      include: {
        lesson: {
          select: { courseId: true, course: { select: { teacherId: true } } },
        },
      },
    });
    if (!question) throw new NotFoundException('Question not found.');

    if (user.role === Role.ADMIN) return question;

    if (user.role === Role.TEACHER) {
      const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id } });
      if (!teacher || teacher.id !== question.lesson.course.teacherId) {
        throw new ForbiddenException('You do not own this course.');
      }
      return question;
    }

    const student = await this.getStudent(user.id);
    const isOwner = question.studentId === student.id;
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId: student.id,
        courseId: question.lesson.courseId,
        status: EnrollmentStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (!isOwner && !enrollment) {
      throw new ForbiddenException('Access denied.');
    }
    if (!enrollment) throw new ForbiddenException('You must be enrolled to view questions.');
    return question;
  }

  // ─── Questions CRUD ─────────────────────────────────────────────

  async createQuestion(
    lessonId: string,
    content: string,
    user: AuthUser,
  ) {
    await this.assertLessonAccess(lessonId, user);
    const student = await this.getStudent(user.id);

    const question = await this.prisma.lessonQuestion.create({
      data: { studentId: student.id, lessonId, content: content.trim() },
    });

    // إشعار المدرس صاحب الكورس بوجود سؤال جديد
    try {
      const lesson = await this.prisma.lesson.findFirst({
        where: { id: lessonId },
        select: {
          title: true,
          courseId: true,
          course: { select: { title: true, teacher: { select: { userId: true } } } },
        },
      });
      if (lesson?.course.teacher?.userId) {
        await this.notificationsService.notify({
          userId: lesson.course.teacher.userId,
          type: 'QUESTION_NEW',
          title: 'سؤال جديد من طالب',
          body: `طرح طالب سؤالاً على الدرس "${lesson.title}" في كورس "${lesson.course.title}".`,
          linkUrl: `/courses/${lesson.courseId ?? ''}/learn`,
        });
      }
    } catch {
      /* non-blocking */
    }

    return { message: 'Question created successfully.', question };
  }

  async listQuestions(
    lessonId: string,
    user: AuthUser,
    query: { page?: number; limit?: number; onlyUnanswered?: boolean },
  ) {
    await this.assertLessonAccess(lessonId, user);

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 20, 50);

    const where = {
      lessonId,
      ...(query.onlyUnanswered && { isAnswered: false }),
    };

    const [questions, total] = await Promise.all([
      this.prisma.lessonQuestion.findMany({
        where,
        include: {
          student: { select: { fullName: true, userId: true } },
          answers: {
            include: { author: { select: { role: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.lessonQuestion.count({ where }),
    ]);

    return {
      questions: questions.map((q) => ({
        id: q.id,
        content: q.content,
        studentName: q.student.fullName,
        isOwn: user.role === Role.STUDENT && q.student.userId === user.id,
        isPinned: q.isPinned,
        isAnswered: q.isAnswered,
        createdAt: q.createdAt,
        answers: q.answers.map((a) => ({
          id: a.id,
          content: a.content,
          videoUrl: a.videoUrl ?? null,
          isTeacherReply: a.isTeacherReply || a.author.role !== Role.STUDENT,
          isOwnAnswer: a.authorUserId === user.id,
          createdAt: a.createdAt,
        })),
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async updateQuestion(questionId: string, content: string, user: AuthUser) {
    const question = await this.findQuestionWithAccess(questionId, user);
    if (question.studentId !== (await this.getStudent(user.id))?.id) {
      throw new ForbiddenException('You can only edit your own questions.');
    }
    if (question.isAnswered) {
      throw new ForbiddenException('This question has been answered and cannot be edited.');
    }

    const updated = await this.prisma.lessonQuestion.update({
      where: { id: questionId },
      data: { content: content.trim() },
    });
    return { message: 'Question updated successfully.', question: updated };
  }

  async deleteQuestion(questionId: string, user: AuthUser) {
    const question = await this.findQuestionWithAccess(questionId, user);

    if (user.role === Role.STUDENT) {
      const student = await this.getStudent(user.id);
      if (question.studentId !== student.id) {
        throw new ForbiddenException('You can only delete your own questions.');
      }
    }

    await this.prisma.lessonQuestion.delete({ where: { id: questionId } });
    return { message: 'Question deleted successfully.' };
  }

  // ─── Answers ────────────────────────────────────────────────────

  async addAnswer(
    questionId: string,
    content: string,
    user: AuthUser,
    videoUrl?: string,
  ) {
    const question = await this.findQuestionWithAccess(questionId, user);
    const isTeacher = user.role === Role.TEACHER || user.role === Role.ADMIN;

    if (!isTeacher) {
      // Students may reply only on their own threads — and cannot attach videos
      if (videoUrl) {
        throw new ForbiddenException('Only teachers can attach a video to a reply.');
      }
      const student = await this.getStudent(user.id);
      if (question.studentId !== student.id) {
        throw new ForbiddenException('Students can only reply to their own questions.');
      }
    }

    // Only the course owner (or an admin) may attach a video
    let canAttachVideo = false;
    if (videoUrl) {
      if (user.role === Role.ADMIN) {
        canAttachVideo = true;
      } else {
        const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id } });
        canAttachVideo = !!teacher && teacher.id === question.lesson.course.teacherId;
      }
      if (!canAttachVideo) {
        throw new ForbiddenException('You do not own this course.');
      }
    }

    const answer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lessonAnswer.create({
        data: {
          questionId,
          authorUserId: user.id,
          content: content.trim(),
          isTeacherReply: isTeacher,
          ...(canAttachVideo && { videoUrl }),
        },
      });

      if (isTeacher && !question.isAnswered) {
        await tx.lessonQuestion.update({
          where: { id: questionId },
          data: { isAnswered: true },
        });
      }

      return created;
    });

    return { message: 'Answer added successfully.', answer };
  }

  async updateAnswer(answerId: string, content: string, user: AuthUser, videoUrl?: string) {
    const answer = await this.prisma.lessonAnswer.findUnique({ where: { id: answerId } });
    if (!answer) throw new NotFoundException('Answer not found.');
    if (answer.authorUserId !== user.id) {
      throw new ForbiddenException('You can only edit your own answers.');
    }

    const updated = await this.prisma.lessonAnswer.update({
      where: { id: answerId },
      data: {
        content: content.trim(),
        ...(videoUrl !== undefined && { videoUrl }),
      },
    });
    return { message: 'Answer updated successfully.', answer: updated };
  }

  async deleteAnswer(answerId: string, user: AuthUser) {
    const answer = await this.prisma.lessonAnswer.findUnique({ where: { id: answerId } });
    if (!answer) throw new NotFoundException('Answer not found.');

    const isOwner = answer.authorUserId === user.id;
    let isCourseOwnerOrAdmin = false;
    if (!isOwner && user.role === Role.ADMIN) {
      isCourseOwnerOrAdmin = true;
    } else if (!isOwner && user.role === Role.TEACHER) {
      const q = await this.prisma.lessonQuestion.findUnique({
        where: { id: answer.questionId },
        include: { lesson: { include: { course: { include: { teacher: true } } } } },
      });
      const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id } });
      isCourseOwnerOrAdmin =
        !!q && !!teacher && q.lesson.course.teacherId === teacher.id;
    }

    if (!isOwner && !isCourseOwnerOrAdmin) {
      throw new ForbiddenException('Access denied.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.lessonAnswer.delete({ where: { id: answerId } });
      // Re-evaluate answered state
      const remainingTeacherReplies = await tx.lessonAnswer.count({
        where: { questionId: answer.questionId, isTeacherReply: true },
      });
      if (remainingTeacherReplies === 0) {
        await tx.lessonQuestion.update({
          where: { id: answer.questionId },
          data: { isAnswered: false },
        });
      }
    });

    return { message: 'Answer deleted successfully.' };
  }

  // ─── Teacher moderation ────────────────────────────────────────

  async togglePin(questionId: string, user: AuthUser) {
    const question = await this.findQuestionWithAccess(questionId, user);

    if (user.role === Role.STUDENT) {
      throw new ForbiddenException('Only teachers can pin questions.');
    }

    const updated = await this.prisma.lessonQuestion.update({
      where: { id: questionId },
      data: { isPinned: !question.isPinned },
    });
    return {
      message: updated.isPinned ? 'Question pinned.' : 'Question unpinned.',
      question: updated,
    };
  }

  async markAnswered(questionId: string, user: AuthUser) {
    const question = await this.findQuestionWithAccess(questionId, user);

    if (user.role === Role.STUDENT) {
      throw new ForbiddenException('Only teachers can mark questions as answered.');
    }

    const updated = await this.prisma.lessonQuestion.update({
      where: { id: questionId },
      data: { isAnswered: true },
    });
    return { message: 'Question marked as answered.', question: updated };
  }
}
