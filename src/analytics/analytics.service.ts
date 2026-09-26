import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CourseStatus,
  EnrollmentStatus,
  ExamAttemptStatus,
  PaymentStatus,
  QuizAttemptStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { PdfGeneratorService } from '../shared/pdf/pdf-generator.service';
import {
  buildPerformanceReportHtml,
  PerformanceReportData,
} from '../shared/pdf/templates/performance-report.template';
import { buildGuardianPerformanceReportHtml } from '../shared/pdf/templates/guardian-performance-report.template';
import { canManageCourse } from '../common/utils/course-access.util';

interface AuthUser {
  id: string;
  role: Role;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfGenerator: PdfGeneratorService,
  ) {}

  /** Scores in exam attempts are raw marks, while quiz/homework scores are already percentages. */
  private asPercentage(score: number | null | undefined, totalMarks: number | null | undefined) {
    if (score == null || !totalMarks || totalMarks <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((score / totalMarks) * 100)));
  }

  /**
   * Question-bank exams can use a subset of questions, so their configured
   * total can differ from the total served to a student. Prefer the snapshot
   * stored with the attempt; fall back safely for legacy attempts.
   */
  private attemptTotalMarks(questionSnapshots: unknown, fallbackTotalMarks: number) {
    if (Array.isArray(questionSnapshots)) {
      const snapshotTotal = questionSnapshots.reduce((sum, snapshot) => {
        const marks =
          snapshot && typeof snapshot === 'object' && 'marks' in snapshot
            ? Number((snapshot as { marks?: unknown }).marks)
            : 0;
        return Number.isFinite(marks) && marks > 0 ? sum + marks : sum;
      }, 0);
      if (snapshotTotal > 0) return snapshotTotal;
    }
    return fallbackTotalMarks;
  }

  private average(values: number[]) {
    return values.length > 0
      ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
      : null;
  }

  /** Quiz and homework attempts can be legacy percentage scores or raw-mark scores. */
  private storedAssessmentPercentage(
    score: number | null | undefined,
    earnedMarks: number | null | undefined,
    totalMarks: number | null | undefined,
  ) {
    if (totalMarks && totalMarks > 0) {
      return this.asPercentage(earnedMarks ?? score, totalMarks);
    }
    if (score == null) return 0;
    return Math.min(100, Math.max(0, Math.round(score)));
  }

  private formatArabicGradeLevel(gradeLevel: string | null | undefined): string {
    const labels: Record<string, string> = {
      PREP_1: 'الصف الأول الإعدادي',
      PREP_2: 'الصف الثاني الإعدادي',
      PREP_3: 'الصف الثالث الإعدادي',
      SEC_1: 'الصف الأول الثانوي',
      SEC_2: 'الصف الثاني الثانوي',
      SEC_3_SCIENTIFIC: 'الثانوية العامة - علمي',
      SEC_3_LITERARY: 'الثانوية العامة - أدبي',
      AZHAR_PREP: 'الأزهر الشريف - المرحلة الإعدادية',
      AZHAR_SEC: 'الأزهر الشريف - المرحلة الثانوية',
      BAC: 'البكالوريا الدولية',
    };
    if (!gradeLevel) return 'غير مسجلة';
    return labels[String(gradeLevel).trim().toUpperCase()] ?? String(gradeLevel);
  }

  async getStudentPerformance(userId: string, user: AuthUser) {
    if (user.role !== Role.STUDENT) {
      throw new ForbiddenException('Only students have performance analytics.');
    }

    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!student) throw new ForbiddenException('Student profile not found.');

    // ─── Exams (aggregated in DB where possible) ─────────────────
    const examAttempts = await this.prisma.examAttempt.findMany({
      where: { studentId: student.id, status: ExamAttemptStatus.SUBMITTED, score: { not: null } },
      select: {
        id: true,
        score: true,
        isPassed: true,
        submittedAt: true,
        questionSnapshots: true,
        exam: { select: { id: true, title: true, totalMarks: true, courseId: true } },
      },
    });

    const examScoresPct = examAttempts.map((attempt) =>
      this.asPercentage(
        attempt.score,
        this.attemptTotalMarks(attempt.questionSnapshots, attempt.exam.totalMarks),
      ),
    );

    const avgExamScore = this.average(examScoresPct);

    // ─── Quizzes ─────────────────────────────────────────────────
    const quizAttempts = await this.prisma.quizAttempt.findMany({
      where: { studentId: student.id, status: QuizAttemptStatus.SUBMITTED, score: { not: null } },
      select: {
        id: true,
        score: true,
        isPassed: true,
        submittedAt: true,
        quiz: { select: { id: true, title: true } },
      },
    });

    const quizScores = quizAttempts.map((a) => a.score ?? 0);
    const avgQuizScore = this.average(quizScores);

    // ─── Courses / lessons completion ────────────────────────────
    const [enrolledCount, activeEnrollments] = await Promise.all([
      this.prisma.enrollment.count({
        where: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
      }),
      this.prisma.enrollment.findMany({
        where: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
        select: {
          course: {
            select: {
              _count: { select: { lessons: { where: { isDeleted: false } } } },
            },
          },
        },
      }),
    ]);

    const totalLessonsInEnrolledCourses = activeEnrollments.reduce(
      (sum, e) => sum + e.course._count.lessons,
      0,
    );

    const completedLessons = await this.prisma.progress.count({
      where: {
        studentId: student.id,
        isCompleted: true,
        lesson: {
          isDeleted: false,
          course: {
            enrollments: {
              some: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
            },
          },
        },
      },
    });

    const coursesCompleted = await this.prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*) AS c FROM (
        SELECT e.course_id
        FROM enrollments e
        JOIN courses co ON co.id = e.course_id AND co.is_deleted = false
        LEFT JOIN progresses p ON p.student_id = e.student_id
          AND p.lesson_id IN (SELECT id FROM lessons WHERE course_id = e.course_id AND is_deleted = false)
          AND p.is_completed = false
        WHERE e.student_id = ${student.id}::uuid
          AND e.status = 'ACTIVE'
        GROUP BY e.course_id
        HAVING COUNT(p.id) = 0
          AND EXISTS (
            SELECT 1 FROM lessons l WHERE l.course_id = e.course_id AND l.is_deleted = false
          )
      ) completed_courses
    `;

    // ─── Topic performance (all submitted assessments, grouped by lesson) ─
    // The old analysis used exam answers only, so a student could solve many
    // quizzes correctly yet still see an inaccurate "weak topic" label.
    const [
      examTotals,
      examCorrect,
      quizTotals,
      quizCorrect,
      homeworkTotals,
      homeworkCorrect,
    ] = await Promise.all([
      this.prisma.attemptAnswer.groupBy({
        by: ['questionId'],
        where: { attempt: { studentId: student.id, status: ExamAttemptStatus.SUBMITTED } },
        _count: { _all: true },
      }),
      this.prisma.attemptAnswer.groupBy({
        by: ['questionId'],
        where: { attempt: { studentId: student.id, status: ExamAttemptStatus.SUBMITTED }, isCorrect: true },
        _count: { _all: true },
      }),
      this.prisma.quizAttemptAnswer.groupBy({
        by: ['questionId'],
        where: { attempt: { studentId: student.id, status: QuizAttemptStatus.SUBMITTED } },
        _count: { _all: true },
      }),
      this.prisma.quizAttemptAnswer.groupBy({
        by: ['questionId'],
        where: { attempt: { studentId: student.id, status: QuizAttemptStatus.SUBMITTED }, isCorrect: true },
        _count: { _all: true },
      }),
      this.prisma.homeworkAnswer.groupBy({
        by: ['questionId'],
        where: { attempt: { studentId: student.id, status: QuizAttemptStatus.SUBMITTED } },
        _count: { _all: true },
      }),
      this.prisma.homeworkAnswer.groupBy({
        by: ['questionId'],
        where: { attempt: { studentId: student.id, status: QuizAttemptStatus.SUBMITTED }, isCorrect: true },
        _count: { _all: true },
      }),
    ]);

    const examTotalMap = new Map(examTotals.map((row) => [row.questionId, row._count._all]));
    const examCorrectMap = new Map(examCorrect.map((row) => [row.questionId, row._count._all]));
    const quizTotalMap = new Map(quizTotals.map((row) => [row.questionId, row._count._all]));
    const quizCorrectMap = new Map(quizCorrect.map((row) => [row.questionId, row._count._all]));
    const homeworkTotalMap = new Map(homeworkTotals.map((row) => [row.questionId, row._count._all]));
    const homeworkCorrectMap = new Map(homeworkCorrect.map((row) => [row.questionId, row._count._all]));

    const [examQuestions, quizQuestions, homeworkQuestions] = await Promise.all([
      examTotalMap.size > 0
        ? this.prisma.question.findMany({
            where: { id: { in: [...examTotalMap.keys()] }, isDeleted: false },
            select: { id: true, exam: { select: { lessonId: true, lesson: { select: { title: true } } } } },
          })
        : Promise.resolve([]),
      quizTotalMap.size > 0
        ? this.prisma.quizQuestion.findMany({
            where: { id: { in: [...quizTotalMap.keys()] }, isDeleted: false },
            select: { id: true, quiz: { select: { lessonId: true, lesson: { select: { title: true } } } } },
          })
        : Promise.resolve([]),
      homeworkTotalMap.size > 0
        ? this.prisma.homeworkQuestion.findMany({
            where: { id: { in: [...homeworkTotalMap.keys()] }, isDeleted: false },
            select: { id: true, homework: { select: { lessonId: true, lesson: { select: { title: true } } } } },
          })
        : Promise.resolve([]),
    ]);

    const lessonAgg = new Map<string, { title: string; total: number; correct: number }>();
    const addQuestionToLesson = (
      lessonId: string | null,
      lessonTitle: string | null | undefined,
      questionId: string,
      totalMap: Map<string, number>,
      correctMap: Map<string, number>,
    ) => {
      const total = totalMap.get(questionId) ?? 0;
      if (!lessonId || !lessonTitle || total === 0) return;
      const entry = lessonAgg.get(lessonId) ?? { title: lessonTitle, total: 0, correct: 0 };
      entry.total += total;
      entry.correct += correctMap.get(questionId) ?? 0;
      lessonAgg.set(lessonId, entry);
    };

    examQuestions.forEach((question) =>
      addQuestionToLesson(question.exam.lessonId, question.exam.lesson?.title, question.id, examTotalMap, examCorrectMap),
    );
    quizQuestions.forEach((question) =>
      addQuestionToLesson(question.quiz.lessonId, question.quiz.lesson?.title, question.id, quizTotalMap, quizCorrectMap),
    );
    homeworkQuestions.forEach((question) =>
      addQuestionToLesson(question.homework.lessonId, question.homework.lesson?.title, question.id, homeworkTotalMap, homeworkCorrectMap),
    );

    const topicPerformance = [...lessonAgg.entries()]
      .filter(([, value]) => value.total >= 2)
      .map(([lessonId, value]) => ({
        lessonId,
        lessonTitle: value.title,
        answersCount: value.total,
        accuracy: Math.round((value.correct / value.total) * 100),
      }))
      .sort((a, b) => a.accuracy - b.accuracy);

    // ─── Recent activity ─────────────────────────────────────────
    const recentExamActivity = examAttempts
      .sort(
        (a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0),
      )
      .slice(0, 5)
      .map((a) => ({
        type: 'EXAM' as const,
        title: a.exam.title,
        score: this.asPercentage(
          a.score,
          this.attemptTotalMarks(a.questionSnapshots, a.exam.totalMarks),
        ),
        isPassed: a.isPassed,
        date: a.submittedAt,
      }));

    const recentQuizActivity = quizAttempts
      .sort(
        (a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0),
      )
      .slice(0, 5)
      .map((a) => ({
        type: 'QUIZ' as const,
        title: a.quiz.title,
        score: a.score ?? 0,
        isPassed: a.isPassed,
        date: a.submittedAt,
      }));

    const recentActivity = [
      ...recentExamActivity,
      ...recentQuizActivity,
    ]
      .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
      .slice(0, 10);

    return {
      overview: {
        examsCompleted: examAttempts.length,
        examsPassed: examAttempts.filter((a) => a.isPassed).length,
        avgExamScore,
        bestExamScore: examScoresPct.length > 0 ? Math.max(...examScoresPct) : null,
        worstExamScore: examScoresPct.length > 0 ? Math.min(...examScoresPct) : null,
        quizzesCompleted: quizAttempts.length,
        quizzesPassed: quizAttempts.filter((a) => a.isPassed).length,
        avgQuizScore,
        coursesEnrolled: enrolledCount,
        coursesCompleted: Number(coursesCompleted[0]?.c ?? 0),
        lessonsCompleted: completedLessons,
        totalLessonsInEnrolledCourses,
      },
      weakTopics: topicPerformance.slice(0, 5),
      strongTopics: [...topicPerformance].reverse().slice(0, 5),
      recentActivity,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Course-level analytics across all own courses
  // ─────────────────────────────────────────────────────────────
  async getTeacherAnalytics(userId: string, user: AuthUser, targetTeacherUserId?: string) {
    let teacherId: string | null = null;
    if (user.role === Role.TEACHER) {
      const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId } });
      if (!teacher) throw new ForbiddenException('Teacher profile not found.');
      teacherId = teacher.id;
    } else if (user.role === Role.ADMIN) {
      // ADMIN: scope to a specific teacher when ?teacherId= is provided (their User id),
      // otherwise analytics span all courses platform-wide.
      if (targetTeacherUserId) {
        const teacher = await this.prisma.teacherProfile.findUnique({
          where: { userId: targetTeacherUserId },
        });
        if (!teacher) throw new NotFoundException('Teacher profile not found.');
        teacherId = teacher.id;
      }
    } else {
      throw new ForbiddenException('Teachers only.');
    }

    const courses = await this.prisma.course.findMany({
      where: { isDeleted: false, ...(teacherId && { teacherId }) },
      select: {
        id: true,
        title: true,
        price: true,
        isFree: true,
        _count: { select: { lessons: { where: { isDeleted: false } }, enrollments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const courseIds = courses.map((c) => c.id);
    if (courseIds.length === 0) {
      return { courses: [], totals: this.emptyTotals() };
    }

    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    // Aggregated queries (DB does the heavy lifting)
    const [activeEnrollments, recentActive, progressAgg, examAgg, paymentAgg] =
      await Promise.all([
        this.prisma.enrollment.groupBy({
          by: ['courseId'],
          where: { courseId: { in: courseIds }, status: EnrollmentStatus.ACTIVE },
          _count: { _all: true },
        }),
        this.prisma.progress.findMany({
          where: { lesson: { courseId: { in: courseIds } }, lastWatchedAt: { gte: fourteenDaysAgo } },
          select: { studentId: true, lesson: { select: { courseId: true } }, watchedPercentage: true },
        }),
        this.prisma.$queryRaw<Array<{ courseId: string; completed: bigint; total_progress: bigint; watch_sum: bigint; watch_count: bigint }>>`
          SELECT l.course_id AS "courseId",
                 COUNT(CASE WHEN p.is_completed THEN 1 END) AS completed,
                 COUNT(p.id) AS total_progress,
                 COALESCE(SUM(p.watched_percentage), 0) AS watch_sum,
                 COUNT(CASE WHEN p.watched_percentage IS NOT NULL THEN 1 END) AS watch_count
          FROM progresses p
          JOIN lessons l ON l.id = p.lesson_id AND l.is_deleted = false
          WHERE l.course_id = ANY(${courseIds}::uuid[])
          GROUP BY l.course_id
        `,
        this.prisma.examAttempt.findMany({
          where: {
            exam: { courseId: { in: courseIds } },
            status: ExamAttemptStatus.SUBMITTED,
            score: { not: null },
          },
          select: {
            score: true,
            isPassed: true,
            exam: { select: { courseId: true, totalMarks: true } },
          },
        }),
        this.prisma.payment.groupBy({
          by: ['courseId', 'status'],
          where: { courseId: { in: courseIds } },
          _count: { _all: true },
          _sum: { amount: true },
        }),
      ]);

    const activeMap = new Map(activeEnrollments.map((a) => [a.courseId, a._count._all]));

    // Active students (unique students with activity in last 14 days) per course
    const recentByCourse = new Map<string, Set<string>>();
    const watchPctSums = new Map<string, { sum: number; count: number }>();
    for (const row of recentActive) {
      const cid = row.lesson.courseId;
      if (!recentByCourse.has(cid)) recentByCourse.set(cid, new Set());
      recentByCourse.get(cid)!.add(row.studentId);

      const w = watchPctSums.get(cid) ?? { sum: 0, count: 0 };
      w.sum += row.watchedPercentage;
      w.count += 1;
      watchPctSums.set(cid, w);
    }

    // Progress aggregates from raw SQL
    const progressMap = new Map(
      progressAgg.map((r) => [
        r.courseId,
        {
          completed: Number(r.completed),
          totalProgress: Number(r.total_progress),
          watchSum: Number(r.watch_sum),
          watchCount: Number(r.watch_count),
        },
      ]),
    );

    // Exam score aggregates per course
    const examByCourse = new Map<string, { scores: number[]; passed: number; count: number }>();
    for (const a of examAgg) {
      const cid = a.exam.courseId;
      const entry = examByCourse.get(cid) ?? { scores: [], passed: 0, count: 0 };
      entry.count += 1;
      if (a.isPassed) entry.passed += 1;
      if (a.exam.totalMarks > 0) {
        entry.scores.push(Math.round((a.score! / a.exam.totalMarks) * 100));
      }
      examByCourse.set(cid, entry);
    }

    const revenueByCourse = new Map<string, number>();
    const pendingByCourse = new Map<string, number>();
    for (const row of paymentAgg) {
      if (row.status === PaymentStatus.ACCEPTED) {
        revenueByCourse.set(row.courseId, Number(row._sum.amount ?? 0));
      }
      if (row.status === PaymentStatus.PENDING) {
        pendingByCourse.set(row.courseId, row._count._all);
      }
    }

    const courseStats = courses.map((c) => {
      const enrolled = c._count.enrollments;
      const activeCount = activeMap.get(c.id) ?? 0;
      const prog = progressMap.get(c.id);
      const exam = examByCourse.get(c.id);
      const watch = watchPctSums.get(c.id);

      const completionRate =
        enrolled > 0 && prog && prog.completed > 0
          ? Math.round((prog.completed / enrolled) * 100)
          : 0;

      return {
        courseId: c.id,
        title: c.title,
        totalLessons: c._count.lessons,
        studentCount: enrolled,
        activeStudents: recentByCourse.get(c.id)?.size ?? 0,
        activeEnrollments: activeCount,
        completionRate,
        averageWatchPercentage:
          prog && prog.watchCount > 0 ? Math.round(prog.watchSum / prog.watchCount) : 0,
        averageExamScore:
          exam && exam.scores.length > 0
            ? Math.round(exam.scores.reduce((s, v) => s + v, 0) / exam.scores.length)
            : null,
        examPassRate:
          exam && exam.count > 0 ? Math.round((exam.passed / exam.count) * 100) : null,
        revenue: c.isFree ? 0 : (revenueByCourse.get(c.id) ?? 0),
        pendingPayments: pendingByCourse.get(c.id) ?? 0,
      };
    });

    const totals = {
      totalCourses: courses.length,
      totalStudents: courseStats.reduce((s, c) => s + c.studentCount, 0),
      totalRevenue: courseStats.reduce((s, c) => s + c.revenue, 0),
      pendingPayments: courseStats.reduce((s, c) => s + c.pendingPayments, 0),
    };

    return { courses: courseStats, totals };
  }

  private emptyTotals() {
    return { totalCourses: 0, totalStudents: 0, totalRevenue: 0, pendingPayments: 0 };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT: Downloadable PDF performance report
  // Scoped strictly to the requesting student — never accepts an ID.
  // ─────────────────────────────────────────────────────────────
  async getStudentPerformancePdf(userId: string, user: AuthUser): Promise<Buffer> {
    const performance = await this.getStudentPerformance(userId, user);

    // Student display name (best-effort; falls back to empty)
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { fullName: true },
    });

    // Rendered as HTML through a real browser engine (Puppeteer), which
    // handles Arabic shaping + bidi natively — no manual reshaping hacks.
    const reportData: PerformanceReportData = {
      studentName: profile?.fullName ?? '',
      generatedAt: new Date(),
      overview: performance.overview,
      weakTopics: performance.weakTopics.map((t) => ({
        lessonTitle: t.lessonTitle,
        accuracy: t.accuracy,
        answersCount: t.answersCount,
      })),
      strongTopics: performance.strongTopics.map((t) => ({
        lessonTitle: t.lessonTitle,
        accuracy: t.accuracy,
        answersCount: t.answersCount,
      })),
      recentActivity: performance.recentActivity,
    };

    const fontFaceCss = this.pdfGenerator.getEmbeddedFontFace(
      'Amiri',
      'Amiri-Regular.ttf',
    );
    const html = buildPerformanceReportHtml(reportData, fontFaceCss);
    return this.pdfGenerator.htmlToPdf(html);
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Official, course-scoped report for a selected student
  // ─────────────────────────────────────────────────────────────
  async getTeacherStudentPerformancePdf(
    courseId: string,
    studentId: string,
    user: AuthUser,
    teacherNote?: string,
  ): Promise<Buffer> {
    const canAccess = await canManageCourse(this.prisma, user.id, courseId, user.role);
    if (!canAccess) {
      throw new ForbiddenException('You can only create reports for students in your own courses.');
    }

    // The report page accepts a StudentProfile id, but resolving the user id as
    // well makes the endpoint robust for existing dashboard links.
    const profile = await this.prisma.studentProfile.findFirst({
      where: { OR: [{ id: studentId }, { userId: studentId }] },
      select: { id: true },
    });
    const resolvedStudentId = profile?.id ?? studentId;

    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        courseId,
        studentId: resolvedStudentId,
        status: EnrollmentStatus.ACTIVE,
      },
      select: {
        enrolledAt: true,
        student: { select: { id: true, fullName: true, gradeLevel: true } },
        course: {
          select: {
            id: true,
            title: true,
            lessons: {
              where: { isDeleted: false },
              orderBy: { orderIndex: 'asc' },
              select: { id: true, title: true, orderIndex: true },
            },
          },
        },
      },
    });
    if (!enrollment) {
      throw new NotFoundException('The student is not actively enrolled in this course.');
    }

    const reportGeneratedAt = new Date();
    const lessonIds = enrollment.course.lessons.map((lesson) => lesson.id);
    const [
      progresses,
      quizAttempts,
      examAttempts,
      homeworkAttempts,
      publishedQuizzes,
      publishedHomeworks,
      publishedExams,
    ] = await Promise.all([
      lessonIds.length
        ? this.prisma.progress.findMany({
            where: { studentId: resolvedStudentId, lessonId: { in: lessonIds } },
            select: { lessonId: true, watchedPercentage: true, isCompleted: true, lastWatchedAt: true },
          })
        : Promise.resolve([]),
      lessonIds.length
        ? this.prisma.quizAttempt.findMany({
            where: {
              studentId: resolvedStudentId,
              status: QuizAttemptStatus.SUBMITTED,
              quiz: { isDeleted: false, lessonId: { in: lessonIds } },
            },
            orderBy: { submittedAt: 'desc' },
            select: {
              quizId: true,
              attemptNumber: true,
              score: true,
              earnedMarks: true,
              totalMarks: true,
              isPassed: true,
              submittedAt: true,
              quiz: { select: { title: true } },
            },
          })
        : Promise.resolve([]),
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
          exam: { select: { title: true, totalMarks: true } },
        },
      }),
      lessonIds.length
        ? this.prisma.homeworkAttempt.findMany({
            where: {
              studentId: resolvedStudentId,
              status: QuizAttemptStatus.SUBMITTED,
              homework: { isDeleted: false, lessonId: { in: lessonIds } },
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
              homework: { select: { title: true } },
            },
        })
        : Promise.resolve([]),
      lessonIds.length
        ? this.prisma.quiz.findMany({
            where: { lessonId: { in: lessonIds }, isDeleted: false, isPublished: true },
            select: { id: true, title: true, createdAt: true, lesson: { select: { title: true } } },
          })
        : Promise.resolve([]),
      lessonIds.length
        ? this.prisma.homework.findMany({
            where: {
              lessonId: { in: lessonIds },
              isDeleted: false,
              isPublished: true,
              OR: [{ availableFrom: null }, { availableFrom: { lte: reportGeneratedAt } }],
            },
            select: {
              id: true,
              title: true,
              availableFrom: true,
              lesson: { select: { title: true } },
            },
          })
        : Promise.resolve([]),
      this.prisma.exam.findMany({
        where: {
          courseId,
          isDeleted: false,
          isPublished: true,
          OR: [{ startAt: null }, { startAt: { lte: reportGeneratedAt } }],
        },
        select: { id: true, title: true, startAt: true, endAt: true, lesson: { select: { title: true } } },
      }),
    ]);

    const progressByLesson = new Map(progresses.map((progress) => [progress.lessonId, progress]));
    const reportLessons = enrollment.course.lessons.map((lesson) => {
      const progress = progressByLesson.get(lesson.id);
      return {
        orderIndex: lesson.orderIndex,
        title: lesson.title,
        watchedPercentage: progress?.watchedPercentage ?? 0,
        isCompleted: progress?.isCompleted ?? false,
        lastWatchedAt: progress?.lastWatchedAt ?? null,
      };
    });

    const allAssessments = [
      ...quizAttempts.map((attempt) => ({
        key: `QUIZ:${attempt.quizId}`,
        type: 'QUIZ' as const,
        title: attempt.quiz.title,
        attemptNumber: attempt.attemptNumber,
        percentage: this.storedAssessmentPercentage(
          attempt.score,
          attempt.earnedMarks,
          attempt.totalMarks,
        ),
        isPassed: attempt.isPassed,
        submittedAt: attempt.submittedAt,
      })),
      ...examAttempts.map((attempt) => ({
        key: `EXAM:${attempt.examId}`,
        type: 'EXAM' as const,
        title: attempt.exam.title,
        attemptNumber: attempt.attemptNumber,
        percentage: this.asPercentage(
          attempt.score,
          this.attemptTotalMarks(attempt.questionSnapshots, attempt.exam.totalMarks),
        ),
        isPassed: attempt.isPassed,
        submittedAt: attempt.submittedAt,
      })),
      ...homeworkAttempts.map((attempt) => ({
        key: `HOMEWORK:${attempt.homeworkId}`,
        type: 'HOMEWORK' as const,
        title: attempt.homework.title,
        attemptNumber: attempt.attemptNumber,
        percentage: this.storedAssessmentPercentage(
          attempt.score,
          attempt.earnedMarks,
          attempt.totalMarks,
        ),
        isPassed: attempt.isPassed,
        submittedAt: attempt.submittedAt,
      })),
    ].sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0));

    // A previous failed attempt must not keep generating an alarming
    // recommendation after the student has passed a newer one.
    const latestByAssessment = new Map<string, (typeof allAssessments)[number]>();
    for (const assessment of allAssessments) {
      if (!latestByAssessment.has(assessment.key)) {
        latestByAssessment.set(assessment.key, assessment);
      }
    }
    const latestAssessments = [...latestByAssessment.values()].sort(
      (a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0),
    );

    const submittedRequirementKeys = new Set(allAssessments.map((assessment) => assessment.key));
    const pendingRequirements = [
      ...publishedQuizzes
        .filter((quiz) => !submittedRequirementKeys.has(`QUIZ:${quiz.id}`))
        .map((quiz) => ({
          key: `QUIZ:${quiz.id}`,
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
          key: `HOMEWORK:${homework.id}`,
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
          const isOverdue = Boolean(exam.endAt && exam.endAt.getTime() < reportGeneratedAt.getTime());
          return {
            key: `EXAM:${exam.id}`,
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

    const completedLessons = reportLessons.filter((lesson) => lesson.isCompleted).length;
    const remainingLessons = Math.max(0, reportLessons.length - completedLessons);
    const failedAssessments = latestAssessments.filter(
      (assessment) => assessment.isPassed === false,
    );
    const overdueRequirements = pendingRequirements.filter((requirement) => requirement.isOverdue);
    const recommendations: string[] = [];
    if (reportLessons.length === 0) {
      recommendations.push('لا توجد دروس منشورة في الكورس بعد، لذلك لا يمكن قياس متابعة الدروس حالياً.');
    } else if (remainingLessons > 0) {
      recommendations.push(
        `يُرجى تنظيم وقت لاستكمال ${remainingLessons} درس ${remainingLessons === 1 ? 'متبقٍ' : 'متبقٍ'}؛ يعكس هذا الرقم الدروس غير المكتملة فقط.`,
      );
    }
    if (overdueRequirements.length > 0) {
      const titles = overdueRequirements.slice(0, 3).map((requirement) => `«${requirement.title}»`).join('، ');
      recommendations.push(`فات موعد ${overdueRequirements.length} امتحان غير مكتمل، منها ${titles}. يُرجى التواصل مع معلم المادة لتحديد الخطوة التالية.`);
    } else if (pendingRequirements.length > 0) {
      const titles = pendingRequirements.slice(0, 3).map((requirement) => `«${requirement.title}»`).join('، ');
      recommendations.push(`هناك ${pendingRequirements.length} مهمة أو تقييم مطلوب استكماله، منها ${titles}.`);
    }
    if (failedAssessments.length > 0) {
      const titles = failedAssessments.slice(0, 3).map((assessment) => `«${assessment.title}»`).join('، ');
      recommendations.push(
        `يوصى بمراجعة ${titles} ثم إعادة التدريب؛ لأن آخر نتيجة مسجلة فيها لم تجتز معيار النجاح.`,
      );
    } else if (latestAssessments.length === 0 && pendingRequirements.length === 0) {
      recommendations.push('لا توجد نتائج تقييمات مكتملة بعد؛ يُستحسن إتمام أول تقييم متاح بعد مراجعة الدرس لقياس الفهم بدقة.');
    }
    if (
      remainingLessons === 0 &&
      pendingRequirements.length === 0 &&
      latestAssessments.length > 0 &&
      failedAssessments.length === 0
    ) {
      recommendations.push('المتابعة الحالية مكتملة والنتائج الأخيرة مجتازة. حافظوا على المراجعة المنتظمة قبل أي تقييم جديد.');
    }

    const fontFaceCss = this.pdfGenerator.getEmbeddedFontFace('Amiri', 'Amiri-Regular.ttf');
    const html = buildGuardianPerformanceReportHtml(
      {
        platformName: 'منصة سند التعليمية',
        generatedAt: reportGeneratedAt,
        referenceCode: `${enrollment.student.id.slice(0, 8)}-${enrollment.course.id.slice(0, 6)}`.toUpperCase(),
        student: {
          fullName: enrollment.student.fullName,
          gradeLevel: this.formatArabicGradeLevel(enrollment.student.gradeLevel),
          enrolledAt: enrollment.enrolledAt,
        },
        courseTitle: enrollment.course.title,
        lessons: reportLessons,
        assessmentAttempts: allAssessments,
        latestAssessments,
        pendingRequirements,
        recommendations,
        teacherNote: teacherNote?.trim().slice(0, 2000) || null,
      },
      fontFaceCss,
    );

    return this.pdfGenerator.htmlToPdf(html, {
      margin: { top: '12mm', right: '11mm', bottom: '16mm', left: '11mm' },
      footerHtml:
        '<div style="width:100%;padding:0 11mm;font:9px Tahoma;color:#718096;text-align:center;direction:rtl">تقرير متابعة منصة سند - صفحة <span class="pageNumber"></span> من <span class="totalPages"></span></div>',
    });
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Lesson & exam level analytics for one course
  // ─────────────────────────────────────────────────────────────
  async getTeacherCourseAnalytics(courseId: string, userId: string, user: AuthUser) {
    if (user.role === Role.TEACHER) {
      const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId } });
      const course = await this.prisma.course.findFirst({
        where: { id: courseId, isDeleted: false },
        select: { teacherId: true },
      });
      if (!teacher || !course || course.teacherId !== teacher.id) {
        throw new ForbiddenException('You do not own this course.');
      }
    } else if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Teachers only.');
    }

    // Lesson-level: most/least watched + drop-off points
    const lessonStats = await this.prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        order_index: number;
        watchers: bigint;
        completions: bigint;
        avg_watch: number | null;
        avg_position: number | null;
      }>
    >`
      SELECT l.id, l.title, l.order_index,
             COUNT(p.id) AS watchers,
             COUNT(CASE WHEN p.is_completed THEN 1 END) AS completions,
             AVG(p.watched_percentage) AS avg_watch,
             AVG(NULLIF(p.last_position_seconds, 0)) AS avg_position
      FROM lessons l
      LEFT JOIN progresses p ON p.lesson_id = l.id
      WHERE l.course_id = ${courseId}::uuid AND l.is_deleted = false
      GROUP BY l.id, l.title, l.order_index
      ORDER BY l.order_index ASC
    `;

    const lessons = lessonStats.map((l) => ({
      lessonId: l.id,
      title: l.title,
      orderIndex: l.order_index,
      watchers: Number(l.watchers),
      completions: Number(l.completions),
      completionRate: Number(l.watchers) > 0 ? Math.round((Number(l.completions) / Number(l.watchers)) * 100) : 0,
      averageWatchPercentage: l.avg_watch ? Math.round(Number(l.avg_watch)) : 0,
      dropOffRate:
        Number(l.watchers) > 0
          ? 100 - Math.round((Number(l.completions) / Number(l.watchers)) * 100)
          : 0,
    }));

    const sortedByWatch = [...lessons].sort(
      (a, b) => b.averageWatchPercentage - a.averageWatchPercentage,
    );

    // Exam-level stats
    const exams = await this.prisma.exam.findMany({
      where: { courseId, isDeleted: false },
      select: { id: true, title: true, totalMarks: true, passingMarks: true },
    });
    const attempts = await this.prisma.examAttempt.findMany({
      where: { examId: { in: exams.map((e) => e.id) }, status: ExamAttemptStatus.SUBMITTED, score: { not: null } },
      select: { examId: true, score: true, isPassed: true },
    });

    const examStats = exams.map((e) => {
      const ea = attempts.filter((a) => a.examId === e.id);
      const scores = ea.map((a) =>
        e.totalMarks > 0 ? Math.round((a.score! / e.totalMarks) * 100) : 0,
      );
      const passed = ea.filter((a) => a.isPassed).length;
      return {
        examId: e.id,
        title: e.title,
        attemptCount: ea.length,
        averageScore:
          scores.length > 0
            ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)
            : null,
        passRate: ea.length > 0 ? Math.round((passed / ea.length) * 100) : null,
        failRate: ea.length > 0 ? 100 - Math.round((passed / ea.length) * 100) : null,
      };
    });

    return {
      lessons,
      mostWatchedLesson: sortedByWatch[0] ?? null,
      leastWatchedLesson: sortedByWatch[sortedByWatch.length - 1] ?? null,
      biggestDropOff: [...lessons].sort((a, b) => b.dropOffRate - a.dropOffRate)[0] ?? null,
      exams: examStats,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER: Per-question wrong-answer statistics
  // (which questions students fail the most — exams, quizzes, homeworks)
  // ─────────────────────────────────────────────────────────────
  async getTeacherQuestionStats(
    userId: string,
    user: AuthUser,
    courseId?: string,
    limit = 10,
    targetTeacherUserId?: string,
  ) {
    let teacherId: string | null = null;
    if (user.role === Role.TEACHER) {
      const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId } });
      if (!teacher) throw new ForbiddenException('Teacher profile not found.');
      teacherId = teacher.id;
    } else if (user.role === Role.ADMIN) {
      // ADMIN: optional per-teacher scoping (User id), else all courses platform-wide.
      if (targetTeacherUserId) {
        const teacher = await this.prisma.teacherProfile.findUnique({
          where: { userId: targetTeacherUserId },
        });
        if (!teacher) throw new NotFoundException('Teacher profile not found.');
        teacherId = teacher.id;
      }
    } else {
      throw new ForbiddenException('Teachers only.');
    }

    const courses = await this.prisma.course.findMany({
      where: {
        isDeleted: false,
        ...(courseId && { id: courseId }),
        ...(teacherId && { teacherId }),
      },
      select: { id: true },
    });
    const courseIds = courses.map((c) => c.id);
    if (courseIds.length === 0) return { questions: [] };

    const submittedExam = {
      status: ExamAttemptStatus.SUBMITTED,
      exam: { courseId: { in: courseIds }, isDeleted: false },
    };
    const submittedQuiz = {
      status: QuizAttemptStatus.SUBMITTED,
      quiz: { lesson: { courseId: { in: courseIds } }, isDeleted: false },
    };
    const submittedHomework = {
      status: QuizAttemptStatus.SUBMITTED,
      homework: { lesson: { courseId: { in: courseIds } }, isDeleted: false },
    };

    // Wrong counts + total counts per question, per source type (DB aggregated)
    const [examWrong, examTotal, quizWrong, quizTotal, hwWrong, hwTotal] = await Promise.all([
      this.prisma.attemptAnswer.groupBy({
        by: ['questionId'],
        _count: { _all: true },
        where: { isCorrect: false, attempt: submittedExam },
      }),
      this.prisma.attemptAnswer.groupBy({
        by: ['questionId'],
        _count: { _all: true },
        where: { attempt: submittedExam },
      }),
      this.prisma.quizAttemptAnswer.groupBy({
        by: ['questionId'],
        _count: { _all: true },
        where: { isCorrect: false, attempt: submittedQuiz },
      }),
      this.prisma.quizAttemptAnswer.groupBy({
        by: ['questionId'],
        _count: { _all: true },
        where: { attempt: submittedQuiz },
      }),
      this.prisma.homeworkAnswer.groupBy({
        by: ['questionId'],
        _count: { _all: true },
        where: { isCorrect: false, attempt: submittedHomework },
      }),
      this.prisma.homeworkAnswer.groupBy({
        by: ['questionId'],
        _count: { _all: true },
        where: { attempt: submittedHomework },
      }),
    ]);

    const buildStats = (
      wrongRows: Array<{ questionId: string; _count: { _all: number } }>,
      totalRows: Array<{ questionId: string; _count: { _all: number } }>,
    ) => {
      const totalMap = new Map(totalRows.map((r) => [r.questionId, r._count._all]));
      return wrongRows.map((r) => ({
        questionId: r.questionId,
        wrongCount: r._count._all,
        totalCount: totalMap.get(r.questionId) ?? r._count._all,
      }));
    };

    const examStats = buildStats(examWrong, examTotal);
    const quizStats = buildStats(quizWrong, quizTotal);
    const hwStats = buildStats(hwWrong, hwTotal);
    if (examStats.length + quizStats.length + hwStats.length === 0) {
      return { questions: [] };
    }

    // Fetch question text/parent titles only for questions that were failed at least once
    const [examQuestions, quizQuestions, hwQuestions] = await Promise.all([
      examStats.length
        ? this.prisma.question.findMany({
            where: { id: { in: examStats.map((s) => s.questionId) }, isDeleted: false },
            select: { id: true, text: true, options: true, correctOptionIndex: true, exam: { select: { title: true } } },
          })
        : Promise.resolve([]),
      quizStats.length
        ? this.prisma.quizQuestion.findMany({
            where: { id: { in: quizStats.map((s) => s.questionId) }, isDeleted: false },
            select: { id: true, text: true, options: true, correctOptionIndex: true, quiz: { select: { title: true } } },
          })
        : Promise.resolve([]),
      hwStats.length
        ? this.prisma.homeworkQuestion.findMany({
            where: { id: { in: hwStats.map((s) => s.questionId) }, isDeleted: false },
            select: { id: true, text: true, options: true, correctOptionIndex: true, homework: { select: { title: true } } },
          })
        : Promise.resolve([]),
    ]);

    const toItems = <
      T extends { id: string; text: string; options: unknown; correctOptionIndex: number },
    >(
      questions: T[],
      stats: Array<{ questionId: string; wrongCount: number; totalCount: number }>,
      sourceType: 'EXAM' | 'QUIZ' | 'HOMEWORK',
      getTitle: (q: T) => string,
    ) =>
      stats
        .filter((s) => questions.some((q) => q.id === s.questionId))
        .map((s) => {
          const q = questions.find((x) => x.id === s.questionId)!;
          return {
            questionId: s.questionId,
            sourceType,
            sourceTitle: getTitle(q),
            text: q.text,
            options: q.options,
            correctOptionIndex: q.correctOptionIndex,
            wrongCount: s.wrongCount,
            totalAnswers: s.totalCount,
            wrongRate: s.totalCount > 0 ? Math.round((s.wrongCount / s.totalCount) * 100) : 0,
          };
        });

    const all = [
      ...toItems(examQuestions as any[], examStats, 'EXAM', (q: any) => q.exam?.title ?? ''),
      ...toItems(quizQuestions as any[], quizStats, 'QUIZ', (q: any) => q.quiz?.title ?? ''),
      ...toItems(hwQuestions as any[], hwStats, 'HOMEWORK', (q: any) => q.homework?.title ?? ''),
    ];

    // Hardest first: highest wrong rate, then highest volume of failures
    all.sort((a, b) => b.wrongRate - a.wrongRate || b.wrongCount - a.wrongCount);

    return { questions: all.slice(0, Math.max(1, Math.min(limit, 50))) };
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * Weekly & Monthly Comprehensive Student Performance Report
   * ─────────────────────────────────────────────────────────────
   */
  async getStudentPeriodicReportByUserId(
    userId: string,
    period: 'week' | 'month' | 'all' = 'all',
    courseId?: string,
  ) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Student profile not found.');
    return this.getStudentPeriodicReport(student.id, period, courseId);
  }

  async getStudentPeriodicReport(
    targetStudentId: string,
    period: 'week' | 'month' | 'all' = 'all',
    courseId?: string,
  ) {
    period = period === 'week' || period === 'month' || period === 'all' ? period : 'all';
    const student = await this.prisma.studentProfile.findUnique({
      where: { id: targetStudentId },
      include: {
        user: { select: { email: true, phone: true } },
      },
    });
    if (!student) throw new NotFoundException('Student profile not found.');

    // Treat the labels in the UI literally: "this week" starts on Sunday
    // and "this month" starts on the first calendar day, rather than using
    // rolling 7/30 day windows.
    const now = new Date();
    let startDate: Date | null = null;
    if (period === 'week') {
      startDate = this.getWeekRange(now).weekStart;
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const courseWhere: any = { isDeleted: false };
    if (courseId) courseWhere.id = courseId;

    // Fetch active enrolled courses
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        studentId: student.id,
        status: EnrollmentStatus.ACTIVE,
        course: courseWhere,
      },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            subject: true,
            thumbnailUrl: true,
            lessons: {
              where: { isDeleted: false },
              select: { id: true, title: true, orderIndex: true, durationSeconds: true, createdAt: true },
            },
            exams: {
              where: { isDeleted: false, isPublished: true },
              select: { id: true, title: true, totalMarks: true, passingMarks: true },
            },
          },
        },
      },
    });

    const allCourseIds = enrollments.map((e) => e.courseId);
    const allLessonIds = enrollments.flatMap((e) => e.course.lessons.map((l) => l.id));

    // 1. Progress & Lessons watched (during selected period)
    const progressList = await this.prisma.progress.findMany({
      where: {
        studentId: student.id,
        lesson: { courseId: { in: allCourseIds }, isDeleted: false },
        ...(startDate ? { lastWatchedAt: { gte: startDate } } : {}),
      },
      include: {
        lesson: { select: { id: true, title: true, courseId: true, durationSeconds: true } },
      },
      orderBy: { lastWatchedAt: 'desc' },
    });

    // The period filter must be respected. Previously this used every lesson
    // ever opened by the student, which made a weekly report look complete
    // because of activity from earlier weeks. Completion is intentionally
    // based on the authoritative isCompleted flag, not merely opening a video.
    const completedLessonIds = new Set(
      progressList.filter((progress) => progress.isCompleted).map((progress) => progress.lessonId),
    );

    // 2. Quiz Attempts
    const quizAttempts = await this.prisma.quizAttempt.findMany({
      where: {
        studentId: student.id,
        quiz: { lesson: { courseId: { in: allCourseIds } } },
        status: QuizAttemptStatus.SUBMITTED,
        ...(startDate ? { submittedAt: { gte: startDate } } : {}),
      },
      include: {
        quiz: {
          select: {
            id: true,
            title: true,
            passingPercentage: true,
            lesson: { select: { id: true, title: true, courseId: true, course: { select: { title: true } } } },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    // 3. Exam Attempts
    const examAttempts = await this.prisma.examAttempt.findMany({
      where: {
        studentId: student.id,
        exam: { courseId: { in: allCourseIds } },
        status: ExamAttemptStatus.SUBMITTED,
        ...(startDate ? { submittedAt: { gte: startDate } } : {}),
      },
      select: {
        id: true,
        examId: true,
        score: true,
        isPassed: true,
        attemptNumber: true,
        submittedAt: true,
        questionSnapshots: true,
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
      orderBy: { submittedAt: 'desc' },
    });

    // 4. Homework Attempts and assignments use exactly the same period scope.
    // This prevents a report for one week from subtracting submissions from a
    // lifetime total and showing an impossible completion percentage.
    const [homeworkAttempts, totalAssignedHomeworks] = await Promise.all([
      this.prisma.homeworkAttempt.findMany({
        where: {
          studentId: student.id,
          homework: { lesson: { courseId: { in: allCourseIds } } },
          OR: [
            { status: QuizAttemptStatus.SUBMITTED },
            { submittedAt: { not: null } },
          ],
          ...(startDate ? { submittedAt: { gte: startDate } } : {}),
        },
        include: {
          homework: {
            select: {
              id: true,
              title: true,
              lesson: { select: { id: true, title: true, course: { select: { title: true } } } },
            },
          },
        },
        orderBy: { submittedAt: 'desc' },
      }),
      allLessonIds.length > 0
        ? this.prisma.homework.count({
            where: {
              lessonId: { in: allLessonIds },
              isDeleted: false,
              isPublished: true,
              createdAt: { lte: now, ...(startDate ? { gte: startDate } : {}) },
            },
          })
        : 0,
    ]);

    // A homework can be retried; a completion count is about unique assigned work.
    const submittedHomeworkIds = new Set(homeworkAttempts.map((h) => h.homeworkId));

    // Aggregate statistics
    let totalAssignedLessons = 0;
    for (const e of enrollments) {
      totalAssignedLessons += e.course.lessons.length;
    }

    const attendedLessonsCount = completedLessonIds.size;
    const attendanceRate =
      totalAssignedLessons > 0
        ? Math.min(100, Math.round((attendedLessonsCount / totalAssignedLessons) * 100))
        : 0;

    // Quiz scores are stored as percentages. Exam scores are raw marks and
    // must be normalized per attempt before any average or ranking is shown.
    const quizScores = quizAttempts
      .map((quiz) => quiz.score)
      .filter((score): score is number => score !== null)
      .map((score) => Math.min(100, Math.max(0, score)));
    const quizAverage = this.average(quizScores);
    const passedQuizzesCount = quizAttempts.filter((q) => q.isPassed).length;

    const examScores = examAttempts
      .filter((exam) => exam.score !== null)
      .map((exam) =>
        this.asPercentage(
          exam.score,
          this.attemptTotalMarks(exam.questionSnapshots, exam.exam.totalMarks),
        ),
      );
    const examAverage = this.average(examScores);
    const passedExamsCount = examAttempts.filter((e) => e.isPassed).length;

    // Highest & Lowest Quiz Scores
    const validQuizzes = quizAttempts.filter((q) => q.score !== null);
    const sortedQuizzes = [...validQuizzes].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const highestQuiz = sortedQuizzes.length > 0
      ? { title: sortedQuizzes[0].quiz.title, score: sortedQuizzes[0].score! }
      : null;
    const lowestQuiz = sortedQuizzes.length > 0
      ? { title: sortedQuizzes[sortedQuizzes.length - 1].quiz.title, score: sortedQuizzes[sortedQuizzes.length - 1].score! }
      : null;

    // Highest & Lowest Exam Scores
    const validExams = examAttempts
      .filter((exam) => exam.score !== null)
      .map((exam) => ({
        ...exam,
        percentage: this.asPercentage(
          exam.score,
          this.attemptTotalMarks(exam.questionSnapshots, exam.exam.totalMarks),
        ),
      }));
    const sortedExams = [...validExams].sort((a, b) => b.percentage - a.percentage);
    const highestExam = sortedExams.length > 0
      ? { title: sortedExams[0].exam.title, score: sortedExams[0].percentage }
      : null;
    const lowestExam = sortedExams.length > 0
      ? { title: sortedExams[sortedExams.length - 1].exam.title, score: sortedExams[sortedExams.length - 1].percentage }
      : null;

    const submittedHomeworksCount = submittedHomeworkIds.size;
    const homeworkCompletionRate =
      totalAssignedHomeworks > 0
        ? Math.min(100, Math.round((submittedHomeworksCount / totalAssignedHomeworks) * 100))
        : 0;
    const homeworkAverage = this.average(
      homeworkAttempts
        .map((homework) => homework.score)
        .filter((score): score is number => score !== null)
        .map((score) => Math.min(100, Math.max(0, score))),
    );

    // Weighted Overall Score: never invent a score for a missing assessment.
    // We normalize only the components that have genuine evidence in this
    // report, and expose that coverage to the student in the UI.
    const scoredComponents: Array<{ id: string; label: string; value: number; weight: number }> = [];
    if (!startDate || progressList.length > 0) {
      scoredComponents.push({ id: 'lessons', label: 'إكمال الدروس', value: attendanceRate, weight: 30 });
    }
    if (examAverage !== null) {
      scoredComponents.push({ id: 'exams', label: 'الامتحانات', value: examAverage, weight: 30 });
    }
    if (quizAverage !== null) {
      scoredComponents.push({ id: 'quizzes', label: 'الكويزات', value: quizAverage, weight: 20 });
    }
    if (totalAssignedHomeworks > 0) {
      scoredComponents.push({
        id: 'homeworks',
        label: 'الواجبات',
        value: homeworkAverage ?? homeworkCompletionRate,
        weight: 20,
      });
    }

    const scoreWeight = scoredComponents.reduce((sum, component) => sum + component.weight, 0);
    const overallScore =
      scoreWeight > 0
        ? Math.round(
            scoredComponents.reduce(
              (sum, component) => sum + component.value * component.weight,
              0,
            ) / scoreWeight,
          )
        : null;

    const insights: string[] = [];
    if (overallScore === null) {
      insights.push('لا توجد أنشطة مكتملة كافية في هذه الفترة لتقييم المستوى؛ ابدأ بدرس أو كويز ليظهر تحليل دقيق.');
    } else {
      if (totalAssignedLessons > 0 && attendanceRate < 70) {
        insights.push(`أكمل ${Math.max(1, totalAssignedLessons - attendedLessonsCount)} درس${totalAssignedLessons - attendedLessonsCount > 1 ? 'اً' : ''} متبقياً لرفع إنجاز الدروس.`);
      }
      if (examAverage !== null && examAverage < 70) {
        insights.push('راجع أخطاء آخر امتحان على شكل جلسة قصيرة، ثم أعد حل الأسئلة التي أخطأت فيها قبل المحاولة التالية.');
      }
      if (quizAverage !== null && quizAverage < 70) {
        insights.push('نتيجة الكويز تشير إلى أن المراجعة بعد الدرس مباشرة ستفيدك؛ ركّز على الدرس صاحب أقل نتيجة أولاً.');
      }
      if (totalAssignedHomeworks > 0 && homeworkCompletionRate < 100) {
        insights.push(`بقي ${Math.max(1, totalAssignedHomeworks - submittedHomeworksCount)} واجب${totalAssignedHomeworks - submittedHomeworksCount > 1 ? 'ات' : ''} غير مُسلَّم؛ ابدأ بالأقرب لإنهائه.`);
      }
      if (insights.length === 0) {
        insights.push('أداؤك متوازن في المقاييس المسجلة. حافظ على المراجعة المنتظمة، وركّز على تحسين أعلى درجة ممكنة في المحاولة القادمة.');
      }
    }

    return {
      student: {
        id: student.id,
        fullName: student.fullName,
        gradeLevel: student.gradeLevel,
        photoUrl: student.photoUrl,
        email: student.user.email,
        phone: student.user.phone,
      },
      period,
      summary: {
        overallScore,
        attendanceRate,
        attendedLessonsCount,
        unattendedLessonsCount: Math.max(0, totalAssignedLessons - attendedLessonsCount),
        totalAssignedLessons,
        quizzesTakenCount: quizAttempts.length,
        passedQuizzesCount,
        quizAverage,
        highestQuiz,
        lowestQuiz,
        examsTakenCount: examAttempts.length,
        passedExamsCount,
        examAverage,
        highestExam,
        lowestExam,
        submittedHomeworksCount,
        unsubmittedHomeworksCount: Math.max(0, totalAssignedHomeworks - submittedHomeworksCount),
        totalAssignedHomeworks,
        homeworkCompletionRate,
        homeworkAverage,
        evaluatedComponents: scoredComponents.map((component) => component.label),
        scoreCoverage: scoreWeight,
        insights,
      },
      lessons: progressList.map((p) => ({
        lessonId: p.lessonId,
        lessonTitle: p.lesson.title,
        watchedPercentage: p.watchedPercentage,
        isCompleted: p.isCompleted,
        lastWatchedAt: p.lastWatchedAt,
        durationSeconds: p.lesson.durationSeconds,
      })),
      quizzes: quizAttempts.map((q) => ({
        quizId: q.quizId,
        quizTitle: q.quiz.title,
        lessonTitle: q.quiz.lesson.title,
        courseTitle: q.quiz.lesson.course.title,
        score: q.score,
        isPassed: q.isPassed,
        attemptNumber: q.attemptNumber,
        submittedAt: q.submittedAt,
      })),
      exams: examAttempts.map((e) => ({
        examId: e.examId,
        examTitle: e.exam.title,
        courseTitle: e.exam.course.title,
        score: this.asPercentage(
          e.score,
          this.attemptTotalMarks(e.questionSnapshots, e.exam.totalMarks),
        ),
        isPassed: e.isPassed,
        attemptNumber: e.attemptNumber,
        submittedAt: e.submittedAt,
      })),
      homeworks: homeworkAttempts.map((h) => ({
        homeworkId: h.homeworkId,
        homeworkTitle: h.homework.title,
        lessonTitle: h.homework.lesson.title,
        courseTitle: h.homework.lesson.course.title,
        score: h.score,
        isPassed: h.isPassed,
        submittedAt: h.submittedAt,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Weekly Snapshot (refresh every week) — stored in WeeklyStudentReport
  // ─────────────────────────────────────────────────────────────

  /** Week range aligned to Sunday (matches EVERY_WEEK cron). */
  private getWeekRange(now: Date = new Date()): { weekStart: Date; weekEnd: Date } {
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    const day = weekStart.getDay(); // 0 = Sunday
    weekStart.setDate(weekStart.getDate() - day);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    return { weekStart, weekEnd };
  }

  /** Enrolled (active) courses for a student — used to populate the report course filter. */
  async getStudentReportCourses(studentId: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        studentId,
        status: 'ACTIVE',
        course: { isDeleted: false, status: 'PUBLISHED' as any },
      },
      select: { course: { select: { id: true, title: true, subject: true } } },
    });
    return enrollments.map((e) => e.course);
  }

  /** Available snapshot week-start dates for a student/course (for the week filter). */
  async getWeeklyReportWeeks(studentId: string, courseId?: string) {
    const rows = await this.prisma.weeklyStudentReport.findMany({
      where: { studentId, courseId: courseId ?? null },
      select: { weekStartDate: true },
      orderBy: { weekStartDate: 'desc' },
      take: 12,
    });
    return rows.map((r) => r.weekStartDate);
  }

  /**
   * Returns the weekly report for a student/course.
   * If a historical closed week was requested, uses the stored snapshot.
   * For the current active week or when no week is specified, computes live
   * so the student's attended lectures and submitted homeworks are 100% accurate.
   */
  async getWeeklyReportForStudent(
    studentId: string,
    courseId?: string,
    weekStartStr?: string,
  ) {
    const { weekStart, weekEnd } = this.getWeekRange();
    const whereWeek = weekStartStr ? new Date(weekStartStr) : null;

    // Only serve frozen historical snapshot if the requested week is strictly in the past
    if (whereWeek && whereWeek.getTime() < weekStart.getTime()) {
      const snapshot = await this.prisma.weeklyStudentReport.findFirst({
        where: {
          studentId,
          courseId: courseId ?? null,
          weekStartDate: whereWeek,
        },
        orderBy: { weekStartDate: 'desc' },
      });

      if (snapshot) {
        return {
          isLive: false,
          weekStartDate: snapshot.weekStartDate,
          weekEndDate: snapshot.weekEndDate,
          generatedAt: snapshot.generatedAt,
          report: snapshot.data as any,
        };
      }
    }

    // Current week: always compute live so student's latest activity is immediately reflected
    const report = await this.getStudentPeriodicReport(studentId, 'week', courseId);
    return {
      isLive: true,
      weekStartDate: weekStart,
      weekEndDate: weekEnd,
      generatedAt: new Date(),
      report,
    };
  }

  /** Persists (upsert) a weekly snapshot — used by the weekly cron job. */
  async upsertWeeklySnapshot(
    studentId: string,
    courseId: string | null,
    weekStart: Date,
    weekEnd: Date,
    data: any,
  ) {
    await this.prisma.weeklyStudentReport.upsert({
      where: {
        studentId_courseId_weekStartDate: {
          studentId,
          courseId,
          weekStartDate: weekStart,
        },
      },
      create: {
        studentId,
        courseId,
        weekStartDate: weekStart,
        weekEndDate: weekEnd,
        data,
      },
      update: {
        weekEndDate: weekEnd,
        data,
        generatedAt: new Date(),
      },
    });
  }

  /**
   * Generates weekly snapshots for every active enrollment (per-course + overall per student).
   * Invoked by the scheduled cron job (EVERY_WEEK).
   */
  async generateWeeklySnapshots() {
    const { weekStart, weekEnd } = this.getWeekRange();

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        status: 'ACTIVE',
        course: { isDeleted: false, status: 'PUBLISHED' as any },
      },
      select: { studentId: true, courseId: true },
      distinct: ['studentId', 'courseId'],
    });

    const studentIds = Array.from(new Set(enrollments.map((e) => e.studentId)));

    // Overall snapshot (one per student, courseId = null)
    for (const studentId of studentIds) {
      try {
        const overall = await this.getStudentPeriodicReport(studentId, 'week', undefined);
        await this.upsertWeeklySnapshot(studentId, null, weekStart, weekEnd, overall);
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error(`Weekly overall snapshot failed for ${studentId}: ${err?.message}`);
      }
    }

    // Per-course snapshot
    for (const en of enrollments) {
      try {
        const perCourse = await this.getStudentPeriodicReport(en.studentId, 'week', en.courseId);
        await this.upsertWeeklySnapshot(en.studentId, en.courseId, weekStart, weekEnd, perCourse);
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error(
          `Weekly per-course snapshot failed for ${en.studentId}/${en.courseId}: ${err?.message}`,
        );
      }
    }
  }

  /** Student-facing wrapper: resolves student by userId and bundles report + weeks + courses. */
  async getStudentWeeklyReportByUser(
    userId: string,
    courseId?: string,
    weekStartStr?: string,
  ) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Student profile not found.');

    const [weekly, weeks, courses] = await Promise.all([
      this.getWeeklyReportForStudent(student.id, courseId, weekStartStr),
      this.getWeeklyReportWeeks(student.id, courseId),
      this.getStudentReportCourses(student.id),
    ]);

    return {
      report: weekly.report,
      week: {
        weekStartDate: weekly.weekStartDate,
        weekEndDate: weekly.weekEndDate,
        generatedAt: weekly.generatedAt,
        isLive: weekly.isLive,
      },
      weeks,
      courses,
    };
  }
}
