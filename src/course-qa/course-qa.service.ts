import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EnrollmentStatus, QuestionStatus, Role } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateCourseQuestionDto, CreateCourseReplyDto, UpdateQuestionStatusDto } from './dto/course-qa.dto';

interface AuthUser {
  id: string;
  role: Role;
}

@Injectable()
export class CourseQaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async getStudent(userId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');
    return student;
  }

  private async getTeacher(userId: string) {
    const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId } });
    if (!teacher) throw new ForbiddenException('Teacher profile not found.');
    return teacher;
  }

  private async assertEnrolled(studentId: string, courseId: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, courseId, status: EnrollmentStatus.ACTIVE },
      select: { id: true },
    });
    if (!enrollment) throw new ForbiddenException('You must be actively enrolled in this course.');
  }

  private async assertTeacherOwnsCourse(teacherId: string, courseId: string) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId }, select: { teacherId: true } });
    if (!course) throw new NotFoundException('Course not found.');
    if (course.teacherId !== teacherId) throw new ForbiddenException('You do not teach this course.');
  }

  async createQuestion(user: AuthUser, dto: CreateCourseQuestionDto) {
    const student = await this.getStudent(user.id);
    await this.assertEnrolled(student.id, dto.courseId);

    const question = await this.prisma.courseQuestion.create({
      data: {
        courseId: dto.courseId,
        studentId: student.id,
        content: dto.content.trim(),
        imageUrl: dto.imageUrl,
      },
    });

    // Notify teacher — non-blocking, direct community question link
    try {
      const course = await this.prisma.course.findUnique({
        where: { id: dto.courseId },
        select: { title: true, teacher: { select: { userId: true } } },
      });
      if (course?.teacher?.userId) {
        await this.notificationsService.notify({
          userId: course.teacher.userId,
          type: 'QUESTION_NEW',
          title: 'سؤال جديد من طالب',
          body: `طرح طالب سؤالاً في كورس "${course.title}".`,
          linkUrl: `/courses/${dto.courseId}/qa/${question.id}`,
        });
      }
    } catch { /* non-blocking */ }

    return { message: 'Question created successfully.', question };
  }

  async listQuestions(user: AuthUser, courseId: string | undefined, query: { page?: number; limit?: number; status?: QuestionStatus; mine?: boolean }) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 20, 50);

    if (!courseId) {
      if (user.role === Role.STUDENT) {
        const student = await this.getStudent(user.id);
        const enrollment = await this.prisma.enrollment.findFirst({
          where: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
          select: { courseId: true },
          orderBy: { enrolledAt: 'desc' },
        });
        if (!enrollment) {
          return { questions: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
        }
        courseId = enrollment.courseId;
      } else if (user.role === Role.TEACHER) {
        const teacher = await this.getTeacher(user.id);
        const course = await this.prisma.course.findFirst({
          where: { teacherId: teacher.id, isDeleted: false },
          select: { id: true },
        });
        if (!course) {
          return { questions: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
        }
        courseId = course.id;
      } else {
        const course = await this.prisma.course.findFirst({
          where: { isDeleted: false },
          select: { id: true },
        });
        if (!course) {
          return { questions: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
        }
        courseId = course.id;
      }
    }

    const where: any = { courseId };
    if (query.status) where.status = query.status;

    if (user.role === Role.STUDENT) {
      const student = await this.getStudent(user.id);
      if (query.mine) where.studentId = student.id;
    } else if (user.role === Role.TEACHER) {
      const teacher = await this.getTeacher(user.id);
      await this.assertTeacherOwnsCourse(teacher.id, courseId);
    }

    const [questions, total] = await Promise.all([
      this.prisma.courseQuestion.findMany({
        where,
        include: {
          student: { select: { fullName: true, userId: true, photoUrl: true } },
          _count: { select: { replies: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.courseQuestion.count({ where }),
    ]);

    return {
      questions: questions.map((q) => ({
        id: q.id,
        content: q.content,
        imageUrl: q.imageUrl,
        status: q.status,
        studentName: q.student.fullName,
        studentPhoto: q.student.photoUrl,
        isOwn: user.role === Role.STUDENT && q.student.userId === user.id,
        repliesCount: q._count.replies,
        createdAt: q.createdAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async getQuestion(user: AuthUser, questionId: string) {
    const question = await this.prisma.courseQuestion.findUnique({
      where: { id: questionId },
      include: {
        student: { select: { fullName: true, userId: true, photoUrl: true } },
        course: { select: { id: true, title: true, teacherId: true } },
      },
    });
    if (!question) throw new NotFoundException('Question not found.');

    if (user.role === Role.STUDENT) {
      // Students can view public question threads
    } else if (user.role === Role.TEACHER) {
      const teacher = await this.getTeacher(user.id);
      if (teacher.id !== question.course.teacherId) throw new ForbiddenException('Access denied.');
    }

    const replies = await this.prisma.qAReply.findMany({
      include: {
        author: { select: { id: true, role: true, studentProfile: { select: { fullName: true, photoUrl: true } }, teacherProfile: { select: { fullName: true, photoUrl: true } } } },
        children: {
          include: {
            author: { select: { id: true, role: true, studentProfile: { select: { fullName: true, photoUrl: true } }, teacherProfile: { select: { fullName: true, photoUrl: true } } } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      where: { questionId, parentId: null },
      orderBy: { createdAt: 'asc' },
    });

    const formatReply = (r: any) => ({
      id: r.id,
      content: r.content,
      imageUrl: r.imageUrl,
      authorName: r.author.studentProfile?.fullName || r.author.teacherProfile?.fullName || 'مستخدم',
      authorPhoto: r.author.studentProfile?.photoUrl || r.author.teacherProfile?.photoUrl || r.author.teacherProfile?.imageUrl,
      authorId: r.author.id,
      isTeacher: r.author.role === Role.TEACHER || r.author.role === Role.ADMIN,
      createdAt: r.createdAt,
      children: r.children?.map(formatReply) || [],
    });

    return {
      question: {
        id: question.id,
        content: question.content,
        imageUrl: question.imageUrl,
        status: question.status,
        studentName: question.student.fullName,
        studentPhoto: question.student.photoUrl,
        studentUserId: question.student.userId,
        courseTitle: question.course.title,
        createdAt: question.createdAt,
      },
      replies: replies.map(formatReply),
    };
  }

  async addReply(user: AuthUser, questionId: string, dto: CreateCourseReplyDto) {
    const question = await this.prisma.courseQuestion.findUnique({
      where: { id: questionId },
      include: {
        course: { select: { teacherId: true, title: true, id: true } },
        student: { select: { userId: true, fullName: true } },
      },
    });
    if (!question) throw new NotFoundException('Question not found.');

    if (user.role === Role.STUDENT) {
      const student = await this.getStudent(user.id);
      await this.assertEnrolled(student.id, question.courseId);
    } else if (user.role === Role.TEACHER) {
      const teacher = await this.getTeacher(user.id);
      if (teacher.id !== question.course.teacherId) throw new ForbiddenException('Access denied.');
    }

    // Validate parent reply if nested
    let parentReply: { authorId: string } | null = null;
    if (dto.parentId) {
      parentReply = await this.prisma.qAReply.findUnique({
        where: { id: dto.parentId },
        select: { authorId: true },
      });
      if (!parentReply || !(await this.prisma.qAReply.findFirst({ where: { id: dto.parentId, questionId } }))) {
        throw new ForbiddenException('Parent reply does not belong to this question.');
      }
    }

    const reply = await this.prisma.qAReply.create({
      data: {
        questionId,
        authorId: user.id,
        content: dto.content.trim(),
        imageUrl: dto.imageUrl,
        parentId: dto.parentId,
      },
    });

    // ── Notifications (non-blocking, fire-and-forget) ─────────────────
    void this._sendReplyNotifications({
      user,
      question,
      questionId,
      parentReplyAuthorId: parentReply?.authorId ?? null,
    });

    return { message: 'Reply added successfully.', reply };
  }

  /**
   * All notification logic for addReply — extracted to keep the main method clean.
   * Never throws (errors are swallowed so the reply itself is never affected).
   */
  private async _sendReplyNotifications(params: {
    user: AuthUser;
    question: {
      studentId: string;
      courseId: string;
      course: { teacherId: string; title: string; id: string };
      student: { userId: string; fullName: string };
      status: QuestionStatus;
    };
    questionId: string;
    parentReplyAuthorId: string | null;
  }) {
    const { user, question, questionId, parentReplyAuthorId } = params;
    const isTeacher = user.role === Role.TEACHER || user.role === Role.ADMIN;
    const threadLink = `/courses/${question.courseId}/qa/${questionId}`;
    const courseName = question.course.title;

    try {
      // Auto-mark question as ANSWERED when teacher replies
      if (isTeacher && question.status !== QuestionStatus.ANSWERED) {
        await this.prisma.courseQuestion.update({
          where: { id: questionId },
          data: { status: QuestionStatus.ANSWERED },
        });
      }

      // ── Collect who to notify (deduplication via Set) ─────────────
      const notifyStudentOwner = question.student.userId !== user.id;
      const teacherProfile = await this.prisma.teacherProfile.findUnique({
        where: { id: question.course.teacherId },
        select: { userId: true },
      });

      // Build notification tasks
      const tasks: Promise<any>[] = [];

      if (isTeacher) {
        // Teacher replied → notify question owner
        if (notifyStudentOwner) {
          tasks.push(
            this.notificationsService.notify({
              userId: question.student.userId,
              type: 'NEW_QA_REPLY',
              title: '🎓 رد المدرس على سؤالك',
              body: `رد المدرس على سؤالك في كورس "${courseName}".`,
              linkUrl: threadLink,
            }),
          );
        }
        // Notify parent comment author (if nested and different from question owner & replier)
        if (parentReplyAuthorId && parentReplyAuthorId !== question.student.userId && parentReplyAuthorId !== user.id) {
          tasks.push(
            this.notificationsService.notify({
              userId: parentReplyAuthorId,
              type: 'NEW_QA_REPLY',
              title: '🎓 رد المدرس على تعليقك',
              body: `رد المدرس على تعليقك في كورس "${courseName}".`,
              linkUrl: threadLink,
            }),
          );
        }
      } else {
        // Student replied

        // 1. Notify teacher (always with direct thread link)
        if (teacherProfile?.userId) {
          tasks.push(
            this.notificationsService.notify({
              userId: teacherProfile.userId,
              type: 'QUESTION_NEW',
              title: '💬 رد طالب على سؤال',
              body: `أضاف طالب رداً على سؤال في كورس "${courseName}".`,
              linkUrl: threadLink,
            }),
          );
        }

        // 2. Notify question owner (if not the one replying)
        if (notifyStudentOwner) {
          tasks.push(
            this.notificationsService.notify({
              userId: question.student.userId,
              type: 'NEW_QA_REPLY',
              title: '💬 رد جديد على سؤالك',
              body: `أضاف طالب رداً على سؤالك في كورس "${courseName}".`,
              linkUrl: threadLink,
            }),
          );
        }

        // 3. Notify parent comment author (nested reply) if different from all above
        if (
          parentReplyAuthorId &&
          parentReplyAuthorId !== user.id &&
          parentReplyAuthorId !== question.student.userId &&
          parentReplyAuthorId !== teacherProfile?.userId
        ) {
          tasks.push(
            this.notificationsService.notify({
              userId: parentReplyAuthorId,
              type: 'NEW_QA_REPLY',
              title: '💬 رد على تعليقك',
              body: `رد شخص على تعليقك في كورس "${courseName}".`,
              linkUrl: threadLink,
            }),
          );
        }
      }

      // Fire all notifications in parallel — individual failures are logged by NotificationsService
      await Promise.allSettled(tasks);
    } catch {
      // Never propagate — notifications must not break the reply flow
    }
  }

  async updateQuestionStatus(user: AuthUser, questionId: string, dto: UpdateQuestionStatusDto) {
    if (user.role !== Role.TEACHER && user.role !== Role.ADMIN) {
      throw new ForbiddenException('Only teachers can update question status.');
    }

    const question = await this.prisma.courseQuestion.findUnique({
      where: { id: questionId },
      include: { course: { select: { teacherId: true } } },
    });
    if (!question) throw new NotFoundException('Question not found.');

    const teacher = await this.getTeacher(user.id);
    if (teacher.id !== question.course.teacherId) throw new ForbiddenException('Access denied.');

    const updated = await this.prisma.courseQuestion.update({
      where: { id: questionId },
      data: { status: dto.status as QuestionStatus },
    });
    return { message: `Question marked as ${dto.status}.`, question: updated };
  }

  async getTeacherInbox(user: AuthUser, query: { courseId?: string; page?: number; limit?: number }) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 20, 50);

    let where: any = {};

    if (user.role === Role.ADMIN) {
      if (query.courseId) {
        where.courseId = query.courseId;
      }
    } else {
      const teacher = await this.getTeacher(user.id);
      const courseFilter = query.courseId ? { id: query.courseId } : {};
      const teacherCourses = await this.prisma.course.findMany({
        where: { teacherId: teacher.id, ...courseFilter },
        select: { id: true },
      });
      const courseIds = teacherCourses.map((c) => c.id);
      where.courseId = { in: courseIds };
    }

    const [questions, total] = await Promise.all([
      this.prisma.courseQuestion.findMany({
        where,
        include: {
          student: { select: { fullName: true, photoUrl: true } },
          course: { select: { title: true } },
          _count: { select: { replies: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.courseQuestion.count({ where }),
    ]);

    return {
      questions: questions.map((q) => ({
        id: q.id,
        content: q.content,
        imageUrl: q.imageUrl,
        status: q.status,
        studentName: q.student.fullName,
        studentPhoto: q.student.photoUrl,
        courseName: q.course.title,
        courseId: q.courseId,
        repliesCount: q._count.replies,
        createdAt: q.createdAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }
}
