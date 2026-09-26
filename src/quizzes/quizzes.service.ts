import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnrollmentStatus, QuizAttemptStatus, Role } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GamificationService } from '../gamification/gamification.service';
import { CoinsService } from '../coins/coins.service';
import { canManageCourse } from '../common/utils/course-access.util';
import { PdfGeneratorService } from '../shared/pdf/pdf-generator.service';
import {
  QuizResultQuestion,
  buildQuizResultHtml,
} from '../shared/pdf/templates/quiz-result.template';
import {
  CreateQuizDto,
  UpdateQuizDto,
  UpdateQuizQuestionDto,
  SubmitQuizDto,
} from './dtos/quiz.dtos';

interface AuthUser {
  id: string;
  role: Role;
}

@Injectable()
export class QuizzesService {
  private readonly logger = new Logger(QuizzesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly gamificationService: GamificationService,
    private readonly coinsService: CoinsService,
    private readonly pdfGenerator: PdfGeneratorService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Create quiz for a lesson
  // ─────────────────────────────────────────────────────────────
  async createQuiz(lessonId: string, dto: CreateQuizDto, user: AuthUser) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, isDeleted: false },
      select: { id: true, courseId: true, title: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found.');

    await this.ensureCanManageCourse(lesson.courseId, user);

    if (dto.questions?.length) {
      for (const q of dto.questions) {
        if (q.correctOptionIndex >= q.options.length) {
          throw new BadRequestException(
            `correctOptionIndex (${q.correctOptionIndex}) exceeds the number of options (${q.options.length}).`,
          );
        }
      }
    }

    const quiz = await this.prisma.quiz.create({
      data: {
        lessonId,
        title: dto.title,
        passingPercentage: dto.passingPercentage ?? 50,
        timeLimitMinutes: dto.timeLimitMinutes ?? null,
        maxAttempts: dto.maxAttempts ?? 3,
        isPublished: dto.isPublished ?? false,
        ...(dto.questions?.length && {
          questions: {
            create: dto.questions.map((q, idx) => ({
              text: q.text,
              options: q.options,
              correctOptionIndex: q.correctOptionIndex,
              explanation: q.explanation ?? null,
              marks: q.marks ?? 1,
              orderIndex: q.orderIndex ?? idx + 1,
            })),
          },
        }),
      },
      include: { questions: { where: { isDeleted: false }, orderBy: { orderIndex: 'asc' } } },
    });

    // Notify enrolled students when a published quiz is added
    if (quiz.isPublished) {
      const course = await this.prisma.course.findUnique({
        where: { id: lesson.courseId },
        select: { title: true },
      });
      this.notificationsService
        .notifyEnrolledStudents(lesson.courseId, {
          type: 'QUIZ_NEW',
          title: 'كويز جديد',
          body: `تم إضافة كويز جديد "${quiz.title}" للدرس "${lesson.title}" في كورس "${course?.title ?? ''}".`,
          linkUrl: `/courses/${lesson.courseId}/learn?lesson=${lessonId}`,
        })
        .catch(() => undefined);
    }

    return { message: 'Quiz created successfully.', quiz };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Update / Delete quiz
  // ─────────────────────────────────────────────────────────────
  async updateQuiz(quizId: string, dto: UpdateQuizDto, user: AuthUser) {
    const quiz = await this.findQuizAsOwner(quizId, user);
    void quiz;

    const updated = await this.prisma.quiz.update({
      where: { id: quizId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.passingPercentage !== undefined && { passingPercentage: dto.passingPercentage }),
        ...(dto.timeLimitMinutes !== undefined && { timeLimitMinutes: dto.timeLimitMinutes }),
        ...(dto.maxAttempts !== undefined && { maxAttempts: dto.maxAttempts }),
        ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
      },
    });

    return { message: 'Quiz updated successfully.', quiz: updated };
  }

  async deleteQuiz(quizId: string, user: AuthUser) {
    const quiz = await this.findQuizAsOwner(quizId, user);
    await this.prisma.quiz.update({ where: { id: quizId }, data: { isDeleted: true } });

    // إشعار الطلاب المشتركين بإلغاء الكويز
    const full = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        title: true,
        lesson: { select: { title: true, courseId: true } },
      },
    });
    if (full) {
      const course = await this.prisma.course.findUnique({
        where: { id: full.lesson.courseId },
        select: { title: true },
      });
      this.notificationsService
        .notifyEnrolledStudents(full.lesson.courseId, {
          type: 'QUIZ_CANCELLED',
          title: 'تم إلغاء كويز',
          body: `تم إلغاء كويز "${full.title}" للدرس "${full.lesson.title}" في كورس "${course?.title ?? ''}".`,
          linkUrl: `/courses/${full.lesson.courseId}/learn?lesson=${quiz.lessonId}`,
        })
        .catch(() => undefined);
    }

    return { message: 'Quiz deleted successfully.' };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Add / update / delete question
  // ─────────────────────────────────────────────────────────────
  async addQuestion(quizId: string, dto: { text: string; options: string[]; correctOptionIndex: number; explanation?: string; marks?: number; orderIndex?: number }, user: AuthUser) {
    await this.findQuizAsOwner(quizId, user);

    if (dto.correctOptionIndex >= dto.options.length) {
      throw new BadRequestException(
        `correctOptionIndex (${dto.correctOptionIndex}) exceeds the number of options (${dto.options.length}).`,
      );
    }

    const last = await this.prisma.quizQuestion.findFirst({
      where: { quizId, isDeleted: false },
      orderBy: { orderIndex: 'desc' },
    });
    const orderIndex = dto.orderIndex ?? (last ? last.orderIndex + 1 : 1);

    const question = await this.prisma.quizQuestion.create({
      data: {
        quizId,
        text: dto.text,
        options: dto.options,
        correctOptionIndex: dto.correctOptionIndex,
        explanation: dto.explanation ?? null,
        marks: dto.marks ?? 1,
        orderIndex,
      },
    });

    return { message: 'Question added successfully.', question };
  }

  async updateQuestion(questionId: string, dto: UpdateQuizQuestionDto, user: AuthUser) {
    const question = await this.prisma.quizQuestion.findFirst({
      where: { id: questionId, isDeleted: false },
      include: { quiz: { select: { id: true } } },
    });
    if (!question) throw new NotFoundException('Question not found.');

    await this.findQuizAsOwner(question.quiz.id, user);

    const options = dto.options ?? (question.options as string[]);
    const correctIdx = dto.correctOptionIndex ?? question.correctOptionIndex;
    if (correctIdx >= options.length) {
      throw new BadRequestException(
        `correctOptionIndex (${correctIdx}) exceeds the number of options (${options.length}).`,
      );
    }

    const updated = await this.prisma.quizQuestion.update({
      where: { id: questionId },
      data: {
        ...(dto.text !== undefined && { text: dto.text }),
        ...(dto.options !== undefined && { options: dto.options }),
        ...(dto.correctOptionIndex !== undefined && { correctOptionIndex: dto.correctOptionIndex }),
        ...(dto.explanation !== undefined && { explanation: dto.explanation }),
        ...(dto.marks !== undefined && { marks: dto.marks }),
        ...(dto.orderIndex !== undefined && { orderIndex: dto.orderIndex }),
      },
    });

    return { message: 'Question updated successfully.', question: updated };
  }

  async deleteQuestion(questionId: string, user: AuthUser) {
    const question = await this.prisma.quizQuestion.findFirst({
      where: { id: questionId, isDeleted: false },
      include: { quiz: { select: { id: true } } },
    });
    if (!question) throw new NotFoundException('Question not found.');

    await this.findQuizAsOwner(question.quiz.id, user);
    await this.prisma.quizQuestion.update({
      where: { id: questionId },
      data: { isDeleted: true },
    });
    return { message: 'Question deleted successfully.' };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Get One Quiz Attempt Detail (Full Answer Sheet)
  // ─────────────────────────────────────────────────────────────
  async getTeacherAttemptDetail(attemptId: string, user: AuthUser) {
    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: {
        quiz: {
          select: {
            id: true,
            title: true,
            passingPercentage: true,
            lesson: { select: { title: true, courseId: true } },
          },
        },
        student: { select: { fullName: true, gradeLevel: true } },
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
              },
            },
          },
          orderBy: { question: { orderIndex: 'asc' } },
        },
      },
    });

    if (!attempt) throw new NotFoundException('Attempt not found.');

    await this.ensureCanManageCourse(attempt.quiz.lesson.courseId, user);

    return attempt;
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: List quizzes of a lesson (full questions)
  // ─────────────────────────────────────────────────────────────
  async getLessonQuizzesForTeacher(lessonId: string, user: AuthUser) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, isDeleted: false },
      select: { id: true, courseId: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found.');

    await this.ensureCanManageCourse(lesson.courseId, user);

    const quizzes = await this.prisma.quiz.findMany({
      where: { lessonId, isDeleted: false },
      include: {
        questions: {
          where: { isDeleted: false },
          orderBy: { orderIndex: 'asc' },
        },
        _count: { select: { attempts: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return { quizzes };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Get published quiz for lesson + attempt status
  // ─────────────────────────────────────────────────────────────
  async getLessonQuiz(lessonId: string, userId: string) {
    const student = await this.ensureStudent(userId, lessonId);

    const quiz = await this.prisma.quiz.findFirst({
      where: { lessonId, isPublished: true, isDeleted: false },
      include: {
        questions: {
          where: { isDeleted: false },
          orderBy: { orderIndex: 'asc' },
          select: { id: true },
        },
      },
    });

    if (!quiz) return { hasQuiz: false };

    const existingAttempt = await this.prisma.quizAttempt.findUnique({
      where: { quizId_studentId: { quizId: quiz.id, studentId: student.id } },
      select: {
        id: true,
        attemptNumber: true,
        score: true,
        earnedMarks: true,
        totalMarks: true,
        isPassed: true,
        status: true,
        startedAt: true,
        submittedAt: true,
        expiresAt: true,
      },
    });

    const MAX_ALLOWED_ATTEMPTS = 3;
    const COOLDOWN_HOURS = 24;
    const now = new Date();

    let action: 'start' | 'resume' | 'view_result' | 'cooldown_wait' | 'locked_exhausted' = 'start';
    let cooldownRemainingSeconds = 0;
    let canRetryAt: string | null = null;
    let message: string | null = null;

    if (existingAttempt) {
      if (existingAttempt.status === QuizAttemptStatus.IN_PROGRESS) {
        if (quiz.timeLimitMinutes && existingAttempt.expiresAt && now > existingAttempt.expiresAt) {
          await this.expireAttempt(existingAttempt.id);
          action = 'view_result';
        } else {
          action = 'resume';
        }
      } else if (
        existingAttempt.status === QuizAttemptStatus.SUBMITTED ||
        existingAttempt.status === QuizAttemptStatus.EXPIRED
      ) {
        if (existingAttempt.isPassed) {
          action = 'view_result';
          message = 'لقد اجتزت الكويز بنجاح! يمكنك مراجعة النتيجة والإجابات النموذجية.';
        } else {
          // Failed attempt (< 50%)
          if (existingAttempt.attemptNumber >= MAX_ALLOWED_ATTEMPTS) {
            action = 'locked_exhausted';
            message = 'لقد استنفدت جميع المحاولات (3 محاولات). يرجى مراجعة المعلم لتنشيط المحاولة لك.';
          } else {
            // Check 24-hour cooldown from last submittedAt
            const lastSubmitted = existingAttempt.submittedAt || existingAttempt.startedAt;
            const cooldownEndTime = new Date(lastSubmitted.getTime() + COOLDOWN_HOURS * 60 * 60 * 1000);

            if (now < cooldownEndTime) {
              action = 'cooldown_wait';
              cooldownRemainingSeconds = Math.max(0, Math.ceil((cooldownEndTime.getTime() - now.getTime()) / 1000));
              canRetryAt = cooldownEndTime.toISOString();
              message = `لم تجتز الكويز. يمكنك إعادة المحاولة (المحاولة ${existingAttempt.attemptNumber + 1} من 3) بعد انتهاء فترة الـ 24 ساعة.`;
            } else {
              action = 'start';
              message = `يمكنك الآن بدء المحاولة رقم ${existingAttempt.attemptNumber + 1} من 3.`;
            }
          }
        }
      }
    }

    return {
      hasQuiz: true,
      action,
      cooldownRemainingSeconds,
      canRetryAt,
      message,
      maxAttempts: MAX_ALLOWED_ATTEMPTS,
      attemptNumber: existingAttempt?.attemptNumber ?? 0,
      isPassed: existingAttempt?.isPassed ?? false,
      quiz: {
        id: quiz.id,
        title: quiz.title,
        questionCount: quiz.questions.length,
        timeLimitMinutes: quiz.timeLimitMinutes,
        passingPercentage: quiz.passingPercentage,
      },
      attempt: existingAttempt ?? null,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Start attempt (enforcing pass-lock & 24h cooldown)
  // ─────────────────────────────────────────────────────────────
  async startAttempt(quizId: string, userId: string) {
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: quizId, isPublished: true, isDeleted: false },
      include: {
        lesson: { select: { courseId: true } },
        questions: {
          where: { isDeleted: false },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });
    if (!quiz) throw new NotFoundException('Quiz not found or not published.');

    const student = await this.ensureEnrolledStudent(userId, quiz.lesson.courseId);

    const existingAttempt = await this.prisma.quizAttempt.findUnique({
      where: { quizId_studentId: { quizId, studentId: student.id } },
    });

    const MAX_ALLOWED_ATTEMPTS = 3;
    const COOLDOWN_HOURS = 24;
    const now = new Date();

    if (existingAttempt) {
      if (existingAttempt.status === QuizAttemptStatus.IN_PROGRESS) {
        if (quiz.timeLimitMinutes && existingAttempt.expiresAt && now > existingAttempt.expiresAt) {
          await this.expireAttempt(existingAttempt.id);
          return {
            action: 'view_result',
            attemptId: existingAttempt.id,
            message: 'انتهى وقت الكويز. يمكنك الاطلاع على النتيجة.',
          };
        }
        return this.buildStartResponse(existingAttempt, quiz, 'Resuming active attempt.', 'resume');
      }

      if (
        existingAttempt.status === QuizAttemptStatus.SUBMITTED ||
        existingAttempt.status === QuizAttemptStatus.EXPIRED
      ) {
        // If already passed, permanently forbid retake
        if (existingAttempt.isPassed) {
          return {
            action: 'view_result',
            attemptId: existingAttempt.id,
            message: 'لقد اجتزت هذا الكويز بنجاح بالفعل. يمكنك الاطلاع على النتيجة فقط.',
          };
        }

        // If failed and attempts >= 3, lock
        if (existingAttempt.attemptNumber >= MAX_ALLOWED_ATTEMPTS) {
          throw new ForbiddenException(
            'لقد استنفدت جميع المحاولات المتاحة (3 محاولات). يرجى مراجعة معلم الكورس لتنشيط المحاولة لك.',
          );
        }

        // Check 24h cooldown
        const lastSubmitted = existingAttempt.submittedAt || existingAttempt.startedAt;
        const cooldownEndTime = new Date(lastSubmitted.getTime() + COOLDOWN_HOURS * 60 * 60 * 1000);
        if (now < cooldownEndTime) {
          const remainingMinutes = Math.ceil((cooldownEndTime.getTime() - now.getTime()) / (1000 * 60));
          throw new ForbiddenException(
            `يجب الانتظار 24 ساعة بين المحاولات. الوقت المتبقي: ${remainingMinutes} دقيقة تقريباً.`,
          );
        }

        // Reset and reuse attempt row for retry
        const expiresAt = quiz.timeLimitMinutes
          ? new Date(now.getTime() + quiz.timeLimitMinutes * 60 * 1000)
          : null;

        await this.prisma.quizAttemptAnswer.deleteMany({
          where: { attemptId: existingAttempt.id },
        });

        const updatedAttempt = await this.prisma.quizAttempt.update({
          where: { id: existingAttempt.id },
          data: {
            attemptNumber: existingAttempt.attemptNumber + 1,
            startedAt: now,
            expiresAt,
            submittedAt: null,
            score: null,
            earnedMarks: null,
            totalMarks: null,
            isPassed: null,
            status: QuizAttemptStatus.IN_PROGRESS,
          },
        });

        return this.buildStartResponse(
          updatedAttempt,
          quiz,
          `بدء المحاولة رقم ${updatedAttempt.attemptNumber}.`,
          'start',
        );
      }
    }

    // No previous attempt — start fresh (attempt #1)
    const expiresAt = quiz.timeLimitMinutes
      ? new Date(now.getTime() + quiz.timeLimitMinutes * 60 * 1000)
      : null;

    const attempt = await this.prisma.quizAttempt.create({
      data: {
        quizId,
        studentId: student.id,
        attemptNumber: 1,
        startedAt: now,
        expiresAt,
        status: QuizAttemptStatus.IN_PROGRESS,
      },
    });

    return this.buildStartResponse(attempt, quiz, 'Quiz started successfully.', 'start');
  }

  private buildStartResponse(
    attempt: { id: string; attemptNumber: number; expiresAt: Date | null; startedAt: Date },
    quiz: {
      timeLimitMinutes: number | null;
      title: string;
      questions: { id: string; text: string; options: unknown; marks: number }[];
    },
    message: string,
    action: 'start' | 'resume' = 'start',
  ) {
    const now = new Date();
    return {
      action,
      message,
      attempt: {
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        startedAt: attempt.startedAt,
        expiresAt: attempt.expiresAt,
        timeRemainingSeconds: attempt.expiresAt
          ? Math.max(0, Math.floor((attempt.expiresAt.getTime() - now.getTime()) / 1000))
          : null,
      },
      quizTitle: quiz.title,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        text: q.text,
        options: q.options,
        marks: q.marks,
        // correctOptionIndex and explanation intentionally omitted (anti-cheat)
      })),
      serverTime: now.toISOString(),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Submit attempt — server-side grading only
  // ─────────────────────────────────────────────────────────────
  async submitAttempt(attemptId: string, dto: SubmitQuizDto, userId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const attempt = await this.prisma.quizAttempt.findFirst({
      where: { id: attemptId, studentId: student.id },
      include: {
        quiz: {
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
    const quizCourseId = attempt.quiz.lesson.courseId;

    const now = new Date();
    const isExpired = attempt.expiresAt && now > attempt.expiresAt;
    if (isExpired) {
      await this.expireAttempt(attempt.id);
      throw new ForbiddenException('Quiz time has expired. The attempt was closed automatically.');
    }

    const questionMap = new Map(attempt.quiz.questions.map((q) => [q.id, q]));
    let earnedMarks = 0;
    let totalMarks = 0;

    const answerData = dto.answers
      .filter((a) => questionMap.has(a.questionId))
      .map((a) => {
        const q = questionMap.get(a.questionId)!;
        totalMarks += q.marks;
        const isCorrect = a.selectedOptionIndex === q.correctOptionIndex;
        const awardedMarks = isCorrect ? q.marks : 0;
        earnedMarks += awardedMarks;
        return {
          attemptId,
          questionId: a.questionId,
          selectedOptionIndex: a.selectedOptionIndex,
          isCorrect,
          awardedMarks,
        };
      });

    // Count full marks for unanswered questions too
    const answeredIds = new Set(answerData.map((a) => a.questionId));
    for (const q of attempt.quiz.questions) {
      if (!answeredIds.has(q.id)) totalMarks += q.marks;
    }

    const scorePct = totalMarks > 0 ? Math.round((earnedMarks / totalMarks) * 100) : 0;
    const isPassed = scorePct >= attempt.quiz.passingPercentage;

    await this.prisma.$transaction([
      this.prisma.quizAttempt.update({
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
      this.prisma.quizAttemptAnswer.createMany({ data: answerData, skipDuplicates: true }),
    ]);

    // إشعار الطالب بنتيجة الكويز
    await this.notificationsService
      .notify({
        userId,
        type: 'QUIZ_RESULT',
        title: isPassed ? 'مبروك! نجحت في الكويز' : 'نتيجة الكويز',
        body: `كويز "${attempt.quiz.title}": نتيجتك ${scorePct}%.`,
        linkUrl: `/courses/${quizCourseId}/learn?lesson=${attempt.quiz.lessonId}`,
      })
      .catch(() => undefined);

    // Gamification: daily streak
    await this.gamificationService.recordActivity(student.id);

    // Coins (fire-and-forget)
    if (isPassed) {
      const isExcellent = scorePct >= 90;
      await this.coinsService.addCoins(
        student.id,
        isExcellent ? 100 : 50,
        'EARN_QUIZ',
        attempt.quiz.id,
        `كويز "${attempt.quiz.title}"`,
      );
    }

    return {
      message: isPassed
        ? 'مبروك! لقد نجحت في الكويز.'
        : 'تم تسليم الكويز. حاول مرة أخرى لتحسين نتيجتك.',
      score: scorePct,
      earnedMarks,
      totalMarks,
      passingPercentage: attempt.quiz.passingPercentage,
      isPassed,
      submittedAt: now.toISOString(),
      modelAnswers: attempt.quiz.questions.map((q) => ({
        questionId: q.id,
        text: q.text,
        options: q.options,
        correctOptionIndex: q.correctOptionIndex,
        explanation: q.explanation,
        yourAnswer: answerData.find((a) => a.questionId === q.id)?.selectedOptionIndex ?? null,
        isCorrect: answerData.find((a) => a.questionId === q.id)?.isCorrect ?? false,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Attempt result
  // ─────────────────────────────────────────────────────────────
  async getAttemptResult(attemptId: string, userId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const attempt = await this.prisma.quizAttempt.findFirst({
      where: { id: attemptId, studentId: student.id },
      include: {
        quiz: { select: { title: true, passingPercentage: true } },
        answers: {
          include: {
            question: { select: { text: true, options: true, correctOptionIndex: true, explanation: true, marks: true } },
          },
        },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found or access denied.');
    if (attempt.status === QuizAttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('This attempt is still in progress. Submit it first.');
    }

    return {
      attemptId: attempt.id,
      quizTitle: attempt.quiz.title,
      score: attempt.score,
      earnedMarks: attempt.earnedMarks,
      totalMarks: attempt.totalMarks,
      passingPercentage: attempt.quiz.passingPercentage,
      isPassed: attempt.isPassed,
      status: attempt.status,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      answers: attempt.answers.map((a) => ({
        questionId: a.questionId,
        text: a.question.text,
        options: a.question.options,
        yourAnswer: a.selectedOptionIndex,
        correctAnswer: a.question.correctOptionIndex,
        explanation: a.question.explanation,
        isCorrect: a.isCorrect,
      })),
    };
  }

  /** STUDENT/TEACHER/PARENT: Download the full result review of a quiz attempt as PDF. */
  async generateResultPdf(
    attemptId: string,
    user: AuthUser & { phone?: string },
  ): Promise<{ buffer: Buffer; fileName: string }> {
    // ولي الأمر يُسمح له بتحميل ورقة نتيجة كويز ابنه فقط
    if (user.role === 'PARENT') {
      const owner = await this.prisma.quizAttempt.findFirst({
        where: { id: attemptId },
        select: { student: { select: { id: true, fullName: true, guardianPhone: true } } },
      });
      if (!owner || !user.phone || owner.student.guardianPhone !== user.phone) {
        throw new ForbiddenException('غير مصرح لك بالوصول إلى ورقة هذا الطالب.');
      }
      return this.buildQuizResultPdf(attemptId, owner.student);
    }

    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      include: { user: true },
    });
    if (!student) throw new ForbiddenException('Student profile not found.');

    return this.buildQuizResultPdf(attemptId, student);
  }

  private async buildQuizResultPdf(
    attemptId: string,
    student: { id: string; fullName: string },
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const attempt = await this.prisma.quizAttempt.findFirst({
      where: { id: attemptId, studentId: student.id },
      include: {
        quiz: {
          select: {
            title: true,
            passingPercentage: true,
            isPublished: true,
            lesson: {
              select: {
                title: true,
                course: { select: { id: true, title: true } },
              },
            },
          },
        },
        answers: {
          include: {
            question: {
              select: {
                text: true,
                options: true,
                correctOptionIndex: true,
                explanation: true,
                marks: true,
              },
            },
          },
        },
      },
    });

    if (!attempt) throw new NotFoundException('Attempt not found.');
    if (attempt.status === QuizAttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('Quiz is still in progress. Submit it first.');
    }

    const totalMarks = attempt.totalMarks ?? 0;
    const score = attempt.earnedMarks ?? 0;
    const percentage =
      totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0;

    const questions: QuizResultQuestion[] = attempt.answers.map((a, idx) => ({
      index: idx,
      text: a.question.text ?? '',
      marks: a.question.marks ?? 0,
      options: Array.isArray(a.question.options)
        ? (a.question.options as string[])
        : [],
      selectedIndex: a.selectedOptionIndex,
      correctIndex: a.question.correctOptionIndex,
      isCorrect: a.isCorrect,
      awardedMarks: a.awardedMarks ?? 0,
      explanation: a.question.explanation,
    }));

    const fontFaceCss = this.pdfGenerator.getEmbeddedFontFace(
      'Amiri',
      'Amiri-Regular.ttf',
    );

    const html = buildQuizResultHtml(
      {
        studentName: student.fullName,
        quizTitle: attempt.quiz.title,
        courseTitle: attempt.quiz.lesson.course.title,
        lessonTitle: attempt.quiz.lesson.title,
        submittedAt: attempt.submittedAt,
        score,
        totalMarks,
        passingPercentage: attempt.quiz.passingPercentage,
        percentage,
        isPassed: Boolean(attempt.isPassed),
        showCorrectAnswers: true,
        questions,
      },
      fontFaceCss,
    );

    const buffer = await this.pdfGenerator.htmlToPdf(html);

    const fileName = `نتيجة-كويز-${attempt.quiz.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 40)}.pdf`;
    return { buffer, fileName };
  }

  // ─────────────────────────────────────────────────────────────
  // CRON: Expire stale in-progress timed attempts
  // ─────────────────────────────────────────────────────────────
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireTimedOutQuizAttempts() {
    const expired = await this.prisma.quizAttempt.findMany({
      where: {
        status: QuizAttemptStatus.IN_PROGRESS,
        expiresAt: { lt: new Date() },
      },
      select: { id: true },
    });
    for (const a of expired) {
      await this.expireAttempt(a.id);
    }
    if (expired.length > 0) {
      this.logger.warn(`⏰ Auto-expired ${expired.length} quiz attempt(s).`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────
  private async expireAttempt(attemptId: string) {
    await this.prisma.quizAttempt.update({
      where: { id: attemptId },
      data: { status: QuizAttemptStatus.EXPIRED, submittedAt: new Date(), isPassed: false },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Reactivate a student's quiz attempt (reset locks / attempts)
  // ─────────────────────────────────────────────────────────────
  async reactivateStudentQuizAttempt(quizId: string, studentId: string, user: AuthUser) {
    const quiz = await this.findQuizAsOwner(quizId, user);

    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { quizId_studentId: { quizId, studentId } },
      include: {
        student: { select: { userId: true, fullName: true } },
      },
    });

    if (!attempt) {
      throw new NotFoundException('لا توجد محاولة سابقة لهذا الطالب على هذا الكويز.');
    }

    // Delete existing answers and remove attempt row so student starts completely fresh
    await this.prisma.quizAttemptAnswer.deleteMany({
      where: { attemptId: attempt.id },
    });

    await this.prisma.quizAttempt.delete({
      where: { id: attempt.id },
    });

    // Notify student that teacher reactivated the quiz
    await this.notificationsService.notify({
      userId: attempt.student.userId,
      type: 'QUIZ_NEW',
      title: '🔄 تم تنشيط محاولة الكويز',
      body: `قام المعلم بتنشيط محاولة كويز "${quiz.title}" لك. يمكنك الآن إعادة المحاولة فوراً!`,
      linkUrl: `/courses/${quiz.lesson.courseId}/learn?lesson=${quiz.lessonId}`,
    }).catch(() => undefined);

    return {
      message: `تم تنشيط محاولة الكويز بنجاح للطالب ${attempt.student.fullName}.`,
    };
  }

  private async ensureCanManageCourse(courseId: string, user: AuthUser) {
    const hasAccess = await canManageCourse(this.prisma, user.id, courseId, user.role);
    if (!hasAccess) {
      throw new ForbiddenException('Access denied. You do not own this course.');
    }
  }

  private async findQuizAsOwner(quizId: string, user: AuthUser) {
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: quizId, isDeleted: false },
      include: {
        lesson: { select: { courseId: true } },
      },
    });
    if (!quiz) throw new NotFoundException('Quiz not found.');

    if (user.role === Role.ADMIN) return quiz;
    await this.ensureCanManageCourse(quiz.lesson.courseId, user);
    return quiz;
  }

  private async ensureStudent(userId: string, lessonId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, isDeleted: false },
      select: { id: true, courseId: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found.');

    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId: student.id, courseId: lesson.courseId },
      select: { id: true },
    });
    if (!enrollment) {
      throw new ForbiddenException('You must be enrolled in this course to view its quizzes.');
    }
    return student;
  }

  private async ensureEnrolledStudent(userId: string, courseId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId: student.id, courseId, status: EnrollmentStatus.ACTIVE },
      select: { id: true },
    });
    if (!enrollment) {
      throw new ForbiddenException('You must have an active enrollment to take this quiz.');
    }
    return student;
  }
}
