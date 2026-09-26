import * as path from 'path';
import * as crypto from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../shared/storage/storage.service';
import { CoinsService } from '../coins/coins.service';
import { canManageCourse } from '../common/utils/course-access.util';
import { QuizAttemptStatus, Role } from '@prisma/client';
import {
  CreateHomeworkDto,
  CreateHomeworkQuestionDto,
  GradeEssayAnswerDto,
  SubmitHomeworkDto,
  UpdateHomeworkDto,
  UpdateHomeworkQuestionDto,
} from './dtos/homework.dtos';

type AuthUser = { id: string; role: Role };

@Injectable()
export class HomeworksService {
  private readonly logger = new Logger(HomeworksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly storageService: StorageService,
    private readonly coinsService: CoinsService,
  ) {}

  /** الواجب مفتوح إذا لم يكن له تاريخ فتح أو تجاوز التاريخ الحالي */
  private isOpenNow(availableFrom: Date | null): boolean {
    return !availableFrom || new Date() >= availableFrom;
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Create Homework
  // ─────────────────────────────────────────────────────────────
  async createHomework(lessonId: string, dto: CreateHomeworkDto, user: AuthUser) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId, isDeleted: false },
      select: { id: true, courseId: true, title: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found.');
    await this.ensureCanManageCourse(lesson.courseId, user);

    if (dto.questions?.length) {
      for (const q of dto.questions) {
        if (!q.requiresImageAnswer && (q.options?.length ?? 0) < 2) {
          throw new BadRequestException('MCQ questions must have at least 2 options.');
        }
        if (!q.requiresImageAnswer && q.correctOptionIndex !== undefined &&
          q.options && q.correctOptionIndex >= q.options.length) {
          throw new BadRequestException(
            `correctOptionIndex (${q.correctOptionIndex}) exceeds the number of options (${q.options.length}).`,
          );
        }
      }
    }

    const homework = await this.prisma.homework.create({
      data: {
        lessonId,
        title: dto.title,
        description: dto.description ?? null,
        availableFrom: dto.availableFrom ? new Date(dto.availableFrom) : null,
        passingPercentage: dto.passingPercentage ?? 50,
        maxAttempts: dto.maxAttempts ?? 1,
        isPublished: dto.isPublished ?? false,
        ...(dto.questions?.length && {
          questions: {
            create: dto.questions.map((q, idx) => ({
              text: q.text,
              options: q.options,
              correctOptionIndex: q.correctOptionIndex,
              explanation: q.explanation ?? null,
              marks: q.marks ?? 1,
              requiresImageAnswer: q.requiresImageAnswer ?? false,
              orderIndex: q.orderIndex ?? idx + 1,
            })),
          },
        }),
      },
      include: { questions: { where: { isDeleted: false }, orderBy: { orderIndex: 'asc' } } },
    });

    if (homework.isPublished && this.isOpenNow(homework.availableFrom)) {
      this.notifyNewHomework(lesson.courseId, homework.title, lesson.title, lessonId);
    }

    return { message: 'Homework created successfully.', homework };
  }

  private notifyNewHomework(courseId: string, title: string, lessonTitle: string, lessonId: string) {
    this.notificationsService
      .notifyEnrolledStudents(courseId, {
        type: 'HOMEWORK_NEW',
        title: 'واجب جديد',
        body: `تم إضافة واجب جديد "${title}" للدرس "${lessonTitle}".`,
        linkUrl: `/courses/${courseId}/learn?lesson=${lessonId}`,
      })
      .catch(() => undefined);
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Upload the homework sheet (PDF / Word / PowerPoint)
  // ─────────────────────────────────────────────────────────────
  private static readonly ALLOWED_SHEET_TYPES: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };

  async uploadSheet(homeworkId: string, file: Express.Multer.File | undefined, user: AuthUser) {
    if (!file || !file.buffer) {
      throw new BadRequestException('A document file is required.');
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = Object.keys(HomeworksService.ALLOWED_SHEET_TYPES);
    if (!allowedExts.includes(ext)) {
      throw new BadRequestException(
        `Unsupported file type. Allowed: ${allowedExts.join(', ')}`,
      );
    }
    if (file.buffer.length > 50 * 1024 * 1024) {
      throw new BadRequestException('File size must be under 50 MB.');
    }

    const homework = await this.findHomeworkAsOwner(homeworkId, user);

    const uniqueName = `${crypto.randomUUID()}${ext}`;
    const folder = `homework-sheets/${homeworkId}`;
    const key = await this.storageService.uploadFile(
      { originalname: uniqueName, buffer: file.buffer, mimetype: file.mimetype },
      folder,
    );
    const pdfUrl = typeof key === 'string' ? key : (key as any)?.key ?? String(key);

    await this.prisma.homework.update({ where: { id: homeworkId }, data: { pdfUrl } });

    return { message: 'تم رفع ملف الواجب بنجاح.', pdfUrl };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER / STUDENT: Get signed URL for homework sheet PDF
  // ─────────────────────────────────────────────────────────────
  async getPdfUrl(homeworkId: string, userId: string, role: Role) {
    const homework = await this.prisma.homework.findFirst({
      where: { id: homeworkId, isDeleted: false },
      select: { pdfUrl: true, lesson: { select: { courseId: true } }, isPublished: true },
    });
    if (!homework || !homework.pdfUrl) throw new NotFoundException('No PDF sheet found.');

    if (role === Role.STUDENT) {
      const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
      if (!student) throw new ForbiddenException('Student profile not found.');
      const enrolled = await this.prisma.enrollment.findFirst({
        where: { studentId: student.id, courseId: homework.lesson.courseId, status: 'ACTIVE' },
      });
      if (!enrolled) throw new ForbiddenException('Not enrolled in this course.');
    }

    const url = await this.storageService.generateSignedDownloadUrl(homework.pdfUrl, 300);
    return { url };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Update homework
  // ─────────────────────────────────────────────────────────────
  async updateHomework(id: string, dto: UpdateHomeworkDto, user: AuthUser) {
    const homework = await this.findHomeworkAsOwner(id, user);

    const wasPublished = homework.isPublished;
    const wasOpen = this.isOpenNow(homework.availableFrom);

    const updated = await this.prisma.homework.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.availableFrom !== undefined && {
          availableFrom: dto.availableFrom ? new Date(dto.availableFrom) : null,
        }),
        ...(dto.passingPercentage !== undefined && { passingPercentage: dto.passingPercentage }),
        ...(dto.maxAttempts !== undefined && { maxAttempts: dto.maxAttempts }),
        ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
      },
      include: { lesson: { select: { courseId: true, title: true, id: true } } },
    });

    const nowPublished = updated.isPublished;
    const nowOpen = this.isOpenNow(updated.availableFrom);
    if (!wasPublished && nowPublished && nowOpen) {
      this.notifyNewHomework(
        updated.lesson.courseId,
        updated.title,
        updated.lesson.title,
        updated.lesson.id,
      );
    }

    return { message: 'Homework updated successfully.', homework: updated };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Soft-delete homework
  // ─────────────────────────────────────────────────────────────
  async deleteHomework(id: string, user: AuthUser) {
    await this.findHomeworkAsOwner(id, user);
    await this.prisma.homework.update({ where: { id }, data: { isDeleted: true } });
    return { message: 'Homework deleted successfully.' };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Add question to existing homework
  // ─────────────────────────────────────────────────────────────
  async addQuestion(homeworkId: string, dto: CreateHomeworkQuestionDto, user: AuthUser) {
    await this.findHomeworkAsOwner(homeworkId, user);

    if (!dto.requiresImageAnswer) {
      if ((dto.options?.length ?? 0) < 2)
        throw new BadRequestException('MCQ questions must have at least 2 options.');
      if (dto.correctOptionIndex !== undefined && dto.options &&
        dto.correctOptionIndex >= dto.options.length)
        throw new BadRequestException('correctOptionIndex out of range.');
    }

    const maxOrder = await this.prisma.homeworkQuestion.aggregate({
      where: { homeworkId, isDeleted: false },
      _max: { orderIndex: true },
    });

    const question = await this.prisma.homeworkQuestion.create({
      data: {
        homeworkId,
        text: dto.text,
        options: dto.options ?? [],
        correctOptionIndex: dto.correctOptionIndex ?? 0,
        explanation: dto.explanation ?? null,
        marks: dto.marks ?? 1,
        requiresImageAnswer: dto.requiresImageAnswer ?? false,
        orderIndex: dto.orderIndex ?? (maxOrder._max.orderIndex ?? 0) + 1,
      },
    });

    return { message: 'Question added.', question };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Update question
  // ─────────────────────────────────────────────────────────────
  async updateQuestion(questionId: string, dto: UpdateHomeworkQuestionDto, user: AuthUser) {
    const question = await this.prisma.homeworkQuestion.findUnique({
      where: { id: questionId, isDeleted: false },
      include: { homework: { select: { lesson: { select: { courseId: true } } } } },
    });
    if (!question) throw new NotFoundException('Question not found.');
    await this.ensureCanManageCourse(question.homework.lesson.courseId, user);

    const updated = await this.prisma.homeworkQuestion.update({
      where: { id: questionId },
      data: {
        ...(dto.text !== undefined && { text: dto.text }),
        ...(dto.options !== undefined && { options: dto.options }),
        ...(dto.correctOptionIndex !== undefined && { correctOptionIndex: dto.correctOptionIndex }),
        ...(dto.explanation !== undefined && { explanation: dto.explanation }),
        ...(dto.marks !== undefined && { marks: dto.marks }),
        ...(dto.orderIndex !== undefined && { orderIndex: dto.orderIndex }),
        ...(dto.requiresImageAnswer !== undefined && { requiresImageAnswer: dto.requiresImageAnswer }),
      },
    });
    return { message: 'Question updated.', question: updated };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Soft-delete question
  // ─────────────────────────────────────────────────────────────
  async deleteQuestion(questionId: string, user: AuthUser) {
    const question = await this.prisma.homeworkQuestion.findUnique({
      where: { id: questionId, isDeleted: false },
      include: { homework: { select: { lesson: { select: { courseId: true } } } } },
    });
    if (!question) throw new NotFoundException('Question not found.');
    await this.ensureCanManageCourse(question.homework.lesson.courseId, user);
    await this.prisma.homeworkQuestion.update({ where: { id: questionId }, data: { isDeleted: true } });
    return { message: 'Question deleted.' };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: List homeworks of a lesson (with questions)
  // ─────────────────────────────────────────────────────────────
  async getLessonHomeworksForTeacher(lessonId: string, user: AuthUser) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId, isDeleted: false },
      select: { courseId: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found.');
    await this.ensureCanManageCourse(lesson.courseId, user);

    const homeworks = await this.prisma.homework.findMany({
      where: { lessonId, isDeleted: false },
      include: {
        questions: { where: { isDeleted: false }, orderBy: { orderIndex: 'asc' } },
        _count: { select: { attempts: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return { homeworks };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER/STUDENT: Get One Homework Attempt Detail (Full Answer Sheet)
  // ─────────────────────────────────────────────────────────────
  async getTeacherAttemptDetail(attemptId: string, user: AuthUser) {
    const attempt = await this.prisma.homeworkAttempt.findUnique({
      where: { id: attemptId },
      include: {
        homework: {
          select: {
            id: true,
            title: true,
            passingPercentage: true,
            questions: {
              where: { isDeleted: false },
              orderBy: { orderIndex: 'asc' },
              select: {
                id: true,
                text: true,
                options: true,
                correctOptionIndex: true,
                explanation: true,
                marks: true,
                orderIndex: true,
                requiresImageAnswer: true,
              },
            },
            lesson: { select: { title: true, courseId: true, id: true } },
          },
        },
        student: { select: { fullName: true, gradeLevel: true, userId: true } },
        answers: {
          include: {
            question: {
              select: {
                text: true,
                options: true,
                correctOptionIndex: true,
                explanation: true,
                marks: true,
                orderIndex: true,
                requiresImageAnswer: true,
              },
            },
          },
          orderBy: { question: { orderIndex: 'asc' } },
        },
      },
    });

    if (!attempt) throw new NotFoundException('Attempt not found.');

    // الطالب يشوف محاولته الخاصة فقط
    if (user.role === Role.STUDENT) {
      const student = await this.prisma.studentProfile.findUnique({ where: { userId: user.id } });
      if (!student || attempt.studentId !== student.id) {
        throw new ForbiddenException('Access denied to this attempt.');
      }
      if (attempt.status !== QuizAttemptStatus.SUBMITTED) {
        throw new BadRequestException('يمكن مراجعة الواجب فقط بعد التسليم.');
      }
    } else {
      // المعلم يتحقق من ملكية الكورس
      await this.ensureCanManageCourse(attempt.homework.lesson.courseId, user);
    }

    return {
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      startedAt: attempt.startedAt,
      score: attempt.score,
      earnedMarks: attempt.earnedMarks,
      totalMarks: attempt.totalMarks,
      isPassed: attempt.isPassed,
      status: attempt.status,
      submittedAt: attempt.submittedAt,
      homework: attempt.homework,
      student: { fullName: attempt.student.fullName, gradeLevel: attempt.student.gradeLevel },
      answers: attempt.homework.questions.map((question) => {
        const answer = attempt.answers.find((item) => item.questionId === question.id);
        return answer ?? {
          id: `unanswered-${question.id}`,
          questionId: question.id,
          selectedOptionIndex: null,
          imageUrl: null,
          isCorrect: false,
          awardedMarks: 0,
          teacherGrade: null,
          teacherNote: null,
          question,
        };
      }),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: List all submissions for a homework (including unsubmitted students)
  // ─────────────────────────────────────────────────────────────
  async listSubmissions(homeworkId: string, user: AuthUser) {
    const homework = await this.findHomeworkAsOwner(homeworkId, user);

    const [enrollments, attempts] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: {
          courseId: homework.lesson.courseId,
          status: 'ACTIVE',
        },
        include: {
          student: {
            select: {
              id: true,
              fullName: true,
              gradeLevel: true,
              user: { select: { phone: true, email: true } },
            },
          },
        },
        orderBy: { enrolledAt: 'desc' },
      }),
      this.prisma.homeworkAttempt.findMany({
        where: { homeworkId },
        include: {
          student: {
            select: {
              id: true,
              fullName: true,
              gradeLevel: true,
              user: { select: { phone: true, email: true } },
            },
          },
          answers: {
            include: {
              question: {
                select: {
                  text: true,
                  marks: true,
                  orderIndex: true,
                  requiresImageAnswer: true,
                },
              },
            },
            orderBy: { question: { orderIndex: 'asc' } },
          },
        },
        orderBy: { submittedAt: 'desc' },
      }),
    ]);

    // Submitted attempts
    const submittedAttempts = attempts.filter((a) => a.status === QuizAttemptStatus.SUBMITTED);
    const submittedStudentIds = new Set(submittedAttempts.map((a) => a.studentId));

    const submissions = submittedAttempts.map((a) => {
      const essayAnswers = a.answers.filter((ans) => ans.question.requiresImageAnswer);
      const essayPendingCount = essayAnswers.filter(
        (ans) => ans.imageUrl && ans.teacherGrade === null,
      ).length;
      return {
        id: a.id,
        attemptNumber: a.attemptNumber,
        score: a.score,
        earnedMarks: a.earnedMarks,
        totalMarks: a.totalMarks,
        isPassed: a.isPassed,
        submittedAt: a.submittedAt,
        student: {
          id: a.student.id,
          fullName: a.student.fullName,
          gradeLevel: a.student.gradeLevel,
          phone: a.student.user?.phone ?? null,
          email: a.student.user?.email ?? null,
        },
        essayPendingCount,
        answers: a.answers,
      };
    });

    // In-progress attempts map by studentId
    const inProgressMap = new Map(
      attempts
        .filter((a) => a.status === QuizAttemptStatus.IN_PROGRESS)
        .map((a) => [a.studentId, a]),
    );

    // Unsubmitted enrolled students
    const unsubmittedStudents = enrollments
      .filter((e) => !submittedStudentIds.has(e.studentId))
      .map((e) => {
        const inProgressAttempt = inProgressMap.get(e.studentId);
        return {
          studentId: e.student.id,
          fullName: e.student.fullName,
          gradeLevel: e.student.gradeLevel,
          phone: e.student.user?.phone ?? null,
          email: e.student.user?.email ?? null,
          enrolledAt: e.enrolledAt,
          status: inProgressAttempt ? ('IN_PROGRESS' as const) : ('NOT_STARTED' as const),
          startedAt: inProgressAttempt?.startedAt ?? null,
          attemptId: inProgressAttempt?.id ?? null,
        };
      });

    const pendingGradingCount = submissions.filter((s) => s.essayPendingCount > 0).length;
    const passedCount = submissions.filter((s) => s.isPassed === true).length;
    const failedCount = submissions.filter((s) => s.score !== null && s.isPassed === false).length;

    const stats = {
      totalEnrolled: enrollments.length,
      submittedCount: submissions.length,
      unsubmittedCount: unsubmittedStudents.length,
      pendingGradingCount,
      passedCount,
      failedCount,
    };

    return {
      submissions,
      unsubmittedStudents,
      stats,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Grade a single essay answer
  // ─────────────────────────────────────────────────────────────
  async gradeEssayAnswer(attemptId: string, questionId: string, dto: GradeEssayAnswerDto, user: AuthUser) {
    const attempt = await this.prisma.homeworkAttempt.findUnique({
      where: { id: attemptId },
      include: {
        homework: {
          select: {
            id: true,
            title: true,
            passingPercentage: true,
            lesson: { select: { courseId: true, id: true } },
          },
        },
        answers: {
          include: {
            question: { select: { marks: true, requiresImageAnswer: true } },
          },
        },
        student: { select: { userId: true, fullName: true } },
      },
    });

    if (!attempt) throw new NotFoundException('Attempt not found.');
    if (attempt.status !== QuizAttemptStatus.SUBMITTED) {
      throw new BadRequestException('المحاولة يجب أن تكون مسلمة أولاً.');
    }

    await this.ensureCanManageCourse(attempt.homework.lesson.courseId, user);

    const answer = attempt.answers.find((a) => a.questionId === questionId);
    if (!answer) throw new NotFoundException('الإجابة غير موجودة في هذه المحاولة.');
    if (!answer.question.requiresImageAnswer) {
      throw new BadRequestException('هذا السؤال ليس سؤال صورة — يتم تصحيحه تلقائياً.');
    }

    if (dto.awardedMarks > answer.question.marks) {
      throw new BadRequestException(
        `الدرجة الممنوحة (${dto.awardedMarks}) تتجاوز الدرجة الكاملة للسؤال (${answer.question.marks}).`,
      );
    }

    await this.prisma.homeworkAnswer.update({
      where: { id: answer.id },
      data: {
        awardedMarks: dto.awardedMarks,
        teacherGrade: dto.awardedMarks,
        teacherNote: dto.teacherNote ?? null,
        isCorrect: dto.awardedMarks > 0,
      },
    });

    const freshAnswers = await this.prisma.homeworkAnswer.findMany({
      where: { attemptId },
      include: { question: { select: { marks: true, requiresImageAnswer: true } } },
    });

    const mcqTotal = freshAnswers
      .filter((a) => !a.question.requiresImageAnswer)
      .reduce((s, a) => s + a.question.marks, 0);
    const essayTotal = freshAnswers
      .filter((a) => a.question.requiresImageAnswer)
      .reduce((s, a) => s + a.question.marks, 0);
    const totalMarks = mcqTotal + essayTotal;

    const earnedMarks = freshAnswers.reduce((s, a) => s + (a.awardedMarks ?? 0), 0);

    const essayAnswers = freshAnswers.filter((a) => a.question.requiresImageAnswer);
    const allEssayGraded = essayAnswers.every((a) => a.teacherGrade !== null);

    const scorePct = totalMarks > 0 ? Math.round((earnedMarks / totalMarks) * 100) : 0;
    const isPassed = scorePct >= attempt.homework.passingPercentage;

    await this.prisma.homeworkAttempt.update({
      where: { id: attemptId },
      data: { earnedMarks, totalMarks, score: scorePct, isPassed },
    });

    if (allEssayGraded) {
      await this.notificationsService
        .notify({
          userId: attempt.student.userId,
          type: 'HOMEWORK_RESULT',
          title: isPassed ? 'مبروك! نجحت في الواجب 🎉' : 'نتيجة الواجب — مراجعة الأستاذ مكتملة',
          body: `واجب "${attempt.homework.title}": حصلت على ${earnedMarks} من ${totalMarks} درجة (${scorePct}%)`,
          linkUrl: `/courses/${attempt.homework.lesson.courseId}/learn?lesson=${attempt.homework.lesson.id}`,
        })
        .catch(() => undefined);
    }

    return { message: 'تم تسجيل الدرجة بنجاح.', allEssayGraded, score: scorePct, earnedMarks, totalMarks, isPassed };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER/ADMIN: Overview of all homeworks across courses
  // ─────────────────────────────────────────────────────────────
  async getAllTeacherHomeworks(user: AuthUser) {
    const isAdmin = user.role === Role.ADMIN;
    const isTeacher = user.role === Role.TEACHER;

    let teacherCourseIds: string[] = [];
    if (isTeacher) {
      const teacherProfile = await this.prisma.teacherProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!teacherProfile) throw new ForbiddenException('Teacher profile not found.');
      const courses = await this.prisma.course.findMany({
        where: { teacherId: teacherProfile.id, isDeleted: false },
        select: { id: true },
      });
      teacherCourseIds = courses.map((c) => c.id);
    }

    const homeworks = await this.prisma.homework.findMany({
      where: {
        isDeleted: false,
        lesson: {
          isDeleted: false,
          ...(isAdmin ? {} : { courseId: { in: teacherCourseIds } }),
        },
      },
      include: {
        lesson: {
          select: {
            id: true,
            title: true,
            courseId: true,
            course: { select: { id: true, title: true } },
          },
        },
        questions: {
          where: { isDeleted: false },
          select: { id: true, requiresImageAnswer: true, marks: true },
        },
        attempts: {
          where: { status: QuizAttemptStatus.SUBMITTED },
          select: {
            id: true,
            isPassed: true,
            status: true,
            answers: {
              select: {
                teacherGrade: true,
                imageUrl: true,
                question: { select: { requiresImageAnswer: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      homeworks: homeworks.map((h) => {
        const totalAttempts = h.attempts.length;
        const passedAttempts = h.attempts.filter((a) => a.isPassed).length;
        const essayQuestionsCount = h.questions.filter((q) => q.requiresImageAnswer).length;

        let pendingReviewCount = 0;
        h.attempts.forEach((att) => {
          const hasPending = att.answers.some(
            (ans) => ans.question.requiresImageAnswer && ans.teacherGrade === null,
          );
          if (hasPending) pendingReviewCount++;
        });

        return {
          id: h.id,
          title: h.title,
          description: h.description,
          pdfUrl: h.pdfUrl,
          isPublished: h.isPublished,
          passingPercentage: h.passingPercentage,
          availableFrom: h.availableFrom,
          createdAt: h.createdAt,
          courseId: h.lesson.course.id,
          courseTitle: h.lesson.course.title,
          lessonId: h.lesson.id,
          lessonTitle: h.lesson.title,
          questionsCount: h.questions.length,
          essayQuestionsCount,
          totalAttempts,
          passedAttempts,
          pendingReviewCount,
        };
      }),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Get published homework for lesson + attempt status
  // ─────────────────────────────────────────────────────────────
  async getLessonHomework(lessonId: string, userId: string) {
    const student = await this.ensureStudent(userId, lessonId);

    const homework = await this.prisma.homework.findFirst({
      where: { lessonId, isPublished: true, isDeleted: false },
      include: {
        questions: {
          where: { isDeleted: false },
          orderBy: { orderIndex: 'asc' },
          select: { id: true },
        },
      },
    });

    if (!homework) return { hasHomework: false };

    const attempts = await this.prisma.homeworkAttempt.findMany({
      where: { homeworkId: homework.id, studentId: student.id },
      orderBy: { attemptNumber: 'asc' },
      select: {
        id: true,
        attemptNumber: true,
        score: true,
        earnedMarks: true,
        totalMarks: true,
        isPassed: true,
        status: true,
        submittedAt: true,
      },
    });

    // A student may submit a homework only once.  Keep maxAttempts in the
    // teacher-facing model for backwards compatibility, but expose the real
    // student rule consistently here.
    const submittedAttempt = attempts.find((a) => a.status === QuizAttemptStatus.SUBMITTED);
    const remainingAttempts = submittedAttempt ? 0 : 1;

    const activeAttempt = attempts.find((a) => a.status === QuizAttemptStatus.IN_PROGRESS);

    const isOpen = this.isOpenNow(homework.availableFrom);
    let opensInSeconds: number | null = null;
    if (!isOpen && homework.availableFrom) {
      opensInSeconds = Math.max(
        0,
        Math.floor((homework.availableFrom.getTime() - Date.now()) / 1000),
      );
    }

    return {
      hasHomework: true,
      homework: {
        id: homework.id,
        title: homework.title,
        description: homework.description,
        hasPdf: Boolean(homework.pdfUrl),
        questionCount: isOpen ? homework.questions.length : 0,
        availableFrom: homework.availableFrom?.toISOString() ?? null,
        isOpen,
        ...(opensInSeconds !== null && { opensInSeconds }),
        passingPercentage: homework.passingPercentage,
        maxAttempts: homework.maxAttempts,
        remainingAttempts,
        hasActiveAttempt: !!activeAttempt,
        activeAttemptId: activeAttempt?.id ?? null,
        hasSubmittedAttempt: !!submittedAttempt,
        submittedAttemptId: submittedAttempt?.id ?? null,
      },
      attempts,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Start attempt — الأسئلة بنفس ترتيب الـ PDF بدون خلط
  // ─────────────────────────────────────────────────────────────
  async startAttempt(homeworkId: string, userId: string) {
    const homework = await this.prisma.homework.findFirst({
      where: { id: homeworkId, isPublished: true, isDeleted: false },
      include: {
        lesson: { select: { courseId: true } },
        questions: {
          where: { isDeleted: false },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });
    if (!homework) throw new NotFoundException('Homework not found or not published.');

    if (!this.isOpenNow(homework.availableFrom)) {
      throw new ForbiddenException(
        'لم يفتح هذا الواجب بعد — سيكون متاحاً في الموعد الذي حدده المدرس.',
      );
    }

    const student = await this.ensureEnrolledStudent(userId, homework.lesson.courseId);

    const existingActive = await this.prisma.homeworkAttempt.findFirst({
      where: { homeworkId, studentId: student.id, status: QuizAttemptStatus.IN_PROGRESS },
    });
    if (existingActive) {
      return this.buildStartResponse(existingActive, homework, 'Resuming active attempt.');
    }

    const submittedAttempt = await this.prisma.homeworkAttempt.findFirst({
      where: { homeworkId, studentId: student.id, status: QuizAttemptStatus.SUBMITTED },
      orderBy: { submittedAt: 'desc' },
      select: { id: true },
    });

    if (submittedAttempt) {
      throw new ForbiddenException(
        'لقد سبق أن سلّمت هذا الواجب. يمكنك الاطلاع على النتيجة فقط.',
      );
    }

    const attempt = await this.prisma.homeworkAttempt.create({
      data: {
        homeworkId,
        studentId: student.id,
        attemptNumber: 1,
        status: QuizAttemptStatus.IN_PROGRESS,
      },
    });

    return this.buildStartResponse(attempt, homework, 'Homework started successfully.');
  }

  private buildStartResponse(
    attempt: { id: string; attemptNumber: number; startedAt: Date },
    homework: {
      title: string;
      pdfUrl: string | null;
      questions: {
        id: string;
        text: string;
        options: unknown;
        marks: number;
        orderIndex: number;
        requiresImageAnswer?: boolean;
      }[];
    },
    message: string,
  ) {
    return {
      message,
      attempt: {
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        startedAt: attempt.startedAt,
      },
      quizTitle: homework.title,
      hasPdf: Boolean(homework.pdfUrl),
      questions: homework.questions.map((q) => ({
        id: q.id,
        text: q.text,
        options: q.options as string[],
        marks: q.marks,
        orderIndex: q.orderIndex,
        requiresImageAnswer: q.requiresImageAnswer ?? false,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Submit attempt
  // ─────────────────────────────────────────────────────────────
  async submitAttempt(attemptId: string, dto: SubmitHomeworkDto, userId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const attempt = await this.prisma.homeworkAttempt.findFirst({
      where: { id: attemptId, studentId: student.id },
      include: {
        homework: {
          include: {
            lesson: { select: { id: true, courseId: true } },
            questions: { where: { isDeleted: false } },
          },
        },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found or access denied.');
    if (attempt.status !== QuizAttemptStatus.IN_PROGRESS) {
      throw new ConflictException('This attempt has already been finished.');
    }

    const questionMap = new Map(attempt.homework.questions.map((q) => [q.id, q]));
    let earnedMarks = 0;
    let totalMarks = 0;

    const answerData: {
      attemptId: string;
      questionId: string;
      selectedOptionIndex: number | null;
      isCorrect: boolean;
      awardedMarks: number;
    }[] = [];

    // MCQ فقط — أسئلة الصور تُحفظ مسبقاً عبر uploadAnswerImage
    for (const a of dto.answers) {
      const q = questionMap.get(a.questionId);
      if (!q || q.requiresImageAnswer) continue;

      totalMarks += q.marks;
      const isCorrect = a.selectedOptionIndex === q.correctOptionIndex;
      const awardedMarks = isCorrect ? q.marks : 0;
      earnedMarks += awardedMarks;
      answerData.push({
        attemptId,
        questionId: q.id,
        selectedOptionIndex: a.selectedOptionIndex ?? null,
        isCorrect,
        awardedMarks,
      });
    }

    // إضافة الأسئلة غير المجاب عليها (MCQ فقط)
    const answeredIds = new Set(answerData.map((a) => a.questionId));
    for (const q of attempt.homework.questions) {
      if (!answeredIds.has(q.id) && !q.requiresImageAnswer) totalMarks += q.marks;
    }

    // إضافة درجات أسئلة الصور للـ totalMarks
    for (const q of attempt.homework.questions) {
      if (q.requiresImageAnswer) totalMarks += q.marks;
    }

    const scorePct = totalMarks > 0 ? Math.round((earnedMarks / totalMarks) * 100) : 0;
    const isPassed = scorePct >= attempt.homework.passingPercentage;
    const now = new Date();
    const hasEssayQuestions = attempt.homework.questions.some((q) => q.requiresImageAnswer);

    await this.prisma.$transaction([
      this.prisma.homeworkAttempt.update({
        where: { id: attemptId },
        data: {
          status: QuizAttemptStatus.SUBMITTED,
          submittedAt: now,
          score: scorePct,
          earnedMarks,
          totalMarks,
          isPassed,
        },
      }),
      this.prisma.homeworkAnswer.createMany({ data: answerData, skipDuplicates: true }),
    ]);

    await this.notificationsService
      .notify({
        userId,
        type: 'HOMEWORK_RESULT',
        title: isPassed ? 'مبروك! نجحت في الواجب' : 'نتيجة الواجب',
        body: `واجب "${attempt.homework.title}": نتيجتك ${scorePct}%.`,
        linkUrl: `/courses/${attempt.homework.lesson.courseId}/learn?lesson=${attempt.homework.lessonId}`,
      })
      .catch(() => undefined);

    // تنبيه الأستاذ عند تسليم الطالب للواجب (خاصة إن كان فيه أسئلة مراجعة)
    try {
      const course = await this.prisma.course.findUnique({
        where: { id: attempt.homework.lesson.courseId },
        select: { teacherId: true },
      });
      if (course) {
        const teacherProfile = await this.prisma.teacherProfile.findUnique({
          where: { id: course.teacherId },
          select: { userId: true },
        });
        if (teacherProfile) {
          await this.notificationsService.notify({
            userId: teacherProfile.userId,
            type: 'HOMEWORK_SUBMITTED',
            title: 'واجب جديد بانتظار المراجعة',
            body: `الطالب سلّم واجب «${attempt.homework.title}»${hasEssayQuestions ? ' ويحتاج مراجعة أسئلة الصور.' : '.'}`,
            linkUrl: `/dashboard/homework/${attempt.homework.id}/submissions`,
          });
        }
      }
    } catch {
      /* التنبيه لا يجب أن يكسر تدفق التسليم */
    }

    // Coins (fire-and-forget)
    if (isPassed) {
      await this.coinsService.addCoins(
        student.id,
        50,
        'EARN_HOMEWORK',
        attempt.homework.id,
        `واجب "${attempt.homework.title}"`,
      );
    }

    // لو كل الأسئلة MCQ (لا يوجد أسئلة صور)، النتيجة فورية
    return {
      message: isPassed
        ? 'مبروك! تم حل الواجب بنجاح.'
        : hasEssayQuestions
          ? 'تم تسليم الواجب. سيراجع المدرس أسئلة الصور ويُعلمك بالنتيجة النهائية.'
          : 'تم تسليم الواجب.',
      score: scorePct,
      earnedMarks,
      totalMarks,
      passingPercentage: attempt.homework.passingPercentage,
      isPassed,
      submittedAt: now.toISOString(),
      hasEssayQuestions,
      attemptId,
      modelAnswers: [...attempt.homework.questions]
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((q) => ({
          questionId: q.id,
          text: q.text,
          options: q.options as string[],
          correctOptionIndex: q.correctOptionIndex,
          explanation: q.explanation,
          requiresImageAnswer: q.requiresImageAnswer,
          yourAnswer: answerData.find((a) => a.questionId === q.id)?.selectedOptionIndex ?? null,
          isCorrect: answerData.find((a) => a.questionId === q.id)?.isCorrect ?? false,
        })),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Upload an image answer for one question (during attempt)
  // ─────────────────────────────────────────────────────────────
  async uploadAnswerImage(
    attemptId: string,
    questionId: string,
    file: Express.Multer.File | undefined,
    userId: string,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('Image file is required.');
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('يُسمح بصور JPG أو PNG أو WEBP فقط.');
    }
    if (file.buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('حجم الصورة يجب أن يكون 10MB أو أقل.');
    }

    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const attempt = await this.prisma.homeworkAttempt.findFirst({
      where: { id: attemptId, studentId: student.id },
    });
    if (!attempt) throw new NotFoundException('Attempt not found or access denied.');
    if (attempt.status !== QuizAttemptStatus.IN_PROGRESS) {
      throw new ConflictException('This attempt has already been finished.');
    }

    const question = await this.prisma.homeworkQuestion.findFirst({
      where: { id: questionId, homeworkId: attempt.homeworkId, isDeleted: false },
    });
    if (!question) throw new NotFoundException('Question not found in this homework.');
    if (!question.requiresImageAnswer) {
      throw new BadRequestException('هذا السؤال لا يقبل إجابة بصورة.');
    }

    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/heic': '.heic',
      'image/heif': '.heif',
    };
    const ext = extMap[file.mimetype] || '.jpg';
    const uniqueFileName = `${crypto.randomUUID()}${ext}`;
    const folder = `homework-attempts/${attemptId}`;

    const key = await this.storageService.uploadFile(
      { originalname: uniqueFileName, buffer: file.buffer, mimetype: file.mimetype },
      folder,
    );
    const imageUrl = typeof key === 'string' ? key : (key as any)?.key ?? String(key);

    await this.prisma.homeworkAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      create: {
        attemptId,
        questionId,
        selectedOptionIndex: null,
        imageUrl,
        isCorrect: false,
        awardedMarks: 0,
      },
      update: { imageUrl },
    });

    return { message: 'تم رفع صورة الإجابة بنجاح.', imageUrl };
  }

  // ─────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────
  private async ensureCanManageCourse(courseId: string, user: AuthUser) {
    const hasAccess = await canManageCourse(this.prisma, user.id, courseId, user.role);
    if (!hasAccess) {
      throw new ForbiddenException('Access denied. You do not own this course.');
    }
  }

  private async findHomeworkAsOwner(homeworkId: string, user: AuthUser) {
    const homework = await this.prisma.homework.findFirst({
      where: { id: homeworkId, isDeleted: false },
      include: { lesson: { select: { courseId: true } } },
    });
    if (!homework) throw new NotFoundException('Homework not found.');
    await this.ensureCanManageCourse(homework.lesson.courseId, user);
    return homework;
  }

  /**
   * Student: every homework attempt they have, enriched with question
   * counts / answered count / score so the "نتائج الواجبات" page can show
   * a full history without N extra calls.
   */
  async getStudentResults(userId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const attempts = await this.prisma.homeworkAttempt.findMany({
      where: { studentId: student.id },
      orderBy: [{ submittedAt: 'desc' }, { startedAt: 'desc' }],
      include: {
        homework: {
          select: {
            id: true,
            title: true,
            questions: { where: { isDeleted: false }, select: { id: true, requiresImageAnswer: true } },
            lesson: { select: { id: true, title: true, course: { select: { id: true, title: true } } } },
          },
        },
        answers: {
          select: {
            isCorrect: true,
            teacherGrade: true,
            question: { select: { requiresImageAnswer: true } },
          },
        },
      },
    });

    const results = attempts.map((a) => ({
      homeworkId: a.homework.id,
      title: a.homework.title,
      lessonTitle: a.homework.lesson.title,
      lessonId: a.homework.lesson.id,
      courseId: a.homework.lesson.course.id,
      courseTitle: a.homework.lesson.course.title,
      attemptId: a.id,
      attemptNumber: a.attemptNumber,
      startedAt: a.startedAt,
      status: a.status,
      score: a.score,
      earnedMarks: a.earnedMarks,
      totalMarks: a.totalMarks,
      isPassed: a.isPassed,
      submittedAt: a.submittedAt,
      questionsCount: a.homework.questions.length,
      answeredCount: a.answers.length,
      correctCount: a.answers.filter((ans) => ans.isCorrect).length,
      essayPendingCount: a.answers.filter(
        (ans) => ans.question.requiresImageAnswer && ans.teacherGrade === null,
      ).length,
    }));

    return { results };
  }

  private async ensureStudent(userId: string, lessonId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { courseId: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found.');

    const enrolled = await this.prisma.enrollment.findFirst({
      where: { studentId: student.id, courseId: lesson.courseId, status: 'ACTIVE' },
    });
    if (!enrolled) throw new ForbiddenException('Not enrolled in this course.');

    return student;
  }

  private async ensureEnrolledStudent(userId: string, courseId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const enrolled = await this.prisma.enrollment.findFirst({
      where: { studentId: student.id, courseId, status: 'ACTIVE' },
    });
    if (!enrolled) throw new ForbiddenException('Not enrolled in this course.');

    return student;
  }
}
