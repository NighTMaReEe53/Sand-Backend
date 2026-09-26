import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import {
  ExamAttemptStatus,
  EnrollmentStatus,
  Prisma,
  QuizAttemptStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { StorageService } from '../shared/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GamificationService } from '../gamification/gamification.service';
import { CoinsService } from '../coins/coins.service';
import { LeaderboardService } from './leaderboard.service';
import { CreateExamDto } from './dtos/create-exam.dto';
import { UpdateExamDto } from './dtos/update-exam.dto';
import { CreateQuestionDto } from './dtos/create-question.dto';
import { UpdateQuestionDto } from './dtos/update-question.dto';
import { SubmitExamDto } from './dtos/submit-exam.dto';
import { RecordExamExitDto } from './dtos/record-exam-exit.dto';
import { GenerateMistakePracticeDto, SubmitMistakePracticeDto } from './dtos/mistake-practice.dto';
import { canManageCourse } from '../common/utils/course-access.util';
import { PdfGeneratorService } from '../shared/pdf/pdf-generator.service';
import {
  buildExamResultHtml,
  ExamResultQuestion,
} from '../shared/pdf/templates/exam-result.template';

interface AuthUser {
  id: string;
  phone: string;
  role: Role;
}

const MAX_LEADERBOARD_EXITS = 2;

/** One wrongly-answered question with full review data */
export interface MistakeQuestion {
  questionId: string;
  text: string;
  imageUrl: string | null;
  options: string[];
  yourAnswerIndex: number | null;
  correctAnswerIndex: number;
  explanation: string | null;
  attemptNumber: number;
  answeredAt: Date | null;
}

/** Wrong answers grouped by section → exam/quiz/homework → date */
export interface MistakeGroup {
  id: string;
  type: 'EXAM' | 'QUIZ' | 'HOMEWORK';
  sourceId: string;
  courseId: string;
  title: string;
  courseTitle: string;
  sectionName: string | null;
  lessonTitle: string | null;
  lastDate: string | null;
  questions: MistakeQuestion[];
}

@Injectable()
export class ExamsService {
  private readonly logger = new Logger(ExamsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly notificationsService: NotificationsService,
    private readonly gamificationService: GamificationService,
    private readonly coinsService: CoinsService,
    private readonly pdfGenerator: PdfGeneratorService,
    private readonly leaderboardService: LeaderboardService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Create Exam
  // ─────────────────────────────────────────────────────────────
  async createExam(courseId: string, dto: CreateExamDto, user: AuthUser) {
    if (user.role === Role.ADMIN) {
      const course = await this.prisma.course.findFirst({
        where: { id: courseId, isDeleted: false },
      });
      if (!course) {
        throw new NotFoundException('Course not found.');
      }
    } else {
      const teacher = await this.prisma.teacherProfile.findUnique({
        where: { userId: user.id },
      });
      if (!teacher) {
        throw new NotFoundException('Teacher profile not found.');
      }

      const course = await this.prisma.course.findFirst({
        where: { id: courseId, teacherId: teacher.id, isDeleted: false },
      });
      if (!course) {
        throw new NotFoundException('Course not found or access denied.');
      }
    }

    if (dto.lessonId) {
      const lesson = await this.prisma.lesson.findFirst({
        where: { id: dto.lessonId, courseId, isDeleted: false },
      });
      if (!lesson) {
        throw new NotFoundException('Lesson not found or does not belong to this course.');
      }
    }

    if (dto.startAt && dto.endAt && new Date(dto.startAt) >= new Date(dto.endAt)) {
      throw new BadRequestException('startAt must be before endAt.');
    }

    const exam = await this.prisma.exam.create({
      data: {
        courseId,
        lessonId: dto.lessonId ?? null,
        title: dto.title,
        description: dto.description ?? null,
        durationMinutes: dto.durationMinutes,
        totalMarks: dto.totalMarks ?? 100,
        passingMarks: dto.passingMarks ?? 50,
        startAt: dto.startAt ? new Date(dto.startAt) : null,
        endAt: dto.endAt ? new Date(dto.endAt) : null,
        maxAttempts: dto.maxAttempts ?? 1,
        shuffleQuestions: dto.shuffleQuestions ?? true,
        shuffleOptions: dto.shuffleOptions ?? false,
        useQuestionBank: dto.useQuestionBank ?? false,
        bankEasyCount: dto.bankEasyCount ?? 0,
        bankMediumCount: dto.bankMediumCount ?? 0,
        bankHardCount: dto.bankHardCount ?? 0,
        showCorrectAnswersAfterSubmission: dto.showCorrectAnswersAfterSubmission ?? true,
        isPublished: dto.isPublished ?? false,
        ...(dto.questions && dto.questions.length > 0 && {
          questions: {
            create: dto.questions.map((q, idx) => ({
              text: q.text,
              imageUrl: q.imageUrl ?? null,
              options: q.options,
              correctOptionIndex: q.correctOptionIndex,
              explanation: q.explanation ?? null,
              marks: q.marks ?? 1,
              orderIndex: q.orderIndex ?? (idx + 1),
            })),
          },
        }),
      },
      include: {
        questions: {
          where: { isDeleted: false },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    // Notify students of the same stage when a published exam is added
    if (exam.isPublished) {
      const parentCourse = await this.prisma.course.findUnique({
        where: { id: courseId },
        select: { title: true },
      });
      this.notificationsService
        .notifyEnrolledStudents(courseId, {
          type: 'EXAM_NEW',
          title: 'امتحان جديد',
          body: `تم إضافة امتحان جديد "${exam.title}" في كورس "${parentCourse?.title ?? ''}".`,
          linkUrl: `/courses/${courseId}/exams`,
        })
        .catch(() => undefined);
    } else if (exam.startAt) {
      // Scheduled exam: announce it immediately so students can prepare,
      // then the auto-publish cron notifies again the moment it opens.
      const parentCourse = await this.prisma.course.findUnique({
        where: { id: courseId },
        select: { title: true },
      });
      const startsAt = new Date(exam.startAt).toLocaleString('ar-EG', {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      });
      this.notificationsService
        .notifyEnrolledStudents(courseId, {
          type: 'EXAM_NEW',
          title: 'امتحان جديد قادم',
          body: `تم جدولة امتحان "${exam.title}" في كورس "${parentCourse?.title ?? ''}" ويبدأ في ${startsAt}. استعد من الآن!`,
          linkUrl: `/courses/${courseId}/exams`,
        })
        .catch(() => undefined);
    }

    return { message: 'Exam created successfully.', exam };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Update Exam
  // ─────────────────────────────────────────────────────────────
  async updateExam(examId: string, dto: UpdateExamDto, user: AuthUser) {
    const { exam, teacherId } = await this.findExamAsTeacherOwner(examId, user);

    if (dto.lessonId) {
      const lesson = await this.prisma.lesson.findFirst({
        where: { id: dto.lessonId, courseId: exam.courseId, isDeleted: false },
      });
      if (!lesson) {
        throw new NotFoundException('Lesson not found or does not belong to this course.');
      }
    }

    if (dto.startAt && dto.endAt && new Date(dto.startAt) >= new Date(dto.endAt)) {
      throw new BadRequestException('startAt must be before endAt.');
    }

    const updated = await this.prisma.exam.update({
      where: { id: examId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.lessonId !== undefined && { lessonId: dto.lessonId }),
        ...(dto.durationMinutes !== undefined && { durationMinutes: dto.durationMinutes }),
        ...(dto.totalMarks !== undefined && { totalMarks: dto.totalMarks }),
        ...(dto.passingMarks !== undefined && { passingMarks: dto.passingMarks }),
        ...(dto.startAt !== undefined && { startAt: dto.startAt ? new Date(dto.startAt) : null }),
        ...(dto.endAt !== undefined && { endAt: dto.endAt ? new Date(dto.endAt) : null }),
        ...(dto.maxAttempts !== undefined && { maxAttempts: dto.maxAttempts }),
        ...(dto.shuffleQuestions !== undefined && { shuffleQuestions: dto.shuffleQuestions }),
        ...(dto.shuffleOptions !== undefined && { shuffleOptions: dto.shuffleOptions }),
        ...(dto.useQuestionBank !== undefined && { useQuestionBank: dto.useQuestionBank }),
        ...(dto.bankEasyCount !== undefined && { bankEasyCount: dto.bankEasyCount }),
        ...(dto.bankMediumCount !== undefined && { bankMediumCount: dto.bankMediumCount }),
        ...(dto.bankHardCount !== undefined && { bankHardCount: dto.bankHardCount }),
        ...(dto.showCorrectAnswersAfterSubmission !== undefined && {
          showCorrectAnswersAfterSubmission: dto.showCorrectAnswersAfterSubmission,
        }),
        ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
      },
    });

    return { message: 'Exam updated successfully.', exam: updated };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Delete Exam (Soft Delete)
  // ─────────────────────────────────────────────────────────────
  async deleteExam(examId: string, user: AuthUser) {
    const { exam } = await this.findExamAsTeacherOwner(examId, user);
    await this.prisma.exam.update({ where: { id: examId }, data: { isDeleted: true } });

    // إشعار الطلاب المشتركين بإلغاء الامتحان
    const course = await this.prisma.course.findUnique({
      where: { id: exam.courseId },
      select: { title: true },
    });
    this.notificationsService
      .notifyEnrolledStudents(exam.courseId, {
        type: 'EXAM_CANCELLED',
        title: 'تم إلغاء امتحان',
        body: `تم إلغاء امتحان "${exam.title}" في كورس "${course?.title ?? ''}".`,
        linkUrl: `/courses/${exam.courseId}/exams`,
      })
      .catch(() => undefined);

    return { message: 'Exam deleted successfully.' };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Add Question
  // ─────────────────────────────────────────────────────────────
  async addQuestion(examId: string, dto: CreateQuestionDto, user: AuthUser) {
    await this.findExamAsTeacherOwner(examId, user);

    const options = dto.options as string[];
    if (dto.correctOptionIndex >= options.length) {
      throw new BadRequestException(
        `correctOptionIndex (${dto.correctOptionIndex}) exceeds the number of options (${options.length}).`,
      );
    }

    // Auto-assign orderIndex if not provided
    const lastQuestion = await this.prisma.question.findFirst({
      where: { examId, isDeleted: false },
      orderBy: { orderIndex: 'desc' },
    });
    const orderIndex = dto.orderIndex ?? (lastQuestion ? lastQuestion.orderIndex + 1 : 1);

    const question = await this.prisma.question.create({
      data: {
        examId,
        text: dto.text,
        imageUrl: dto.imageUrl ?? null,
        options: options,
        correctOptionIndex: dto.correctOptionIndex,
        explanation: dto.explanation ?? null,
        marks: dto.marks ?? 1,
        orderIndex,
      },
    });

    return { message: 'Question added successfully.', question };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Update Question
  // ─────────────────────────────────────────────────────────────
  async updateQuestion(questionId: string, dto: UpdateQuestionDto, user: AuthUser) {
    const question = await this.prisma.question.findFirst({
      where: { id: questionId, isDeleted: false },
      include: { exam: true },
    });
    if (!question) {
      throw new NotFoundException('Question not found.');
    }

    await this.findExamAsTeacherOwner(question.examId, user);

    const options = dto.options ?? (question.options as string[]);
    const correctIdx = dto.correctOptionIndex ?? question.correctOptionIndex;
    if (correctIdx >= options.length) {
      throw new BadRequestException(
        `correctOptionIndex (${correctIdx}) exceeds the number of options (${options.length}).`,
      );
    }

    const updated = await this.prisma.question.update({
      where: { id: questionId },
      data: {
        ...(dto.text !== undefined && { text: dto.text }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.options !== undefined && { options: dto.options }),
        ...(dto.correctOptionIndex !== undefined && { correctOptionIndex: dto.correctOptionIndex }),
        ...(dto.explanation !== undefined && { explanation: dto.explanation }),
        ...(dto.marks !== undefined && { marks: dto.marks }),
        ...(dto.orderIndex !== undefined && { orderIndex: dto.orderIndex }),
      },
    });

    return { message: 'Question updated successfully.', question: updated };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Delete Question (Soft)
  // ─────────────────────────────────────────────────────────────
  async deleteQuestion(questionId: string, user: AuthUser) {
    const question = await this.prisma.question.findFirst({
      where: { id: questionId, isDeleted: false },
    });
    if (!question) {
      throw new NotFoundException('Question not found.');
    }
    await this.findExamAsTeacherOwner(question.examId, user);
    await this.prisma.question.update({ where: { id: questionId }, data: { isDeleted: true } });
    return { message: 'Question deleted successfully.' };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER / ADMIN: Get Exam with All Questions
  // ─────────────────────────────────────────────────────────────
  async getExamQuestions(examId: string, user: AuthUser) {
    const { exam } = await this.findExamAsTeacherOwner(examId, user);

    const questions = await this.prisma.question.findMany({
      where: { examId, isDeleted: false },
      orderBy: { orderIndex: 'asc' },
    });

    return {
      exam: {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        durationMinutes: exam.durationMinutes,
        totalMarks: exam.totalMarks,
        passingMarks: exam.passingMarks,
        isPublished: exam.isPublished,
      },
      questions,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER / ADMIN: Upload Question Image
  // ─────────────────────────────────────────────────────────────
  async uploadQuestionImage(examId: string, file: Express.Multer.File, user: AuthUser) {
    await this.findExamAsTeacherOwner(examId, user);

    if (!file) {
      throw new BadRequestException('Image file is required.');
    }

    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (!allowedMimes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Only JPEG, PNG, WebP, GIF and SVG images are allowed.');
    }

    const maxBytes = 5 * 1024 * 1024; // 5 MB
    if (file.size > maxBytes) {
      throw new BadRequestException('Question image size exceeds 5MB limit.');
    }

    const ext = file.originalname ? file.originalname.split('.').pop() : 'png';
    const uniqueFileName = `question_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;

    const imageUrl = await this.storageService.uploadFile(
      {
        originalname: uniqueFileName,
        buffer: file.buffer,
        mimetype: file.mimetype,
      },
      'questions',
    );

    return { message: 'Image uploaded successfully.', imageUrl };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Get All Submissions for Exam (Stats)
  // ─────────────────────────────────────────────────────────────
  async getExamSubmissions(examId: string, user: AuthUser) {
    await this.findExamAsTeacherOwner(examId, user);

    const [exam, attempts] = await Promise.all([
      this.prisma.exam.findUnique({
        where: { id: examId },
        select: { id: true, title: true, totalMarks: true, passingMarks: true },
      }),
      this.prisma.examAttempt.findMany({
        where: { examId },
        include: {
          student: {
            select: {
              fullName: true,
              userId: true,
              gradeLevel: true,
              user: { select: { phone: true } },
            },
          },
          _count: { select: { answers: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    if (!exam) throw new NotFoundException('Exam not found.');

    const stats = {
      totalAttempts: attempts.length,
      submitted: attempts.filter((a) => a.status === ExamAttemptStatus.SUBMITTED).length,
      inProgress: attempts.filter((a) => a.status === ExamAttemptStatus.IN_PROGRESS).length,
      timedOut: attempts.filter(
        (a) => a.status === ExamAttemptStatus.TIMED_OUT || a.status === ExamAttemptStatus.EXPIRED,
      ).length,
      averageScore: 0,
      passRate: 0,
    };

    const submittedAttempts = attempts.filter(
      (a) => a.status === ExamAttemptStatus.SUBMITTED && a.score !== null,
    );
    if (submittedAttempts.length > 0) {
      stats.averageScore =
        Math.round(
          (submittedAttempts.reduce((sum, a) => sum + (a.score ?? 0), 0) / submittedAttempts.length) * 10,
        ) / 10;
      stats.passRate =
        Math.round(
          (submittedAttempts.filter((a) => a.isPassed).length / submittedAttempts.length) * 100,
        );
    }

    return {
      exam,
      stats,
      attempts: attempts.map((a) => ({
        ...a,
        studentPhone: a.student?.user?.phone ?? null,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Add questions to an exam from the Question Bank
  // ─────────────────────────────────────────────────────────────
  async addQuestionsFromBank(
    examId: string,
    bankQuestionIds: string[],
    user: AuthUser,
  ) {
    await this.findExamAsTeacherOwner(examId, user);

    if (!Array.isArray(bankQuestionIds) || bankQuestionIds.length === 0) {
      throw new BadRequestException('bankQuestionIds must be a non-empty array.');
    }

    const where: Prisma.QuestionBankWhereInput = {
      id: { in: bankQuestionIds },
      isDeleted: false,
    };
    if (user.role !== 'ADMIN') {
      const teacher = await this.getTeacher(user.id);
      where.teacherId = teacher.id;
    }

    const bankQuestions = await this.prisma.questionBank.findMany({ where });
    if (bankQuestions.length === 0) {
      throw new NotFoundException('No valid bank questions found for the given ids.');
    }

    const last = await this.prisma.question.findFirst({
      where: { examId, isDeleted: false },
      orderBy: { orderIndex: 'desc' },
    });
    let order = last ? last.orderIndex : 0;

    await this.prisma.question.createMany({
      data: bankQuestions.map((q) => ({
        examId,
        text: q.text,
        imageUrl: q.imageUrl,
        options: q.options as string[],
        correctOptionIndex: q.correctOptionIndex,
        explanation: q.explanation,
        marks: q.marks,
        orderIndex: ++order,
      })),
    });

    return {
      message: `${bankQuestions.length} question(s) added to the exam.`,
      addedCount: bankQuestions.length,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Exam Rankings (Top / Bottom scorers) — Phase 7
  // ─────────────────────────────────────────────────────────────
  async getExamRankings(
    examId: string,
    order: 'top' | 'bottom',
    user: AuthUser,
  ) {
    await this.findExamAsTeacherOwner(examId, user);

    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      select: { title: true, totalMarks: true },
    });
    if (!exam) throw new NotFoundException('Exam not found.');

    const attempts = await this.prisma.examAttempt.findMany({
      where: { examId, status: ExamAttemptStatus.SUBMITTED },
      orderBy: [
        { score: order === 'top' ? 'desc' : 'asc' },
        { submittedAt: order === 'top' ? 'asc' : 'desc' },
      ],
      take: 10,
      include: {
        student: { select: { fullName: true, gradeLevel: true } },
      },
    });

    return {
      exam,
      order,
      rankings: attempts.map((a) => ({
        attemptId: a.id,
        attemptNumber: a.attemptNumber,
        studentName: a.student.fullName,
        gradeLevel: a.student.gradeLevel,
        score: a.score ?? 0,
        isPassed: a.isPassed,
        submittedAt: a.submittedAt,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Get One Attempt Detail (Full Answer Sheet)
  // ─────────────────────────────────────────────────────────────
  async getAttemptDetail(attemptId: string, user: AuthUser) {
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: true,
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

    await this.findExamAsTeacherOwner(attempt.examId, user);

    // CRITICAL: the student answered against their per-attempt snapshot
    // (options may have been shuffled). Align every answer's question view
    // with that snapshot so the teacher sees exactly what the student saw —
    // otherwise correct answers appear wrong when options were shuffled.
    const snaps = Array.isArray(attempt.questionSnapshots)
      ? (attempt.questionSnapshots as {
          id: string;
          text: string;
          imageUrl: string | null;
          options: unknown;
          correctOptionIndex: number;
          explanation: string | null;
          marks: number;
        }[])
      : [];
    const snapMap = new Map(snaps.map((s) => [s.id, s]));

    const answers = attempt.answers.map((a) => {
      const snap = snapMap.get(a.questionId);
      if (!snap || !a.question) return a;
      return {
        ...a,
        question: {
          ...a.question,
          text: snap.text,
          imageUrl: snap.imageUrl,
          options: snap.options,
          correctOptionIndex: snap.correctOptionIndex,
          explanation: snap.explanation,
          marks: snap.marks,
        },
      };
    });

    return { ...attempt, answers };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT / TEACHER / ADMIN: List Exams for Course
  // ─────────────────────────────────────────────────────────────
  async getCourseExams(courseId: string, user: AuthUser) {
    if (user.role === Role.STUDENT) {
      // Softer check than startExam: enrolled (ACTIVE or PENDING) students may
      // browse the course's exams so the rankings page works before payment/activation.
      const student = await this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!student) throw new ForbiddenException('Student profile not found.');
      const enrollment = await this.prisma.enrollment.findFirst({
        where: {
          studentId: student.id,
          courseId,
          status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.PENDING] },
        },
      });
      if (!enrollment) {
        throw new ForbiddenException('You must be enrolled in this course to access its exams.');
      }
    } else if (user.role === Role.TEACHER) {
      const hasAccess = await canManageCourse(this.prisma, user.id, courseId, user.role);
      if (!hasAccess) {
        throw new ForbiddenException('Access denied. You do not own this course.');
      }
    }

    const isTeacherOrAdmin = user.role === Role.TEACHER || user.role === Role.ADMIN;
    const now = new Date();

    // Students can always browse exams they have already submitted, so the
    // rankings page can show an exam even when it is still a draft or its
    // public window has elapsed (they still have a result/rank to view).
    let mySubmittedExamIds: string[] = [];
    if (!isTeacherOrAdmin) {
      const student = await this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (student) {
        const myAttempts = await this.prisma.examAttempt.findMany({
          where: {
            studentId: student.id,
            exam: { courseId },
            status: { in: [ExamAttemptStatus.SUBMITTED, ExamAttemptStatus.TIMED_OUT] },
          },
          select: { examId: true },
          distinct: ['examId'],
        });
        mySubmittedExamIds = myAttempts.map((a) => a.examId);
      }
    }

    const exams = await this.prisma.exam.findMany({
      where: {
        courseId,
        isDeleted: false,
        ...(isTeacherOrAdmin
          ? {}
          : {
              OR: [
                {
                  isPublished: true,
                  OR: [{ endAt: null }, { endAt: { gt: now } }],
                },
                {
                  isPublished: false,
                  startAt: { gt: now },
                  OR: [{ endAt: null }, { endAt: { gt: now } }],
                },
                { id: { in: mySubmittedExamIds } },
              ],
            }),
      },
      include: {
        _count: { select: { questions: { where: { isDeleted: false } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Students: count their own attempts per exam so the UI can hide
    // "previous attempts" for exams they never started
    let myAttemptsMap = new Map<string, number>();
    if (!isTeacherOrAdmin && exams.length > 0) {
      const student = await this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (student) {
        const attemptCounts = await this.prisma.examAttempt.groupBy({
          by: ['examId'],
          where: {
            examId: { in: exams.map((e) => e.id) },
            studentId: student.id,
          },
          _count: { _all: true },
        });
        myAttemptsMap = new Map(attemptCounts.map((a) => [a.examId, a._count._all]));
      }
    }

    return exams.map((exam) => ({
      id: exam.id,
      title: exam.title,
      description: exam.description,
      durationMinutes: exam.durationMinutes,
      totalMarks: exam.totalMarks,
      passingMarks: exam.passingMarks,
      maxAttempts: exam.maxAttempts,
      isPublished: exam.isPublished,
      questionCount: exam._count.questions,
      _count: exam._count,
      startAt: exam.startAt,
      endAt: exam.endAt,
      notStarted: !!exam.startAt && exam.startAt > now,
      ended: !!exam.endAt && exam.endAt < now,
      isAvailable:
        (!exam.startAt || exam.startAt <= now) && (!exam.endAt || exam.endAt >= now),
      myAttemptsCount: isTeacherOrAdmin ? undefined : (myAttemptsMap.get(exam.id) ?? 0),
    }));
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Start Exam Attempt
  // ─────────────────────────────────────────────────────────────
  async startExam(examId: string, user: AuthUser, sessionKey?: string) {
    let exam = await this.prisma.exam.findFirst({
      where: { id: examId, isPublished: true, isDeleted: false },
      include: {
        questions: {
          where: { isDeleted: false },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });
    if (!exam) throw new NotFoundException('Exam not found or not published.');

    await this.ensureStudentEnrolled(user.id, exam.courseId);

    // Randomized exam: materialize questions from the Question Bank (once)
    if (exam.useQuestionBank && exam.questions.length === 0) {
      await this.materializeBankQuestions(exam);
      exam = await this.prisma.exam.findFirst({
        where: { id: examId, isPublished: true, isDeleted: false },
        include: {
          questions: {
            where: { isDeleted: false },
            orderBy: { orderIndex: 'asc' },
          },
        },
      });
      if (!exam) throw new NotFoundException('Exam not found or not published.');
      if (exam.questions.length === 0) {
        throw new BadRequestException(
          'لا توجد أسئلة في بنك الأسئلة لهذا الكورس. أضف أسئلة أولاً.',
        );
      }
    }

    // Check scheduling window
    const now = new Date();
    if (exam.startAt && exam.startAt > now) {
      throw new ForbiddenException(
        `Exam has not started yet. It begins at ${exam.startAt.toISOString()}.`,
      );
    }
    if (exam.endAt && exam.endAt < now) {
      throw new ForbiddenException('Exam window has closed. No more attempts are allowed.');
    }

    const student = await this.prisma.studentProfile.findUnique({ where: { userId: user.id } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    // Always restore an unfinished attempt before looking at maxAttempts.
    const activeAttempt = await this.prisma.examAttempt.findFirst({
      where: { examId, studentId: student.id, status: ExamAttemptStatus.IN_PROGRESS },
    });

    // Once a student has SUBMITTED (or the attempt has TIMED_OUT) an exam they
    // are NOT allowed to start another attempt — they may only review their
    // result. This guarantees an exam can be taken at most once. A teacher can
    // still use the reactivate endpoint to reset this for a specific student.
    const completedAttempts = await this.prisma.examAttempt.count({
      where: {
        examId,
        studentId: student.id,
        status: { in: [ExamAttemptStatus.SUBMITTED, ExamAttemptStatus.TIMED_OUT] },
      },
    });

    if (!activeAttempt && completedAttempts > 0) {
      throw new ForbiddenException(
        'لقد أرسلت هذا الامتحان بالفعل. يمكنك الاطلاع على النتيجة فقط.',
      );
    }

    // Prepare question IDs (shuffled if requested)
    const activeQuestions = exam.questions.filter((q) => !q.isDeleted);
    let questionIds = activeQuestions.map((q) => q.id);

    if (exam.shuffleQuestions) {
      questionIds = this.shuffleArray(questionIds);
    }

    // Snapshot the exact content (with per-attempt shuffled option order)
    const snapshots = this.buildQuestionSnapshots(activeQuestions, exam.shuffleOptions);
    const snapshotMap = new Map(snapshots.map((s) => [s.id, s]));

    if (activeAttempt) {
      // Resume existing active attempt — serve content from its stored snapshot
      // One-browser lock: only the browser holding the issued session key
      // may resume; any other browser/tab is rejected.
      if (now > activeAttempt.expiresAt) {
        await this.finalizeAttempt(activeAttempt.id, ExamAttemptStatus.TIMED_OUT);
        throw new ForbiddenException('Exam time has expired.');
      }
      if (
        activeAttempt.sessionKey &&
        activeAttempt.sessionKey !== sessionKey
      ) {
        throw new ForbiddenException(
          'هذا الامتحان مفتوح بالفعل في متصفح آخر. أكمل الامتحان من نفس المتصفح.',
        );
      }

      const qOrder = activeAttempt.questionOrder.length > 0 ? activeAttempt.questionOrder : questionIds;
      const resumeSnaps = this.getAttemptSnapshotList(activeAttempt, snapshots);
      const resumeMap = new Map(resumeSnaps.map((s) => [s.id, s]));
      const currentQId = qOrder[activeAttempt.currentIndex] || qOrder[0];
      const currentQ = resumeMap.get(currentQId);

      const existingAnswer = await this.prisma.attemptAnswer.findUnique({
        where: { attemptId_questionId: { attemptId: activeAttempt.id, questionId: currentQId } },
      });
      const savedAnswers = await this.prisma.attemptAnswer.findMany({
        where: { attemptId: activeAttempt.id },
        select: { questionId: true, selectedOptionIndex: true },
      });

      return {
        message: 'Resuming active attempt in progress.',
        attempt: {
          id: activeAttempt.id,
          attemptNumber: activeAttempt.attemptNumber,
          startedAt: activeAttempt.startedAt,
          expiresAt: activeAttempt.expiresAt,
          durationMinutes: exam.durationMinutes,
          currentIndex: activeAttempt.currentIndex,
          totalQuestions: qOrder.length,
          timeRemainingSeconds: Math.max(0, Math.floor((activeAttempt.expiresAt.getTime() - now.getTime()) / 1000)),
          sessionKey: activeAttempt.sessionKey ?? undefined,
          exitCount: activeAttempt.exitCount,
          isEligibleForLeaderboard: activeAttempt.isEligibleForLeaderboard,
          answeredQuestionIndexes: savedAnswers
            .map((answer) => qOrder.indexOf(answer.questionId))
            .filter((index) => index >= 0),
        },
        currentQuestion: currentQ
          ? {
              id: currentQ.id,
              text: currentQ.text,
              imageUrl: currentQ.imageUrl,
              options: currentQ.options,
              marks: currentQ.marks,
              selectedOptionIndex: existingAnswer?.selectedOptionIndex ?? null,
            }
          : null,
        questions: qOrder
          .map((id) => resumeMap.get(id))
          .filter((q): q is NonNullable<typeof q> => !!q)
          .map((q) => ({ id: q.id, text: q.text, imageUrl: q.imageUrl, options: q.options, marks: q.marks })),
        serverTime: now.toISOString(),
      };
    }

    // Create new attempt — expiresAt set strictly on server
    const expiresAt = new Date(now.getTime() + exam.durationMinutes * 60 * 1000);
    const attemptNumber = completedAttempts + 1;
    // Issue a one-time session key binding this attempt to this browser
    const newSessionKey = randomUUID();

    const attempt = await this.prisma.examAttempt.create({
      data: {
        examId,
        studentId: student!.id,
        attemptNumber,
        questionOrder: questionIds,
        currentIndex: 0,
        questionSnapshots: snapshots as unknown as Prisma.InputJsonValue,
        sessionKey: newSessionKey,
        startedAt: now,
        expiresAt,
        status: ExamAttemptStatus.IN_PROGRESS,
      },
    });

    const firstQ = snapshotMap.get(questionIds[0]);

    return {
      message: 'Exam started successfully.',
      attempt: {
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        startedAt: attempt.startedAt,
        expiresAt: attempt.expiresAt,
        durationMinutes: exam.durationMinutes,
        currentIndex: 0,
        totalQuestions: questionIds.length,
        timeRemainingSeconds: exam.durationMinutes * 60,
        sessionKey: newSessionKey,
        exitCount: attempt.exitCount,
        isEligibleForLeaderboard: attempt.isEligibleForLeaderboard,
        answeredQuestionIndexes: [],
      },
      currentQuestion: firstQ
        ? {
            id: firstQ.id,
            text: firstQ.text,
            imageUrl: firstQ.imageUrl,
            options: firstQ.options,
            marks: firstQ.marks,
            selectedOptionIndex: null,
          }
        : null,
      questions: questionIds
        .map((id) => snapshotMap.get(id))
        .filter((q): q is NonNullable<typeof q> => !!q)
        .map((q) => ({ id: q.id, text: q.text, imageUrl: q.imageUrl, options: q.options, marks: q.marks })),
      serverTime: now.toISOString(),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Idempotent exit tracking (private leaderboard only)
  // ─────────────────────────────────────────────────────────────
  async recordExamExit(
    attemptId: string,
    dto: RecordExamExitDto,
    user: AuthUser,
    sessionKey?: string,
  ) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, studentId: student.id },
      select: {
        id: true,
        studentId: true,
        status: true,
        expiresAt: true,
        sessionKey: true,
        exitCount: true,
        isEligibleForLeaderboard: true,
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found or access denied.');
    this.assertAttemptSession(attempt, sessionKey);
    if (attempt.status !== ExamAttemptStatus.IN_PROGRESS || attempt.expiresAt <= new Date()) {
      throw new BadRequestException('This exam attempt is no longer accepting exit events.');
    }

    const resultFor = (state: { exitCount: number; isEligibleForLeaderboard: boolean }) => ({
      success: true,
      exitCount: state.exitCount,
      maxAllowedExits: MAX_LEADERBOARD_EXITS,
      isEligibleForLeaderboard: state.isEligibleForLeaderboard,
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const duplicate = await tx.examAttemptExit.findUnique({
          where: { attemptId_eventId: { attemptId, eventId: dto.eventId } },
          select: { id: true },
        });
        if (duplicate) {
          const current = await tx.examAttempt.findUnique({
            where: { id: attemptId },
            select: { exitCount: true, isEligibleForLeaderboard: true },
          });
          return resultFor(current ?? attempt);
        }

        // The event record's DB constraint is the definitive duplicate guard.
        // The following update increments and computes eligibility in one SQL
        // statement, so concurrent tab/browser signals cannot lose an exit.
        await tx.examAttemptExit.create({
          data: { attemptId, eventId: dto.eventId, exitType: dto.exitType },
        });
        const updated = await tx.$queryRaw<
          { exitCount: number; isEligibleForLeaderboard: boolean }[]
        >(Prisma.sql`
          UPDATE "exam_attempts"
          SET
            "exit_count" = "exit_count" + 1,
            "is_eligible_for_leaderboard" = ("exit_count" + 1) <= ${MAX_LEADERBOARD_EXITS}
          WHERE "id" = ${attemptId}::uuid
            AND "student_id" = ${student.id}::uuid
            AND "status" = CAST('IN_PROGRESS' AS "ExamAttemptStatus")
            AND "expires_at" > NOW()
          RETURNING
            "exit_count" AS "exitCount",
            "is_eligible_for_leaderboard" AS "isEligibleForLeaderboard"
        `);
        if (updated.length === 0) {
          throw new BadRequestException('This exam attempt is no longer accepting exit events.');
        }
        return resultFor(updated[0]);
      });
    } catch (error) {
      // A simultaneous repeat with the same eventId may reach the unique
      // constraint before the first transaction commits. Return the current
      // state as a successful no-op rather than double-counting it.
      if ((error as { code?: string }).code === 'P2002') {
        const current = await this.prisma.examAttempt.findFirst({
          where: { id: attemptId, studentId: student.id },
          select: { exitCount: true, isEligibleForLeaderboard: true },
        });
        if (current) return resultFor(current);
      }
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Submit Exam (Auto-Grade in $transaction)
  // ─────────────────────────────────────────────────────────────
  async submitExam(attemptId: string, dto: SubmitExamDto, user: AuthUser, sessionKey?: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId: user.id } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, studentId: student.id },
      include: {
        exam: {
          include: {
            questions: { where: { isDeleted: false } },
            course: { select: { id: true, title: true, teacher: { select: { userId: true } } } },
          },
        },
      },
    });

    if (!attempt) throw new NotFoundException('Attempt not found or access denied.');
    this.assertAttemptSession(attempt, sessionKey);
    if (attempt.status === ExamAttemptStatus.SUBMITTED) {
      throw new ConflictException('This attempt has already been submitted.');
    }
    if (
      attempt.status === ExamAttemptStatus.TIMED_OUT ||
      attempt.status === ExamAttemptStatus.EXPIRED
    ) {
      throw new BadRequestException(
        'This attempt has expired or timed out and cannot be submitted.',
      );
    }

    // Server-side time check
    const now = new Date();
    const isTimedOut = now > attempt.expiresAt;

    // Grade against the per-attempt snapshot (falls back to live questions)
    const fallbackSnaps: { id: string; text: string; imageUrl: string | null; options: unknown; correctOptionIndex: number; explanation: string | null; marks: number }[] =
      attempt.exam.questions
        .filter((q) => !q.isDeleted)
        .map((q) => ({
          id: q.id,
          text: q.text,
          imageUrl: q.imageUrl,
          options: q.options,
          correctOptionIndex: q.correctOptionIndex,
          explanation: q.explanation,
          marks: q.marks,
        }));
    const questions = this.getAttemptSnapshotList(attempt, fallbackSnaps);
    const questionMap = new Map(questions.map((q) => [q.id, q]));

    let totalScore = 0;

    const answerCreateData = dto.answers
      .filter((ans) => questionMap.has(ans.questionId))
      .map((ans) => {
        const question = questionMap.get(ans.questionId)!;
        const isCorrect =
          ans.selectedOptionIndex !== undefined &&
          ans.selectedOptionIndex !== null &&
          ans.selectedOptionIndex >= 0 &&
          ans.selectedOptionIndex === question.correctOptionIndex;
        const awardedMarks = isCorrect ? question.marks : 0;
        totalScore += awardedMarks;

        return {
          attemptId,
          questionId: ans.questionId,
          selectedOptionIndex: ans.selectedOptionIndex ?? null,
          isCorrect,
          awardedMarks,
        };
      });

    const isPassed = totalScore >= attempt.exam.passingMarks;
    const finalStatus = isTimedOut
      ? ExamAttemptStatus.TIMED_OUT
      : ExamAttemptStatus.SUBMITTED;

    // Bank exams use the actual snapshot marks sum
    const effectiveTotalMarks = attempt.exam.useQuestionBank
      ? questions.reduce((sum, q) => sum + (q.marks ?? 0), 0)
      : attempt.exam.totalMarks;

    // All writes in single transaction
    const [updatedAttempt] = await this.prisma.$transaction([
      this.prisma.examAttempt.update({
        where: { id: attemptId },
        data: {
          status: finalStatus,
          submittedAt: now,
          score: totalScore,
          isPassed,
        },
      }),
      this.prisma.attemptAnswer.createMany({
        data: answerCreateData,
        skipDuplicates: true,
      }),
    ]);

    // إشعار الطالب بنتيجة الامتحان
    await this.notificationsService
      .notify({
        userId: user.id,
        type: 'EXAM_RESULT',
        title: isPassed ? 'مبروك! نجحت في الامتحان' : 'نتيجة الامتحان',
        body: `امتحان "${attempt.exam.title}": نتيجتك ${totalScore} من ${effectiveTotalMarks}.`,
        linkUrl: `/exams/attempts/${attemptId}/result`,
      })
      .catch(() => undefined);

    // إشعار المدرس صاحب الكورس بأن طالباً أنهى الامتحان
    if (attempt.exam.course?.teacher?.userId) {
      await this.notificationsService
        .notify({
          userId: attempt.exam.course.teacher.userId,
          type: 'EXAM_SUBMITTED',
          title: 'طالب أنهى امتحاناً',
          body: `أنهى الطالب "${student.fullName}" امتحان "${attempt.exam.title}" في كورس "${attempt.exam.course.title}". النتيجة: ${totalScore} من ${effectiveTotalMarks}${isPassed ? ' (ناجح)' : ' (راسب)'}.`,
          linkUrl: `/dashboard/exams/${attempt.exam.id}/submissions`,
        })
        .catch(() => undefined);
    }

    // Gamification (idempotent — never breaks the main flow)
    await this.gamificationService.recordActivity(attempt.studentId);
    await this.gamificationService.awardBadge(attempt.studentId, 'FIRST_EXAM_COMPLETED');
    if (
      effectiveTotalMarks > 0 &&
      totalScore / effectiveTotalMarks >= 0.9
    ) {
      await this.gamificationService.awardBadge(attempt.studentId, 'EXAM_SCORE_90');
    }

    // Coins (fire-and-forget)
    const isExcellent = effectiveTotalMarks > 0 && totalScore / effectiveTotalMarks >= 0.9;
    const coinAmount = isPassed ? (isExcellent ? 200 : 100) : 50;
    await this.coinsService.addCoins(
      attempt.studentId,
      coinAmount,
      'EARN_EXAM',
      attempt.examId,
      `امتحان "${attempt.exam.title}"`,
    );

    // Phase 3 — refresh the per-exam Top-10 leaderboard/medals (safe, async-safe)
    await this.leaderboardService.recomputeExamAchievements(attempt.examId);

    // Notify the submitting student of THEIR rank on this exam's leaderboard
    // so they can watch their position (top-3 medalists are notified separately).
    try {
      const myAchievement = await this.prisma.examAchievement.findUnique({
        where: { studentId_examId: { studentId: attempt.studentId, examId: attempt.examId } },
        select: { rank: true, medal: true, percentage: true },
      });
      if (myAchievement) {
        const medalEmoji =
          myAchievement.medal === 'GOLD' ? '🥇' : myAchievement.medal === 'SILVER' ? '🥈' : myAchievement.medal === 'BRONZE' ? '🥉' : '';
        await this.notificationsService
          .notify({
            userId: user.id,
            type: 'EXAM_LEADERBOARD_RANK',
            title: medalEmoji
              ? `ترتيبك في الامتحان: ${myAchievement.rank} ${medalEmoji}`
              : `ترتيبك في الامتحان: ${myAchievement.rank}`,
            body: `أحرزت المركز ${myAchievement.rank} في امتحان "${attempt.exam.title}" بنسبة ${myAchievement.percentage}%.`,
            linkUrl: `/exams/${attempt.examId}/leaderboard`,
          })
          .catch(() => undefined);
      }
    } catch {
      /* never break the submit flow */
    }

    const result: Record<string, unknown> = {
      message: isTimedOut
        ? 'Exam time expired. Your answers have been auto-submitted.'
        : 'Exam submitted successfully.',
      score: totalScore,
      totalMarks: effectiveTotalMarks,
      passingMarks: attempt.exam.passingMarks,
      isPassed,
      status: finalStatus,
      submittedAt: now.toISOString(),
    };

    // Show correct answers if teacher allowed it
    if (attempt.exam.showCorrectAnswersAfterSubmission) {
      result.modelAnswers = questions.map((q) => ({
        questionId: q.id,
        text: q.text,
        correctOptionIndex: q.correctOptionIndex,
        explanation: q.explanation,
        marks: q.marks,
        yourAnswer: answerCreateData.find((a) => a.questionId === q.id)?.selectedOptionIndex ?? null,
        isCorrect: answerCreateData.find((a) => a.questionId === q.id)?.isCorrect ?? false,
        awardedMarks: answerCreateData.find((a) => a.questionId === q.id)?.awardedMarks ?? 0,
      }));
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: My Attempts for an Exam
  // ─────────────────────────────────────────────────────────────
  async getMyAttempts(examId: string, user: AuthUser) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId: user.id } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, isPublished: true, isDeleted: false },
    });
    if (!exam) throw new NotFoundException('Exam not found.');

    await this.ensureStudentEnrolled(user.id, exam.courseId);

    const attempts = await this.prisma.examAttempt.findMany({
      where: { examId, studentId: student.id },
      orderBy: { attemptNumber: 'asc' },
      select: {
        id: true,
        attemptNumber: true,
        status: true,
        score: true,
        isPassed: true,
        startedAt: true,
        submittedAt: true,
        expiresAt: true,
      },
    });

    return { exam: { id: exam.id, title: exam.title, totalMarks: exam.totalMarks, passingMarks: exam.passingMarks }, attempts };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Get Attempt Result Detail
  // ─────────────────────────────────────────────────────────────
  async getAttemptResult(attemptId: string, user: AuthUser) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId: user.id } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, studentId: student.id },
      include: {
        exam: { select: { title: true, courseId: true, totalMarks: true, passingMarks: true, showCorrectAnswersAfterSubmission: true } },
        answers: {
          include: {
            question: {
              select: { text: true, options: true, correctOptionIndex: true, explanation: true, marks: true, orderIndex: true },
            },
          },
          orderBy: { question: { orderIndex: 'asc' } },
        },
      },
    });

    if (!attempt) throw new NotFoundException('Attempt not found or access denied.');
    if (attempt.status === ExamAttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('Exam is still in progress. Submit it first.');
    }

    // The student's real total for THIS attempt. Bank exams serve a random
    // subset and some exams have a configured totalMarks that doesn't match the
    // marks of the questions actually served — so derive the denominator from
    // the attempt's own question-snapshot marks.
    const snapshotList = Array.isArray(attempt.questionSnapshots)
      ? (attempt.questionSnapshots as { marks?: number }[])
      : [];
    const actualTotalMarks =
      snapshotList.length > 0
        ? snapshotList.reduce((sum, s) => sum + (s.marks ?? 0), 0)
        : (attempt.exam.totalMarks ?? 0);

    const response: Record<string, unknown> = {
      attemptId: attempt.id,
      examId: attempt.examId,
      courseId: attempt.exam.courseId,
      examTitle: attempt.exam.title,
      questionCount: Array.isArray(attempt.questionSnapshots) && attempt.questionSnapshots.length > 0
        ? attempt.questionSnapshots.length
        : attempt.questionOrder.length,
      score: attempt.score,
      totalMarks: actualTotalMarks,
      passingMarks: attempt.exam.passingMarks,
      isPassed: attempt.isPassed,
      status: attempt.status,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      leaderboardEligibility: {
        eligible: attempt.isEligibleForLeaderboard,
        exitCount: attempt.exitCount,
        maxAllowedExits: MAX_LEADERBOARD_EXITS,
      },
    };

    response.actualPerformanceRank =
      attempt.status === ExamAttemptStatus.SUBMITTED
        ? await this.leaderboardService
            .getPrivateAttemptRank(attempt.examId, student.id)
            .catch(() => null)
        : null;

    if (attempt.exam.showCorrectAnswersAfterSubmission) {
      // Prefer the attempt snapshot (shuffled option order) over live DB content
      const snaps = Array.isArray(attempt.questionSnapshots)
        ? (attempt.questionSnapshots as { id: string; text: string; options: unknown; correctOptionIndex: number; explanation: string | null; marks: number }[])
        : [];
      const snapMap = new Map(snaps.map((s) => [s.id, s]));

      response.answers = attempt.answers.map((a) => {
        const snap = snapMap.get(a.questionId);
        return {
          questionId: a.questionId,
          text: snap?.text ?? a.question.text,
          options: snap?.options ?? a.question.options,
          yourAnswer: a.selectedOptionIndex,
          correctAnswer: snap?.correctOptionIndex ?? a.question.correctOptionIndex,
          explanation: snap?.explanation ?? a.question.explanation,
          isCorrect: a.isCorrect,
          awardedMarks: a.awardedMarks,
          totalMarks: snap?.marks ?? a.question.marks,
        };
      });
    }

    return response;
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Get Single Question by Index in Fixed Order
  // ─────────────────────────────────────────────────────────────
  async getAttemptQuestion(attemptId: string, index: number, user: AuthUser, sessionKey?: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId: user.id } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, studentId: student.id },
      include: {
        exam: {
          include: {
            questions: { where: { isDeleted: false } },
          },
        },
      },
    });

    if (!attempt) throw new NotFoundException('Attempt not found or access denied.');
    this.assertAttemptSession(attempt, sessionKey);

    const now = new Date();
    if (attempt.status !== ExamAttemptStatus.IN_PROGRESS || now > attempt.expiresAt) {
      if (attempt.status === ExamAttemptStatus.IN_PROGRESS) {
        await this.finalizeAttempt(attempt.id, ExamAttemptStatus.TIMED_OUT);
      }
      throw new ForbiddenException('انتهى وقت الامتحان أو تم تسليمه بالفعل.');
    }

    const questionIds = attempt.questionOrder.length > 0
      ? attempt.questionOrder
      : attempt.exam.questions.map((q) => q.id);

    if (index < 0 || index >= questionIds.length) {
      throw new BadRequestException(`رقم السؤال غير صحيح (1 إلى ${questionIds.length}).`);
    }

    const targetQuestionId = questionIds[index];
    // Serve content from the attempt snapshot (shuffled options) when available
    const snaps = Array.isArray(attempt.questionSnapshots)
      ? (attempt.questionSnapshots as { id: string; text: string; imageUrl: string | null; options: unknown; marks: number }[])
      : [];
    const snapMap = new Map(snaps.map((s) => [s.id, s]));
    const question = snapMap.get(targetQuestionId)
      ?? attempt.exam.questions.find((q) => q.id === targetQuestionId);
    if (!question) throw new NotFoundException('السؤال غير موجود.');

    const existingAnswer = await this.prisma.attemptAnswer.findUnique({
      where: { attemptId_questionId: { attemptId, questionId: targetQuestionId } },
    });

    // Persist the currently viewed question as well as answers. This makes
    // refresh/resume land exactly where the student left off.
    if (attempt.currentIndex !== index) {
      await this.prisma.examAttempt.update({
        where: { id: attempt.id },
        data: { currentIndex: index },
      });
    }

    const timeRemainingSeconds = Math.max(0, Math.floor((attempt.expiresAt.getTime() - now.getTime()) / 1000));

    return {
      attemptId,
      currentIndex: index,
      totalQuestions: questionIds.length,
      timeRemainingSeconds,
      durationMinutes: attempt.exam.durationMinutes,
      question: {
        id: question.id,
        text: question.text,
        imageUrl: question.imageUrl ?? null,
        options: question.options,
        marks: question.marks,
        selectedOptionIndex: existingAnswer?.selectedOptionIndex ?? null,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Save Single Question Answer & Move / Finish
  // ─────────────────────────────────────────────────────────────
  async submitSingleAnswer(
    attemptId: string,
    dto: { questionId: string; selectedOptionIndex: number; finish?: boolean },
    user: AuthUser,
    sessionKey?: string,
  ) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId: user.id } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, studentId: student.id },
      include: {
        exam: {
          include: {
            questions: { where: { isDeleted: false } },
          },
        },
      },
    });

    if (!attempt) throw new NotFoundException('Attempt not found or access denied.');
    this.assertAttemptSession(attempt, sessionKey);

    const now = new Date();
    if (attempt.status !== ExamAttemptStatus.IN_PROGRESS || now > attempt.expiresAt) {
      if (attempt.status === ExamAttemptStatus.IN_PROGRESS) {
        await this.finalizeAttempt(attempt.id, ExamAttemptStatus.TIMED_OUT);
      }
      throw new ForbiddenException('انتهى وقت الامتحان وتم تسليمه تلقائياً.');
    }

    // Grade against the attempt snapshot (shuffled option order) when available
    const snaps = Array.isArray(attempt.questionSnapshots)
      ? (attempt.questionSnapshots as { id: string; correctOptionIndex: number; marks: number }[])
      : [];
    const snap = snaps.find((s) => s.id === dto.questionId);
    const question = snap
      ?? attempt.exam.questions.find((q) => q.id === dto.questionId);
    if (!question) throw new NotFoundException('السؤال غير موجود في هذا الامتحان.');

    const isCorrect = dto.selectedOptionIndex === question.correctOptionIndex;
    const awardedMarks = isCorrect ? question.marks : 0;

    // Upsert answer
    await this.prisma.attemptAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId: dto.questionId } },
      create: {
        attemptId,
        questionId: dto.questionId,
        selectedOptionIndex: dto.selectedOptionIndex,
        isCorrect,
        awardedMarks,
      },
      update: {
        selectedOptionIndex: dto.selectedOptionIndex,
        isCorrect,
        awardedMarks,
      },
    });

    const questionIds = attempt.questionOrder.length > 0
      ? attempt.questionOrder
      : attempt.exam.questions.map((q) => q.id);

    const currentQIdx = questionIds.indexOf(dto.questionId);
    const nextIndex = currentQIdx >= 0 ? currentQIdx + 1 : attempt.currentIndex + 1;
    // Reaching the last question is not the same as submitting the exam.
    // Students may return to review or use the question navigator first.
    if (dto.finish) {
      // Calculate final grade
      const result = await this.finalizeAttempt(attempt.id, ExamAttemptStatus.SUBMITTED);
      return {
        message: 'تم تسليم الامتحان وحساب النتيجة بنجاح.',
        isFinished: true,
        score: result.score,
        totalMarks: attempt.exam.totalMarks,
        passingMarks: attempt.exam.passingMarks,
        isPassed: result.isPassed,
      };
    }

    // Update currentIndex on attempt
    await this.prisma.examAttempt.update({
      where: { id: attempt.id },
      data: { currentIndex: nextIndex },
    });

    return {
      message: 'تم حفظ الإجابة بنجاح.',
      isFinished: false,
      nextIndex,
      totalQuestions: questionIds.length,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Helper: Finalize Attempt and Calculate Score
  // ─────────────────────────────────────────────────────────────
  async finalizeAttempt(attemptId: string, status: ExamAttemptStatus) {
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: {
            course: {
              select: { id: true, title: true, teacher: { select: { userId: true } } },
            },
          },
        },
        answers: true,
        student: { select: { fullName: true } },
      },
    });

    if (!attempt) return { score: 0, isPassed: false };

    const totalScore = attempt.answers.reduce((sum, a) => sum + (a.awardedMarks || 0), 0);
    const isPassed = totalScore >= attempt.exam.passingMarks;

    const updated = await this.prisma.examAttempt.update({
      where: { id: attemptId },
      data: {
        status,
        score: totalScore,
        isPassed,
        submittedAt: new Date(),
      },
    });

    // إشعار المدرس بانتهاء المحاولة (تسليم يدوي أو انتهاء الوقت تلقائياً)
    if (attempt.exam.course?.teacher?.userId) {
      this.notificationsService
        .notify({
          userId: attempt.exam.course.teacher.userId,
          type: 'EXAM_SUBMITTED',
          title: status === ExamAttemptStatus.TIMED_OUT ? 'انتهى وقت امتحان طالب' : 'طالب أنهى امتحاناً',
          body: `${status === ExamAttemptStatus.TIMED_OUT ? 'انتهى وقت' : 'أنهى'} الطالب "${attempt.student.fullName}" امتحان "${attempt.exam.title}" في كورس "${attempt.exam.course.title}". النتيجة: ${totalScore} من ${attempt.exam.totalMarks}${isPassed ? ' (ناجح)' : ' (راسب)'}.`,
          linkUrl: `/dashboard/exams/${attempt.exam.id}/submissions`,
        })
        .catch(() => undefined);
    }

    // Gamification for the single-question flow
    await this.gamificationService.recordActivity(attempt.studentId);
    await this.gamificationService.awardBadge(attempt.studentId, 'FIRST_EXAM_COMPLETED');
    if (
      attempt.exam.totalMarks > 0 &&
      totalScore / attempt.exam.totalMarks >= 0.9
    ) {
      await this.gamificationService.awardBadge(attempt.studentId, 'EXAM_SCORE_90');
    }

    return updated;
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Generate PDF Result Certificate / Review
  // ─────────────────────────────────────────────────────────────
  async generateResultPdf(attemptId: string, user: AuthUser): Promise<{ buffer: any; fileName: string }> {
    // ولي الأمر يُسمح له بتحميل ورقة نتيجة ابنه فقط (الطالب الذي سجل رقمه)
    if (user.role === 'PARENT') {
      const owner = await this.prisma.examAttempt.findFirst({
        where: { id: attemptId },
        select: { student: { select: { id: true, fullName: true, guardianPhone: true } } },
      });
      if (!owner || owner.student.guardianPhone !== user.phone) {
        throw new ForbiddenException('غير مصرح لك بالوصول إلى ورقة هذا الطالب.');
      }
      return this.buildExamResultPdf(attemptId, owner.student);
    }

    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      include: { user: true },
    });
    if (!student) throw new ForbiddenException('Student profile not found.');

    return this.buildExamResultPdf(attemptId, student);
  }

  private async buildExamResultPdf(
    attemptId: string,
    student: { id: string; fullName: string },
  ): Promise<{ buffer: any; fileName: string }> {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, studentId: student.id },
      include: {
        exam: {
          include: {
            course: true,
            questions: { where: { isDeleted: false }, orderBy: { orderIndex: 'asc' } },
          },
        },
        answers: {
          include: { question: true },
        },
      },
    });

    if (!attempt) throw new NotFoundException('Attempt not found.');
    if (attempt.status === ExamAttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('Exam is still in progress. Submit it first.');
    }

    // ─── Arabic/RTL support (Phase 2) ─────────────────────────────
    // Rendered as HTML through a real browser engine (Puppeteer), which
    // handles Arabic shaping + bidi natively — no manual reshaping hacks.
    const percentage =
      attempt.exam.totalMarks > 0
        ? Math.round(((attempt.score || 0) / attempt.exam.totalMarks) * 100)
        : 0;

    const answersByQuestionId = new Map(
      attempt.answers.map((a: any) => [a.questionId, a]),
    );

    // Use the per-attempt snapshot (shuffled option order + remapped
    // correctOptionIndex) — NOT live DB content — otherwise a correctly
    // answered question appears as wrong in the PDF whenever shuffleOptions
    // was enabled for this attempt.
    const snaps = Array.isArray(attempt.questionSnapshots)
      ? (attempt.questionSnapshots as {
          id: string;
          text: string;
          imageUrl?: string | null;
          options: unknown;
          correctOptionIndex: number;
          explanation: string | null;
          marks: number;
        }[])
      : [];
    const snapMap = new Map(snaps.map((s) => [s.id, s]));
    const liveMap = new Map(
      attempt.exam.questions.filter((q: any) => !q.isDeleted).map((q: any) => [q.id, q]),
    );

    // Preserve the exact question order the student saw during the attempt
    const questionOrder: string[] =
      Array.isArray(attempt.questionOrder) && attempt.questionOrder.length > 0
        ? attempt.questionOrder
        : [...liveMap.keys()];

    const questions: ExamResultQuestion[] = questionOrder
      .map((qid): ExamResultQuestion | null => {
        const q: any = snapMap.get(qid) ?? liveMap.get(qid);
        if (!q) return null;
        const answer = answersByQuestionId.get(qid);
        const options = Array.isArray(q.options) ? q.options : [];
        return {
          index: 0,
          text: q.text ?? '',
          marks: q.marks ?? 0,
          options,
          selectedIndex:
            answer?.selectedOptionIndex === null ||
            answer?.selectedOptionIndex === undefined
              ? null
              : answer.selectedOptionIndex,
          correctIndex: q.correctOptionIndex,
          isCorrect: answer?.isCorrect ?? false,
          awardedMarks: answer?.awardedMarks ?? 0,
          explanation: q.explanation,
        };
      })
      .filter((q): q is ExamResultQuestion => q !== null)
      .map((q, idx) => ({ ...q, index: idx }));

    const fontFaceCss = this.pdfGenerator.getEmbeddedFontFace(
      'Amiri',
      'Amiri-Regular.ttf',
    );

    const html = buildExamResultHtml(
      {
        studentName: student.fullName,
        examTitle: attempt.exam.title,
        courseTitle: attempt.exam.course.title,
        submittedAt: attempt.submittedAt,
        score: attempt.score || 0,
        totalMarks: attempt.exam.totalMarks,
        passingMarks: attempt.exam.passingMarks,
        percentage,
        isPassed: Boolean(attempt.isPassed),
        showCorrectAnswers: attempt.exam.showCorrectAnswersAfterSubmission,
        questions,
      },
      fontFaceCss,
    );

    const buffer = await this.pdfGenerator.htmlToPdf(html);

    const fileName = `نتيجة-${attempt.exam.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 40)}.pdf`;
    return { buffer, fileName };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: All My Results (exams + quizzes across all courses)
  // ─────────────────────────────────────────────────────────────
  async getMyResults(user: AuthUser) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const [examAttempts, quizAttempts, homeworkAttempts] = await Promise.all([
      this.prisma.examAttempt.findMany({
        where: {
          studentId: student.id,
          status: { not: ExamAttemptStatus.IN_PROGRESS },
        },
        include: {
          exam: {
            select: {
              id: true,
              title: true,
              totalMarks: true,
              passingMarks: true,
              course: { select: { id: true, title: true } },
            },
          },
        },
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      }),
      this.prisma.quizAttempt.findMany({
        where: {
          studentId: student.id,
          status: { not: QuizAttemptStatus.IN_PROGRESS },
        },
        include: {
          quiz: {
            select: {
              id: true,
              title: true,
              passingPercentage: true,
              lesson: {
                select: {
                  courseId: true,
                  course: { select: { title: true } },
                },
              },
            },
          },
        },
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      }),
      this.prisma.homeworkAttempt.findMany({
        where: {
          studentId: student.id,
          status: { not: QuizAttemptStatus.IN_PROGRESS },
        },
        include: {
          homework: {
            select: {
              id: true,
              title: true,
              passingPercentage: true,
              lesson: {
                select: {
                  id: true,
                  courseId: true,
                  course: { select: { id: true, title: true } },
                },
              },
            },
          },
          answers: {
            select: {
              teacherGrade: true,
              question: { select: { requiresImageAnswer: true } },
            },
          },
        },
        orderBy: [{ submittedAt: 'desc' }, { startedAt: 'desc' }],
        take: 200,
      }),
    ]);

    return {
      examAttempts: examAttempts.map((a) => ({
        id: a.id,
        attemptNumber: a.attemptNumber,
        score: a.score ?? 0,
        totalMarks: a.exam.totalMarks,
        passingMarks: a.exam.passingMarks,
        isPassed: a.isPassed,
        status: a.status,
        submittedAt: a.submittedAt,
        examId: a.exam.id,
        title: a.exam.title,
        courseTitle: a.exam.course.title,
      })),
      quizAttempts: quizAttempts.map((a) => ({
        id: a.id,
        attemptNumber: a.attemptNumber,
        score: a.earnedMarks ?? 0,
        totalMarks: a.totalMarks ?? 0,
        isPassed: a.isPassed,
        status: a.status,
        submittedAt: a.submittedAt,
        quizId: a.quiz.id,
        title: a.quiz.title,
        courseTitle: a.quiz.lesson.course.title,
      })),
      homeworkAttempts: homeworkAttempts.map((a) => {
        const hasPendingEssay = a.answers.some(
          (ans) => ans.question.requiresImageAnswer && ans.teacherGrade === null,
        );
        return {
          id: a.id,
          attemptNumber: a.attemptNumber,
          score: a.score ?? 0,
          earnedMarks: a.earnedMarks ?? 0,
          totalMarks: a.totalMarks ?? 0,
          isPassed: a.isPassed,
          status: a.status,
          submittedAt: a.submittedAt,
          homeworkId: a.homework.id,
          title: a.homework.title,
          lessonId: a.homework.lesson.id,
          courseId: a.homework.lesson.courseId,
          courseTitle: a.homework.lesson.course.title,
          hasPendingEssay,
        };
      }),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: My Mistakes Notebook — every wrong answer across all
  // submitted exam + quiz attempts, grouped by section → source → date.
  // Content is reconstructed from the per-attempt snapshot so shuffled
  // option order matches exactly what the student saw.
  // ─────────────────────────────────────────────────────────────
  async getMyMistakes(user: AuthUser) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const [examAttempts, quizAttempts, homeworkAttempts] = await Promise.all([
      this.prisma.examAttempt.findMany({
        where: {
          studentId: student.id,
          status: { in: [ExamAttemptStatus.SUBMITTED, ExamAttemptStatus.TIMED_OUT] },
        },
        select: {
          id: true,
          attemptNumber: true,
          submittedAt: true,
          createdAt: true,
          questionSnapshots: true,
          exam: {
            select: {
              id: true,
              title: true,
              course: { select: { id: true, title: true } },
              lesson: {
                select: {
                  id: true,
                  title: true,
                  section: { select: { id: true, title: true } },
                },
              },
            },
          },
          answers: {
            where: { isCorrect: false },
            select: {
              questionId: true,
              selectedOptionIndex: true,
              createdAt: true,
              question: {
                select: {
                  text: true,
                  imageUrl: true,
                  options: true,
                  correctOptionIndex: true,
                  explanation: true,
                },
              },
            },
          },
        },
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        take: 50,
      }),
      this.prisma.quizAttempt.findMany({
        where: {
          studentId: student.id,
          status: QuizAttemptStatus.SUBMITTED,
        },
        select: {
          id: true,
          attemptNumber: true,
          submittedAt: true,
          createdAt: true,
          quiz: {
            select: {
              id: true,
              title: true,
              lesson: {
                select: {
                  id: true,
                  title: true,
                  course: { select: { id: true, title: true } },
                  section: { select: { id: true, title: true } },
                },
              },
            },
          },
          answers: {
            where: { isCorrect: false },
            select: {
              questionId: true,
              selectedOptionIndex: true,
              createdAt: true,
              question: {
                select: {
                  text: true,
                  options: true,
                  correctOptionIndex: true,
                  explanation: true,
                },
              },
            },
          },
        },
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        take: 50,
      }),
      this.prisma.homeworkAttempt.findMany({
        where: {
          studentId: student.id,
          status: QuizAttemptStatus.SUBMITTED,
        },
        select: {
          id: true,
          attemptNumber: true,
          submittedAt: true,
          startedAt: true,
          homework: {
            select: {
              id: true,
              title: true,
              lesson: {
                select: {
                  id: true,
                  title: true,
                  course: { select: { id: true, title: true } },
                  section: { select: { id: true, title: true } },
                },
              },
            },
          },
          answers: {
            where: { isCorrect: false },
            select: {
              questionId: true,
              selectedOptionIndex: true,
              createdAt: true,
              question: {
                select: {
                  text: true,
                  options: true,
                  correctOptionIndex: true,
                  explanation: true,
                },
              },
            },
          },
        },
        orderBy: [{ submittedAt: 'desc' }, { startedAt: 'desc' }],
        take: 50,
      }),
    ]);

    const groups = new Map<string, MistakeGroup>();

    const pushQuestions = (
      group: MistakeGroup,
      wrongAnswers: {
        questionId: string;
        selectedOptionIndex: number | null;
        createdAt: Date;
        question: { text: string; imageUrl?: string | null; options: unknown; correctOptionIndex: number; explanation: string | null };
      }[],
      snapshots: unknown,
      attemptNumber: number,
      submittedAt: Date | null,
    ) => {
      const snapMap = new Map(
        Array.isArray(snapshots)
          ? (snapshots as { id: string; imageUrl?: string | null; options: unknown }[]).map((s) => [s.id, s])
          : [],
      );

      for (const ans of wrongAnswers) {
        // Prefer the immutable snapshot (shuffled option order) over live content
        const snap = snapMap.get(ans.questionId);
        const options = Array.isArray(snap?.options ?? ans.question.options)
          ? ((snap?.options ?? ans.question.options) as string[])
          : [];
        if (options.length === 0) continue;

        // Keep only the most recent wrong occurrence of each question
        const existing = group.questions.findIndex((q) => q.questionId === ans.questionId);
        const mistake: MistakeQuestion = {
          questionId: ans.questionId,
          text: ans.question.text,
          imageUrl: snap?.imageUrl ?? ans.question.imageUrl ?? null,
          options,
          yourAnswerIndex: ans.selectedOptionIndex,
          correctAnswerIndex: ans.question.correctOptionIndex,
          explanation: ans.question.explanation ?? null,
          attemptNumber,
          answeredAt: submittedAt ?? ans.createdAt,
        };
        if (existing >= 0) group.questions[existing] = mistake;
        else group.questions.push(mistake);
      }
    };

    for (const attempt of examAttempts) {
      if (attempt.answers.length === 0) continue;
      const key = `EXAM:${attempt.exam.id}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          id: key,
          type: 'EXAM',
          sourceId: attempt.exam.id,
          courseId: attempt.exam.course.id,
          title: attempt.exam.title,
          courseTitle: attempt.exam.course.title,
          sectionName: attempt.exam.lesson?.section?.title ?? null,
          lessonTitle: attempt.exam.lesson?.title ?? null,
          lastDate: (attempt.submittedAt ?? attempt.createdAt)?.toISOString() ?? null,
          questions: [],
        };
        groups.set(key, group);
      }
      pushQuestions(group, attempt.answers, attempt.questionSnapshots, attempt.attemptNumber, attempt.submittedAt);
    }

    for (const attempt of quizAttempts) {
      if (attempt.answers.length === 0) continue;
      const key = `QUIZ:${attempt.quiz.id}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          id: key,
          type: 'QUIZ',
          sourceId: attempt.quiz.id,
          courseId: attempt.quiz.lesson.course.id,
          title: attempt.quiz.title,
          courseTitle: attempt.quiz.lesson.course.title,
          sectionName: attempt.quiz.lesson.section?.title ?? null,
          lessonTitle: attempt.quiz.lesson.title,
          lastDate: (attempt.submittedAt ?? attempt.createdAt)?.toISOString() ?? null,
          questions: [],
        };
        groups.set(key, group);
      }
      pushQuestions(group, attempt.answers, null, attempt.attemptNumber, attempt.submittedAt);
    }

    for (const attempt of homeworkAttempts) {
      if (attempt.answers.length === 0) continue;
      const key = `HOMEWORK:${attempt.homework.id}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          id: key,
          type: 'HOMEWORK',
          sourceId: attempt.homework.id,
          courseId: attempt.homework.lesson?.course?.id ?? '',
          title: attempt.homework.title,
          courseTitle: attempt.homework.lesson?.course?.title ?? '',
          sectionName: attempt.homework.lesson?.section?.title ?? null,
          lessonTitle: attempt.homework.lesson?.title ?? null,
          lastDate: (attempt.submittedAt ?? attempt.startedAt)?.toISOString() ?? null,
          questions: [],
        };
        groups.set(key, group);
      }
      pushQuestions(group, attempt.answers, null, attempt.attemptNumber, attempt.submittedAt);
    }

    const resultGroups = Array.from(groups.values())
      .filter((g) => g.questions.length > 0)
      .sort(
        (a, b) =>
          new Date(b.lastDate ?? 0).getTime() - new Date(a.lastDate ?? 0).getTime(),
      );

    const totalWrong = resultGroups.reduce((acc, g) => acc + g.questions.length, 0);

    return {
      hasMistakes: totalWrong > 0,
      summary: {
        totalWrong,
        examWrong: resultGroups
          .filter((g) => g.type === 'EXAM')
          .reduce((acc, g) => acc + g.questions.length, 0),
        quizWrong: resultGroups
          .filter((g) => g.type === 'QUIZ')
          .reduce((acc, g) => acc + g.questions.length, 0),
        homeworkWrong: resultGroups
          .filter((g) => g.type === 'HOMEWORK')
          .reduce((acc, g) => acc + g.questions.length, 0),
      },
      groups: resultGroups.map((g) => ({
        ...g,
        questions: g.questions.sort(
          (a, b) =>
            new Date(b.answeredAt ?? 0).getTime() - new Date(a.answeredAt ?? 0).getTime(),
        ),
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Generate Timed Practice Exam from Mistakes
  // ─────────────────────────────────────────────────────────────
  async generateMistakePracticeExam(user: AuthUser, dto: GenerateMistakePracticeDto) {
    const mistakesData = await this.getMyMistakes(user);
    if (!mistakesData.hasMistakes || mistakesData.groups.length === 0) {
      throw new BadRequestException('لا توجد أخطاء مسجلة لديك لبدء امتحان تدريبي.');
    }

    let filteredGroups = mistakesData.groups;

    if (dto.groupId) {
      filteredGroups = filteredGroups.filter((g) => g.id === dto.groupId);
      if (filteredGroups.length === 0) {
        throw new NotFoundException('لم يتم العثور على مجموعة الأخطاء المحددة.');
      }
    } else if (dto.courseId) {
      filteredGroups = filteredGroups.filter((g) => g.courseId === dto.courseId);
      if (filteredGroups.length === 0) {
        throw new NotFoundException('لا توجد أخطاء مسجلة في هذا الكورس.');
      }
    }

    // Collect unique questions across the selected groups
    const uniqueQuestionsMap = new Map<string, MistakeQuestion>();
    for (const group of filteredGroups) {
      for (const q of group.questions) {
        if (!uniqueQuestionsMap.has(q.questionId)) {
          uniqueQuestionsMap.set(q.questionId, q);
        }
      }
    }

    const allMistakeQuestions = Array.from(uniqueQuestionsMap.values());
    if (allMistakeQuestions.length === 0) {
      throw new BadRequestException('لا توجد أسئلة أخطاء متاحة للتدريب.');
    }

    // Shuffle questions
    const shuffled = [...allMistakeQuestions].sort(() => Math.random() - 0.5);
    const limit = Math.min(dto.count || 20, shuffled.length);
    const selectedQuestions = shuffled.slice(0, limit);

    // 2 minutes per question (minimum 5 minutes)
    const timeLimitMinutes = Math.max(5, selectedQuestions.length * 2);

    const firstGroup = filteredGroups[0];
    const practiceTitle = dto.groupId
      ? `امتحان تدريبي: ${firstGroup.title}`
      : dto.courseId
      ? `امتحان تدريبي لأخطاء كورس: ${firstGroup.courseTitle}`
      : 'امتحان تدريبي شامل من بنك أخطائي';

    return {
      practiceId: randomUUID(),
      title: practiceTitle,
      courseTitle: firstGroup.courseTitle || 'جميع الكورسات',
      courseId: dto.courseId || firstGroup.courseId || null,
      sourceType: dto.groupId ? firstGroup.type : (dto.courseId ? 'COURSE' : 'ALL'),
      timeLimitMinutes,
      totalQuestions: selectedQuestions.length,
      questions: selectedQuestions.map((q, idx) => ({
        id: q.questionId,
        orderIndex: idx + 1,
        text: q.text,
        imageUrl: q.imageUrl,
        options: q.options,
        marks: 1,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Submit & Grade Timed Practice Exam from Mistakes
  // ─────────────────────────────────────────────────────────────
  async submitMistakePracticeExam(user: AuthUser, dto: SubmitMistakePracticeDto) {
    const questionIds = dto.answers.map((a) => a.questionId);
    if (questionIds.length === 0) {
      throw new BadRequestException('لا توجد إجابات مرسلة.');
    }

    // Query questions from ExamQuestion, QuizQuestion, HomeworkQuestion
    const [examQuestions, quizQuestions, homeworkQuestions] = await Promise.all([
      this.prisma.question.findMany({
        where: { id: { in: questionIds } },
        select: { id: true, text: true, imageUrl: true, options: true, correctOptionIndex: true, explanation: true },
      }),
      this.prisma.quizQuestion.findMany({
        where: { id: { in: questionIds } },
        select: { id: true, text: true, options: true, correctOptionIndex: true, explanation: true },
      }),
      this.prisma.homeworkQuestion.findMany({
        where: { id: { in: questionIds } },
        select: { id: true, text: true, options: true, correctOptionIndex: true, explanation: true },
      }),
    ]);

    const qMap = new Map<string, {
      text: string;
      imageUrl?: string | null;
      options: string[];
      correctOptionIndex: number;
      explanation: string | null;
    }>();

    for (const q of examQuestions) {
      qMap.set(q.id, {
        text: q.text,
        imageUrl: q.imageUrl ?? null,
        options: Array.isArray(q.options) ? (q.options as string[]) : [],
        correctOptionIndex: q.correctOptionIndex,
        explanation: q.explanation ?? null,
      });
    }

    for (const q of quizQuestions) {
      qMap.set(q.id, {
        text: q.text,
        imageUrl: null,
        options: Array.isArray(q.options) ? (q.options as string[]) : [],
        correctOptionIndex: q.correctOptionIndex,
        explanation: q.explanation ?? null,
      });
    }

    for (const q of homeworkQuestions) {
      qMap.set(q.id, {
        text: q.text,
        imageUrl: null,
        options: Array.isArray(q.options) ? (q.options as string[]) : [],
        correctOptionIndex: q.correctOptionIndex,
        explanation: q.explanation ?? null,
      });
    }

    let earnedMarks = 0;
    const totalMarks = dto.answers.length;

    const detailedResults = dto.answers.map((ans, idx) => {
      const q = qMap.get(ans.questionId);
      const isCorrect = q ? ans.selectedOptionIndex === q.correctOptionIndex : false;
      if (isCorrect) earnedMarks += 1;

      return {
        questionId: ans.questionId,
        orderIndex: idx + 1,
        text: q?.text ?? '',
        imageUrl: q?.imageUrl ?? null,
        options: q?.options ?? [],
        selectedOptionIndex: ans.selectedOptionIndex ?? null,
        correctOptionIndex: q?.correctOptionIndex ?? 0,
        isCorrect,
        explanation: q?.explanation ?? null,
      };
    });

    const percentage = totalMarks > 0 ? Math.round((earnedMarks / totalMarks) * 100) : 0;
    const isPassed = percentage >= 50;

    return {
      practiceId: dto.practiceId,
      score: earnedMarks,
      totalMarks,
      percentage,
      isPassed,
      timeSpentSeconds: dto.timeSpentSeconds,
      submittedAt: new Date().toISOString(),
      detailedResults,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // CRON: Auto-Expire Timed-Out IN_PROGRESS Attempts
  // ─────────────────────────────────────────────────────────────
  // CRON: Auto-Publish Scheduled Exams Whose Window Has Started
  // Teacher schedules startAt/endAt as a draft; the exam publishes
  // itself automatically the moment its window opens.
  // ─────────────────────────────────────────────────────────────
  @Cron(CronExpression.EVERY_MINUTE)
  async autoPublishScheduledExams() {
    try {
      const now = new Date();
      const exams = await this.prisma.exam.findMany({
        where: {
          isPublished: false,
          isDeleted: false,
          startAt: { lte: now },
          OR: [{ endAt: null }, { endAt: { gt: now } }],
        },
        select: { id: true, courseId: true, title: true },
      });
      if (exams.length === 0) return;

      await this.prisma.exam.updateMany({
        where: { id: { in: exams.map((e) => e.id) } },
        data: { isPublished: true },
      });
      this.logger.log(`📢 Auto-published ${exams.length} scheduled exam(s).`);

      for (const exam of exams) {
        this.notificationsService
          .notifyEnrolledStudents(exam.courseId, {
            type: 'EXAM_NEW',
            title: 'بدأ الامتحان الآن',
            body: `الامتحان "${exam.title}" متاح الآن، ادخل وابدأ قبل انتهاء الوقت.`,
            linkUrl: `/courses/${exam.courseId}/exams`,
          })
          .catch(() => undefined);
      }
    } catch (err) {
      this.logger.error('Failed to auto-publish scheduled exams.', err as Error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // CRON: Auto-Unpublish Exams Whose Window Has Closed
  // Once endAt passes, the exam flips to draft — students can no
  // longer see or enter it anywhere.
  // ─────────────────────────────────────────────────────────────
  @Cron(CronExpression.EVERY_MINUTE)
  async autoUnpublishEndedExams() {
    try {
      const now = new Date();
      const result = await this.prisma.exam.updateMany({
        where: {
          isPublished: true,
          isDeleted: false,
          endAt: { lt: now },
        },
        data: { isPublished: false },
      });
      if (result.count > 0) {
        this.logger.log(`🔒 Auto-unpublished ${result.count} ended exam(s).`);
      }
    } catch (err) {
      this.logger.error('Failed to auto-unpublish ended exams.', err as Error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireTimedOutAttempts() {
    const now = new Date();
    const timedOut = await this.prisma.examAttempt.findMany({
      where: {
        status: ExamAttemptStatus.IN_PROGRESS,
        expiresAt: { lt: now },
      },
      include: {
        exam: {
          include: {
            questions: { where: { isDeleted: false } },
            course: {
              select: { id: true, title: true, teacher: { select: { userId: true } } },
            },
          },
        },
        student: { select: { fullName: true } },
      },
    });

    if (timedOut.length === 0) return;

    this.logger.warn(`⏰ Auto-expiring ${timedOut.length} timed-out exam attempt(s).`);

    for (const attempt of timedOut) {
      // Submit with empty answers — score = 0
      const questions = attempt.exam.questions;
      const emptyAnswers = questions.map((q) => ({
        attemptId: attempt.id,
        questionId: q.id,
        selectedOptionIndex: null,
        isCorrect: false,
        awardedMarks: 0,
      }));

      await this.prisma.$transaction([
        this.prisma.examAttempt.update({
          where: { id: attempt.id },
          data: {
            status: ExamAttemptStatus.TIMED_OUT,
            submittedAt: now,
            score: 0,
            isPassed: false,
          },
        }),
        this.prisma.attemptAnswer.createMany({
          data: emptyAnswers,
          skipDuplicates: true,
        }),
      ]);

      // إشعار المدرس بانتهاء وقت محاولة الطالب تلقائياً
      if (attempt.exam.course?.teacher?.userId) {
        this.notificationsService
          .notify({
            userId: attempt.exam.course.teacher.userId,
            type: 'EXAM_SUBMITTED',
            title: 'انتهى وقت امتحان طالب',
            body: `انتهى وقت الطالب "${attempt.student.fullName}" في امتحان "${attempt.exam.title}" من كورس "${attempt.exam.course.title}" وتم تسليمه تلقائياً.`,
            linkUrl: `/dashboard/exams/${attempt.exam.id}/submissions`,
          })
          .catch(() => undefined);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────
  /** One-browser lock: an in-progress attempt only accepts its issued session key. */
  private assertAttemptSession(
    attempt: { status: ExamAttemptStatus; sessionKey: string | null },
    providedSessionKey?: string,
  ) {
    if (
      attempt.status === ExamAttemptStatus.IN_PROGRESS &&
      attempt.sessionKey &&
      attempt.sessionKey !== providedSessionKey
    ) {
      throw new ForbiddenException(
        'هذا الامتحان مفتوح بالفعل في متصفح آخر. أكمل الامتحان من نفس المتصفح.',
      );
    }
  }

  private shuffleArray<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /**
   * Build an immutable per-attempt snapshot of question content.
   * When shuffleOptions is enabled, options are shuffled and
   * correctOptionIndex is remapped to the shuffled position — grading
   * then compares directly against the snapshot.
   */
  private buildQuestionSnapshots(
    questions: { id: string; text: string; imageUrl: string | null; options: unknown; correctOptionIndex: number; explanation?: string | null; marks: number }[],
    shuffleOptions: boolean,
  ): { id: string; text: string; imageUrl: string | null; options: unknown; correctOptionIndex: number; explanation: string | null; marks: number }[] {
    return questions.map((q) => {
      let options = Array.isArray(q.options) ? [...(q.options as string[])] : [];
      let correctOptionIndex = q.correctOptionIndex;

      if (shuffleOptions && options.length > 1) {
        const indexed = options.map((opt, idx) => ({ opt, idx }));
        const shuffled = this.shuffleArray(indexed);
        options = shuffled.map((s) => s.opt);
        correctOptionIndex = shuffled.findIndex((s) => s.idx === q.correctOptionIndex);
      }

      return {
        id: q.id,
        text: q.text,
        imageUrl: q.imageUrl,
        options,
        correctOptionIndex,
        explanation: q.explanation ?? null,
        marks: q.marks,
      };
    });
  }

  /** Snapshot list for a resumed attempt: stored snapshots, or freshly built fallback. */
  private getAttemptSnapshotList(
    attempt: { questionSnapshots: unknown },
    fallbackSnapshots: { id: string; text: string; imageUrl: string | null; options: unknown; correctOptionIndex: number; explanation: string | null; marks: number }[],
  ) {
    const snaps = attempt.questionSnapshots;
    if (Array.isArray(snaps) && snaps.length > 0) {
      return snaps as { id: string; text: string; imageUrl: string | null; options: unknown; correctOptionIndex: number; explanation: string | null; marks: number }[];
    }
    return fallbackSnapshots;
  }

  /**
   * Randomized exam support: materialize questions from the course Question
   * Bank into this exam according to the configured difficulty distribution.
   * Runs once (first start) so AttemptAnswer foreign keys remain valid.
   */
  private async materializeBankQuestions(exam: {
    id: string;
    courseId: string;
    bankEasyCount: number;
    bankMediumCount: number;
    bankHardCount: number;
  }) {
    const wanted = (
      [
        { difficulty: 'EASY', count: exam.bankEasyCount },
        { difficulty: 'MEDIUM', count: exam.bankMediumCount },
        { difficulty: 'HARD', count: exam.bankHardCount },
      ] as const
    ).filter((w) => w.count > 0);

    if (wanted.length === 0) return;

    let orderIndex =
      (
        await this.prisma.question.findFirst({
          where: { examId: exam.id, isDeleted: false },
          orderBy: { orderIndex: 'desc' },
        })
      )?.orderIndex ?? 0;

    for (const w of wanted) {
      const pool = await this.prisma.questionBank.findMany({
        where: { courseId: exam.courseId, difficulty: w.difficulty, isDeleted: false },
      });
      const selected = this.shuffleArray(pool).slice(0, w.count);

      if (selected.length > 0) {
        await this.prisma.question.createMany({
          data: selected.map((q) => ({
            examId: exam.id,
            text: q.text,
            imageUrl: q.imageUrl,
            options: q.options,
            correctOptionIndex: q.correctOptionIndex,
            explanation: q.explanation,
            marks: q.marks,
            orderIndex: ++orderIndex,
          })),
        });
      }
    }
  }

  private async getTeacher(userId: string) {
    const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId } });
    if (!teacher) throw new ForbiddenException('Teacher profile not found.');
    return teacher;
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Reactivate a student's exam attempts (reset locks / attempts)
  // ─────────────────────────────────────────────────────────────
  async reactivateStudentExamAttempt(examId: string, studentId: string, user: AuthUser) {
    const { exam } = await this.findExamAsTeacherOwner(examId, user);

    const attempts = await this.prisma.examAttempt.findMany({
      where: { examId, studentId },
      select: { id: true },
    });

    if (attempts.length === 0) {
      throw new NotFoundException('لا توجد محاولات سابقة لهذا الطالب على هذا الامتحان.');
    }

    const attemptIds = attempts.map((a) => a.id);
    await this.prisma.attemptAnswer.deleteMany({
      where: { attemptId: { in: attemptIds } },
    });
    await this.prisma.examAttemptExit.deleteMany({
      where: { attemptId: { in: attemptIds } },
    });
    await this.prisma.examAchievement.deleteMany({
      where: { examId, studentId },
    });
    await this.prisma.examAttempt.deleteMany({
      where: { id: { in: attemptIds } },
    });

    const student = await this.prisma.studentProfile.findUnique({
      where: { id: studentId },
      select: { userId: true, fullName: true },
    });

    if (student) {
      await this.notificationsService.notify({
        userId: student.userId,
        type: 'EXAM_NEW',
        title: '🔄 تم تنشيط محاولة الامتحان',
        body: `قام المعلم بتنشيط محاولة امتحان "${exam.title}" لك. يمكنك البدء الآن!`,
        linkUrl: `/courses/${exam.courseId}/exams/${exam.id}`,
      }).catch(() => undefined);
    }

    return {
      message: `تم تنشيط محاولة الامتحان بنجاح للطالب ${student?.fullName ?? ''}.`,
    };
  }

  private async findExamAsTeacherOwner(examId: string, user: AuthUser) {
    if (user.role === Role.ADMIN) {
      // ADMIN can inspect any attempt paper, even for soft-deleted exams.
      const exam = await this.prisma.exam.findFirst({
        where: { id: examId },
        include: { course: { select: { teacherId: true } } },
      });
      if (!exam) throw new NotFoundException('Exam not found.');
      return { exam, teacherId: exam.course.teacherId };
    }

    const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id } });
    if (!teacher) throw new ForbiddenException('Teacher profile not found.');

    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, isDeleted: false },
      include: { course: { select: { teacherId: true } } },
    });
    if (!exam) throw new NotFoundException('Exam not found.');
    if (exam.course.teacherId !== teacher.id) {
      throw new ForbiddenException('You do not own this exam.');
    }

    return { exam, teacherId: teacher.id };
  }

  private async ensureStudentEnrolled(userId: string, courseId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId: student.id, courseId, status: EnrollmentStatus.ACTIVE },
    });
    if (!enrollment) {
      throw new ForbiddenException('You must have an active enrollment in this course to access its exams.');
    }

    return student;
  }
}
