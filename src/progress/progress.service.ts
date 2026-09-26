import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentStatus, ExamAttemptStatus, QuizAttemptStatus, Role } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GamificationService } from '../gamification/gamification.service';
import { CoinsService } from '../coins/coins.service';
import { CertificatesService } from '../certificates/certificates.service';
import { canManageCourse } from '../common/utils/course-access.util';
import { UpdateProgressDto } from './dtos/update-progress.dto';
import { LessonAccessService } from '../lessons/lesson-access.service';
import { LESSON_COMPLETION_THRESHOLD } from '../common/constants/lesson-completion.constants';

@Injectable()
export class ProgressService {
  private readonly logger = new Logger(ProgressService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly gamificationService: GamificationService,
    private readonly coinsService: CoinsService,
    private readonly certificatesService: CertificatesService,
    private readonly lessonAccessService: LessonAccessService,
  ) {}

  /**
   * تحديث نسبة مشاهدة الدرس للطلاب المشتركين
   * إذا وصلت النسبة 90% أو أكثر، يتم تعليم الدرس كمكتمل isCompleted = true
   * النسبة لا ترتد للخلف (تأخذ القيمة الأكبر دائماً)
   */
  async updateLessonProgress(lessonId: string, userId: string, dto: UpdateProgressDto) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
    });
    if (!student) {
      throw new ForbiddenException('Student profile not found.');
    }

    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, isDeleted: false },
      include: { course: true },
    });
    if (!lesson) {
      throw new NotFoundException('Lesson not found.');
    }

    // التحقق من اشتراك الطالب النشط في الكورس
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId: student.id,
        courseId: lesson.courseId,
        status: EnrollmentStatus.ACTIVE,
      },
    });
    if (!enrollment) {
      throw new ForbiddenException('You must have an active enrollment in this course to track progress.');
    }

    // استرجاع التقدم الحالي لضمان عدم الرجوع للخلف
    const currentProgress = await this.prisma.progress.findUnique({
      where: {
        studentId_lessonId: {
          studentId: student.id,
          lessonId,
        },
      },
    });

    const highestPercentage = Math.max(
      currentProgress?.watchedPercentage ?? 0,
      dto.watchedPercentage,
    );
    const isCompleted = currentProgress?.isCompleted || highestPercentage >= LESSON_COMPLETION_THRESHOLD;

    // موضع الاستئناف: لا نحفظ الموضع إذا اكتمل الدرس (يعني 0 للبدء من الأول عند إعادة المشاهدة)
    const lastPositionSeconds =
      isCompleted ? 0 : Math.max(currentProgress?.lastPositionSeconds ?? 0, dto.positionSeconds ?? 0);

    const progress = await this.prisma.progress.upsert({
      where: {
        studentId_lessonId: {
          studentId: student.id,
          lessonId,
        },
      },
      update: {
        watchedPercentage: highestPercentage,
        isCompleted,
        lastPositionSeconds,
        ...(dto.durationSeconds !== undefined && { videoDurationSeconds: dto.durationSeconds }),
        lastWatchedAt: new Date(),
      },
      create: {
        studentId: student.id,
        lessonId,
        watchedPercentage: highestPercentage,
        isCompleted,
        lastPositionSeconds,
        videoDurationSeconds: dto.durationSeconds ?? null,
        lastWatchedAt: new Date(),
      },
    });

    // Gamification: daily streak activity
    await this.gamificationService.recordActivity(student.id);

    // إذا كان هذا أول إكمال للدرس، تحقق من اكتمال الكورس بالكامل
    let coinsEarned = 0;
    if (isCompleted && !currentProgress?.isCompleted) {
      // Coins: award 10 coins for lesson completion (fire-and-forget)
      try {
        await this.coinsService.addCoins(
          student.id,
          10,
          'EARN_LESSON',
          lessonId,
          `درس "${lesson.title}"`,
        );
        coinsEarned = 10;
      } catch (e) {
        this.logger.error(`Failed to award coins for lesson completion: ${e}`);
      }

      await this.checkCourseCompletion(student.id, lesson.courseId, lessonId).catch((e) =>
        this.logger.error(`Course completion check failed: ${e}`),
      );
    }

    // Compute quiz/homework completion for the response so the frontend
    // can optimistically update the sidebar without a full refetch.
    const [quizCompleted, homeworkCompleted] = await Promise.all([
      this.lessonAccessService.isLessonQuizCompleted(student.id, lessonId),
      this.lessonAccessService.isLessonHomeworkCompleted(student.id, lessonId),
    ]);

    return {
      message: isCompleted && !currentProgress?.isCompleted
        ? 'Lesson marked as completed!'
        : 'Progress updated successfully.',
      coinsEarned,
      progress: {
        lessonId: progress.lessonId,
        watchedPercentage: progress.watchedPercentage,
        isCompleted: progress.isCompleted,
        lastPositionSeconds: progress.lastPositionSeconds,
        lastWatchedAt: progress.lastWatchedAt,
        quizCompleted,
        homeworkCompleted,
      },
    };
  }

  private async checkCourseCompletion(
    studentId: string,
    courseId: string,
    justCompletedLessonId: string,
  ) {
    const totalLessons = await this.prisma.lesson.count({
      where: { courseId, isDeleted: false },
    });
    if (totalLessons === 0) return;

    const completedLessons = await this.prisma.progress.count({
      where: { studentId, isCompleted: true, lesson: { courseId, isDeleted: false } },
    });

    if (completedLessons === totalLessons) {
      const student = await this.prisma.studentProfile.findUnique({
        where: { id: studentId },
        select: { userId: true },
      });
      if (!student) return;

      await this.notificationsService.notify({
        userId: student.userId,
        type: 'COURSE_COMPLETED',
        title: 'أنهيت الكورس بالكامل!',
        body: 'مبروك! أكملت مشاهدة جميع دروس الكورس. جرب نفسك الآن في الامتحانات.',
        linkUrl: `/courses/${courseId}/exams`,
      });
      await this.gamificationService.awardBadge(studentId, 'COURSE_COMPLETED');
      // إصدار شهادة إتمام الكورس (idempotent)
      await this.certificatesService.issue(studentId, courseId);
      void justCompletedLessonId;
    }
  }

  /**
   * استرجاع تقدم الطالب في كل دروس الكورس مع النسبة الإجمالية
   */
  async getCourseProgress(courseId: string, userId: string) {
    const existingCourse = await this.prisma.course.findFirst({
      where: { id: courseId, isDeleted: false },
      select: { id: true },
    });
    if (!existingCourse) {
      throw new NotFoundException('Course not found.');
    }

    const isManager = await canManageCourse(this.prisma, userId, courseId);

    const student = isManager
      ? null
      : await this.prisma.studentProfile.findUnique({
          where: { userId },
        });
    if (!isManager && !student) {
      throw new ForbiddenException('Student profile not found.');
    }

    const course = await this.prisma.course.findFirst({
      where: { id: courseId, isDeleted: false },
      include: {
        lessons: {
          where: { isDeleted: false },
          orderBy: { orderIndex: 'asc' },
        },
        sections: {
          orderBy: { order: 'asc' },
          include: {
            lessons: {
              where: { isDeleted: false },
              orderBy: { orderIndex: 'asc' },
              select: { id: true },
            },
          },
        },
      },
    });
    if (!course) {
      throw new NotFoundException('Course not found.');
    }

    if (!isManager) {
      const enrollment = await this.prisma.enrollment.findFirst({
        where: {
          studentId: student!.id,
          courseId,
          status: EnrollmentStatus.ACTIVE,
        },
      });
      if (!enrollment) {
        throw new ForbiddenException('You must have an active enrollment in this course.');
      }
    }

    // جلب تقدم كل دروس هذا الكورس
    const progresses = student
      ? await this.prisma.progress.findMany({
          where: {
            studentId: student.id,
            lesson: { courseId, isDeleted: false },
          },
        })
      : [];

    const progressMap = new Map(progresses.map((p) => [p.lessonId, p]));

    // Phase 1 — per-lesson sequential unlock states (LOCKED/AVAILABLE/etc.)
    const lessonStates = student
      ? await this.lessonAccessService
          .getCourseLessonStates(courseId, student.id)
          .catch((e) => {
            this.logger.error(`getCourseLessonStates failed: ${e}`);
            return new Map();
          })
      : new Map();

    const lessonsProgress = course.lessons.map((lesson) => {
      const p = progressMap.get(lesson.id);
      const state: any = lessonStates.get(lesson.id);
      return {
        lessonId: lesson.id,
        title: lesson.title,
        sectionId: lesson.sectionId,
        orderIndex: lesson.orderIndex,
        // Prefer the real duration measured during playback over the
        // manually-entered stored value (which is often wrong/stale)
        durationSeconds: p?.videoDurationSeconds ?? lesson.durationSeconds,
        watchedPercentage: p?.watchedPercentage ?? 0,
        isCompleted: p?.isCompleted ?? false,
        lastPositionSeconds: p?.lastPositionSeconds ?? 0,
        lastWatchedAt: p?.lastWatchedAt ?? null,
        status: state?.status ?? (p?.isCompleted ? 'COMPLETED' : 'AVAILABLE'),
        quizCompleted: state?.quizCompleted ?? true,
        homeworkCompleted: state?.homeworkCompleted ?? true,
        lockReasonCode: state?.lockReasonCode ?? null,
        lockMessage: state?.lockMessage ?? null,
      };
    });

    const totalLessons = course.lessons.length;
    const completedLessons = lessonsProgress.filter((l) => l.isCompleted).length;
    const courseProgressPercentage =
      totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

    // تجميع التقدم حسب الأقسام (Section-level rollup)
    const sections = (course.sections ?? []).map((section) => {
      const sectionLessonIds = new Set(section.lessons.map((l) => l.id));
      const sectionLessons = lessonsProgress.filter(
        (l) => l.sectionId !== null && sectionLessonIds.has(l.lessonId),
      );
      const completedInSection = sectionLessons.filter((l) => l.isCompleted).length;
      return {
        sectionId: section.id,
        title: section.title,
        order: section.order,
        totalLessons: sectionLessons.length,
        completedLessons: completedInSection,
        completionPercentage:
          sectionLessons.length > 0
            ? Math.round((completedInSection / sectionLessons.length) * 100)
            : 0,
      };
    });

    // آخر درس تمت مشاهدته ولم يكتمل بعد — للاستئناف من نفس الموضع
    const resumeCandidate =
      [...lessonsProgress]
        .filter((l) => !l.isCompleted && l.lastWatchedAt !== null)
        .sort((a, b) => b.lastWatchedAt!.getTime() - a.lastWatchedAt!.getTime())[0] ?? null;

    const firstIncomplete =
      lessonsProgress.find((l) => !l.isCompleted) ?? null;

    const resumeLesson = resumeCandidate ?? firstIncomplete;

    return {
      courseId: course.id,
      courseTitle: course.title,
      totalLessons,
      completedLessons,
      courseProgressPercentage,
      isCourseCompleted: totalLessons > 0 && completedLessons === totalLessons,
      sections,
      resume: resumeLesson
        ? {
            lessonId: resumeLesson.lessonId,
            title: resumeLesson.title,
            positionSeconds: resumeLesson.lastPositionSeconds,
          }
        : null,
      lessons: lessonsProgress,
    };
  }

  /**
   * §12.9 — نظرة المدرس على تقدم طلاب كورسه (نفس بيانات التقدم الموجودة، زاوية عرض جديدة)
   * لكل طالب مشترك: نسبة الإكمال، آخر درس فتحه، آخر نشاط، وأحدث درجة اختبار
   */
  async getTeacherCourseStudents(
    courseId: string,
    sort: string | undefined,
    user: { id: string; role: Role },
  ) {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, isDeleted: false },
      select: {
        id: true,
        title: true,
        lessons: { where: { isDeleted: false }, select: { id: true } },
      },
    });
    if (!course) throw new NotFoundException('Course not found.');

    // صلاحيات: المدرس يرى طلاب كورساته هو فقط
    const isOwner = await canManageCourse(this.prisma, user.id, courseId, user.role);
    if (!isOwner) throw new ForbiddenException('You can only view students in your own courses.');

    const totalLessons = course.lessons.length;

    const enrollments = await this.prisma.enrollment.findMany({
      where: { courseId, status: EnrollmentStatus.ACTIVE },
      include: { student: { select: { id: true, fullName: true, photoUrl: true } } },
      orderBy: { enrolledAt: 'asc' },
    });

    const studentIds = enrollments.map((e) => e.student.id);

    const [progresses, quizAttempts] = await Promise.all([
      studentIds.length
        ? this.prisma.progress.findMany({
            where: { studentId: { in: studentIds }, lesson: { courseId, isDeleted: false } },
            orderBy: { lastWatchedAt: 'desc' },
            include: { lesson: { select: { id: true, title: true, orderIndex: true } } },
          })
        : Promise.resolve([]),
      studentIds.length
        ? this.prisma.quizAttempt.findMany({
            where: {
              studentId: { in: studentIds },
              status: QuizAttemptStatus.SUBMITTED,
              quiz: { isDeleted: false, lesson: { courseId, isDeleted: false } },
            },
            orderBy: { submittedAt: 'desc' },
            select: {
              studentId: true,
              score: true,
              totalMarks: true,
              earnedMarks: true,
              submittedAt: true,
              quiz: { select: { title: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    type Row = {
      studentId: string;
      fullName: string;
      photoUrl: string | null;
      enrolledAt: Date;
      completedLessons: number;
      completionPercentage: number;
      lastLessonTitle: string | null;
      lastActivityAt: Date | null;
      latestQuizScore: number | null;
      latestQuizTitle: string | null;
    };

    const rows: Row[] = enrollments.map((e) => {
      const p = progresses.filter((pr) => pr.studentId === e.student.id);
      const completed = p.filter((pr) => pr.isCompleted).length;
      const latest = p[0] ?? null;
      const q = quizAttempts.find((qa) => qa.studentId === e.student.id);
      return {
        studentId: e.student.id,
        fullName: e.student.fullName,
        photoUrl: e.student.photoUrl,
        enrolledAt: e.enrolledAt,
        completedLessons: completed,
        completionPercentage:
          totalLessons > 0 ? Math.round((completed / totalLessons) * 100) : 0,
        lastLessonTitle: latest?.lesson?.title ?? null,
        lastActivityAt: latest?.lastWatchedAt ?? null,
        latestQuizScore:
          q && q.totalMarks && q.totalMarks > 0
            ? Math.round(((q.earnedMarks ?? q.score ?? 0) / q.totalMarks) * 100)
            : null,
        latestQuizTitle: q?.quiz.title ?? null,
      };
    });

    let result = rows;
    if (sort === 'not_started') {
      result = rows.filter((r) => r.completedLessons === 0);
    } else if (sort === 'least_active') {
      result = [...rows].sort(
        (a, b) =>
          (a.lastActivityAt?.getTime() ?? 0) - (b.lastActivityAt?.getTime() ?? 0) ||
          a.completionPercentage - b.completionPercentage,
      );
    } else if (sort === 'most_active') {
      result = [...rows].sort(
        (a, b) =>
          (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0) ||
          b.completionPercentage - a.completionPercentage,
      );
    } else if (sort === 'completion_desc') {
      result = [...rows].sort((a, b) => b.completionPercentage - a.completionPercentage);
    } else if (sort === 'completion_asc') {
      result = [...rows].sort((a, b) => a.completionPercentage - b.completionPercentage);
    }

    return {
      courseId,
      courseTitle: course.title,
      totalStudents: rows.length,
      averageCompletion:
        rows.length > 0
          ? Math.round(rows.reduce((s, r) => s + r.completionPercentage, 0) / rows.length)
          : 0,
      inactiveTwoWeeksCount: rows.filter(
        (r) =>
          !r.lastActivityAt ||
          Date.now() - r.lastActivityAt.getTime() > 14 * 24 * 60 * 60 * 1000,
      ).length,
      students: result,
    };
  }

  /**
   * §12.9 — تفاصيل طالب واحد داخل كورس: كل درس وحالته + درجات الكويزات
   */
  async getTeacherStudentDetail(
    courseId: string,
    studentId: string,
    user: { id: string; role: Role },
  ) {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, isDeleted: false },
      select: {
        id: true,
        title: true,
        sections: {
          orderBy: { order: 'asc' },
          select: { id: true, title: true, order: true },
        },
        lessons: {
          where: { isDeleted: false },
          orderBy: { orderIndex: 'asc' },
          select: {
            id: true,
            title: true,
            sectionId: true,
            orderIndex: true,
            durationSeconds: true,
          },
        },
      },
    });
    if (!course) throw new NotFoundException('Course not found.');

    const isOwner = await canManageCourse(this.prisma, user.id, courseId, user.role);
    if (!isOwner) throw new ForbiddenException('You can only view students in your own courses.');

    // يقبل معرف StudentProfile أو معرف المستخدم (userId) — يفيد عند البحث عن طالب
    const profile = await this.prisma.studentProfile.findFirst({
      where: { OR: [{ id: studentId }, { userId: studentId }] },
      select: { id: true },
    });
    const resolvedStudentId = profile?.id ?? studentId;

    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId: resolvedStudentId,
        courseId,
        status: EnrollmentStatus.ACTIVE,
      },
      include: {
        student: {
          select: {
            id: true,
            fullName: true,
            photoUrl: true,
            gradeLevel: true,
            guardianPhone: true,
            user: { select: { phone: true } },
          },
        },
      },
    });
    if (!enrollment) {
      throw new ForbiddenException('This student is not actively enrolled in the course.');
    }

    const detailGeneratedAt = new Date();
    const courseLessonIds = course.lessons.map((lesson) => lesson.id);
    const [
      progresses,
      quizAttempts,
      examAttempts,
      homeworkAttempts,
      publishedQuizzes,
      publishedHomeworks,
      publishedExams,
    ] = await Promise.all([
      this.prisma.progress.findMany({
        where: { studentId: resolvedStudentId, lesson: { courseId, isDeleted: false } },
      }),
      this.prisma.quizAttempt.findMany({
        where: {
          studentId: resolvedStudentId,
          status: QuizAttemptStatus.SUBMITTED,
          quiz: { isDeleted: false, lesson: { courseId, isDeleted: false } },
        },
        orderBy: [{ quizId: 'asc' }, { attemptNumber: 'asc' }],
        select: {
          quizId: true,
          attemptNumber: true,
          score: true,
          earnedMarks: true,
          totalMarks: true,
          isPassed: true,
          submittedAt: true,
          quiz: { select: { id: true, title: true, lessonId: true } },
        },
      }),
      this.prisma.examAttempt.findMany({
        where: {
          studentId: resolvedStudentId,
          status: ExamAttemptStatus.SUBMITTED,
          score: { not: null },
          exam: { courseId, isDeleted: false },
        },
        orderBy: { submittedAt: 'desc' },
        select: {
          examId: true,
          attemptNumber: true,
          score: true,
          isPassed: true,
          submittedAt: true,
          questionSnapshots: true,
          exam: { select: { id: true, title: true, totalMarks: true } },
        },
      }),
      this.prisma.homeworkAttempt.findMany({
        where: {
          studentId: resolvedStudentId,
          status: QuizAttemptStatus.SUBMITTED,
          homework: { isDeleted: false, lesson: { courseId, isDeleted: false } },
        },
        orderBy: { submittedAt: 'desc' },
        select: {
          homeworkId: true,
          attemptNumber: true,
          score: true,
          earnedMarks: true,
          totalMarks: true,
          isPassed: true,
          submittedAt: true,
          homework: { select: { id: true, title: true, lessonId: true } },
        },
      }),
      this.prisma.quiz.findMany({
        where: { lessonId: { in: courseLessonIds }, isDeleted: false, isPublished: true },
        select: { id: true, title: true, createdAt: true, lesson: { select: { title: true } } },
      }),
      this.prisma.homework.findMany({
        where: {
          lessonId: { in: courseLessonIds },
          isDeleted: false,
          isPublished: true,
          OR: [{ availableFrom: null }, { availableFrom: { lte: detailGeneratedAt } }],
        },
        select: { id: true, title: true, availableFrom: true, lesson: { select: { title: true } } },
      }),
      this.prisma.exam.findMany({
        where: {
          courseId,
          isDeleted: false,
          isPublished: true,
          OR: [{ startAt: null }, { startAt: { lte: detailGeneratedAt } }],
        },
        select: { id: true, title: true, startAt: true, endAt: true, lesson: { select: { title: true } } },
      }),
    ]);

    const progressMap = new Map(progresses.map((p) => [p.lessonId, p]));
    const lessons = course.lessons.map((lesson) => {
      const p = progressMap.get(lesson.id);
      return {
        lessonId: lesson.id,
        title: lesson.title,
        sectionId: lesson.sectionId,
        orderIndex: lesson.orderIndex,
        durationSeconds: p?.videoDurationSeconds ?? lesson.durationSeconds,
        watchedPercentage: p?.watchedPercentage ?? 0,
        isCompleted: p?.isCompleted ?? false,
        lastWatchedAt: p?.lastWatchedAt ?? null,
      };
    });

    const totalLessons = lessons.length;
    const completedLessons = lessons.filter((l) => l.isCompleted).length;
    const assessmentAttempts = [
      ...quizAttempts.map((q) => ({
        assessmentId: q.quizId,
        type: 'QUIZ' as const,
        title: q.quiz.title,
        lessonId: q.quiz.lessonId,
        attemptNumber: q.attemptNumber,
        percentage:
          q.totalMarks && q.totalMarks > 0
            ? Math.round(((q.earnedMarks ?? q.score ?? 0) / q.totalMarks) * 100)
            : q.score,
        isPassed: q.isPassed,
        submittedAt: q.submittedAt,
      })),
      ...examAttempts.map((attempt) => {
        const snapshotTotal = Array.isArray(attempt.questionSnapshots)
          ? attempt.questionSnapshots.reduce<number>((sum, item) => {
              const marks =
                item && typeof item === 'object' && 'marks' in item
                  ? Number((item as { marks?: unknown }).marks)
                  : 0;
              return Number.isFinite(marks) && marks > 0 ? sum + marks : sum;
            }, 0)
          : 0;
        const totalMarks = snapshotTotal > 0 ? snapshotTotal : attempt.exam.totalMarks;
        return {
          assessmentId: attempt.examId,
          type: 'EXAM' as const,
          title: attempt.exam.title,
          lessonId: null,
          attemptNumber: attempt.attemptNumber,
          percentage:
            attempt.score != null && totalMarks > 0
              ? Math.round((attempt.score / totalMarks) * 100)
              : null,
          isPassed: attempt.isPassed,
          submittedAt: attempt.submittedAt,
        };
      }),
      ...homeworkAttempts.map((attempt) => ({
        assessmentId: attempt.homeworkId,
        type: 'HOMEWORK' as const,
        title: attempt.homework.title,
        lessonId: attempt.homework.lessonId,
        attemptNumber: attempt.attemptNumber,
        percentage:
          attempt.totalMarks && attempt.totalMarks > 0
            ? Math.round(((attempt.earnedMarks ?? attempt.score ?? 0) / attempt.totalMarks) * 100)
            : attempt.score,
        isPassed: attempt.isPassed,
        submittedAt: attempt.submittedAt,
      })),
    ].sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0));

    const submittedRequirementKeys = new Set(
      assessmentAttempts.map((assessment) => `${assessment.type}:${assessment.assessmentId}`),
    );
    const pendingRequirements = [
      ...publishedQuizzes
        .filter((quiz) => !submittedRequirementKeys.has(`QUIZ:${quiz.id}`))
        .map((quiz) => ({
          requirementId: quiz.id,
          type: 'QUIZ' as const,
          title: quiz.title,
          lessonTitle: quiz.lesson.title,
          availableFrom: quiz.createdAt,
          dueAt: null,
          isOverdue: false,
          statusLabel: 'اختبار قصير لم يُحل بعد',
        })),
      ...publishedHomeworks
        .filter((homework) => !submittedRequirementKeys.has(`HOMEWORK:${homework.id}`))
        .map((homework) => ({
          requirementId: homework.id,
          type: 'HOMEWORK' as const,
          title: homework.title,
          lessonTitle: homework.lesson.title,
          availableFrom: homework.availableFrom,
          dueAt: null,
          isOverdue: false,
          statusLabel: 'واجب لم يُسلَّم بعد',
        })),
      ...publishedExams
        .filter((exam) => !submittedRequirementKeys.has(`EXAM:${exam.id}`))
        .map((exam) => {
          const isOverdue = Boolean(exam.endAt && exam.endAt.getTime() < detailGeneratedAt.getTime());
          return {
            requirementId: exam.id,
            type: 'EXAM' as const,
            title: exam.title,
            lessonTitle: exam.lesson?.title ?? null,
            availableFrom: exam.startAt,
            dueAt: exam.endAt,
            isOverdue,
            statusLabel: isOverdue ? 'فات موعد الامتحان دون تسليم' : 'امتحان مطلوب ولم يُقدَّم بعد',
          };
        }),
    ].sort(
      (a, b) =>
        Number(b.isOverdue) - Number(a.isOverdue) ||
        (a.dueAt?.getTime() ?? a.availableFrom?.getTime() ?? 0) -
          (b.dueAt?.getTime() ?? b.availableFrom?.getTime() ?? 0),
    );

    return {
      courseId,
      courseTitle: course.title,
      student: enrollment.student,
      enrolledAt: enrollment.enrolledAt,
      totalLessons,
      completedLessons,
      completionPercentage:
        totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
      sections: course.sections,
      lessons,
      quizScores: quizAttempts.map((q) => ({
        quizId: q.quizId,
        quizTitle: q.quiz.title,
        lessonId: q.quiz.lessonId,
        attemptNumber: q.attemptNumber,
        score: q.score,
        percentage:
          q.totalMarks && q.totalMarks > 0
            ? Math.round(((q.earnedMarks ?? q.score ?? 0) / q.totalMarks) * 100)
            : null,
        isPassed: q.isPassed,
        submittedAt: q.submittedAt,
      })),
      assessments: assessmentAttempts,
      pendingRequirements,
    };
  }

  /**
   * TEACHER/ADMIN: إزالة طالب من كورس (إلغاء تسجيله).
   * إذا كانت هناك مدفوعات مرتبطة بالتسجيل يتم إلغاؤه بدلاً من حذفه
   * حفاظاً على السجل المالي.
   */
  async removeStudentFromCourse(
    courseId: string,
    studentId: string,
    user: { id: string; role: Role },
  ) {
    const courseExists = await this.prisma.course.findFirst({
      where: { id: courseId, isDeleted: false },
      select: { id: true, title: true },
    });
    if (!courseExists) throw new NotFoundException('Course not found.');

    const isOwner = await canManageCourse(this.prisma, user.id, courseId, user.role);
    if (!isOwner) {
      throw new ForbiddenException('You can only remove students from your own courses.');
    }

    const enrollment = await this.prisma.enrollment.findFirst({
      where: { courseId, studentId },
      select: { id: true, status: true },
    });
    if (!enrollment) {
      throw new NotFoundException('The student is not enrolled in this course.');
    }

    const paymentsCount = await this.prisma.payment.count({
      where: { enrollmentId: enrollment.id },
    });

    if (paymentsCount > 0) {
      // يوجد سجل مالي مرتبط — نُلغي التسجيل بدل حذفه
      await this.prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { status: EnrollmentStatus.CANCELLED },
      });
    } else {
      await this.prisma.enrollment.delete({ where: { id: enrollment.id } });
    }

    this.logger.log(
      `Student ${studentId} removed from course ${courseId} by ${user.role} [${user.id}]`,
    );
    return { message: 'تمت إزالة الطالب من الكورس بنجاح.' };
  }
}
