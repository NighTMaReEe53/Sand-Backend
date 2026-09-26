import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';

export type ParentResultType = 'ALL' | 'EXAM' | 'QUIZ' | 'HOMEWORK';
export type ParentResultStatus = 'ALL' | 'PASSED' | 'FAILED';

interface ResultsFilter {
  courseId?: string;
  type?: ParentResultType;
  status?: ParentResultStatus;
}

@Injectable()
export class ParentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * أبناء ولي الأمر = كل طالب سجل رقم هاتف ولي الأمر في ملفه (guardianPhone)
   */
  async getMyChildren(parentUser: { id: string; phone: string }) {
    const children = await this.prisma.studentProfile.findMany({
      where: { guardianPhone: parentUser.phone },
      select: {
        id: true,
        fullName: true,
        photoUrl: true,
        gradeLevel: true,
        lastSeenAt: true,
        user: { select: { isActive: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return { parent: { id: parentUser.id, phone: parentUser.phone }, children };
  }

  /**
   * حماية صارمة: ولي الأمر يرى فقط الطلاب الذين سجلوا رقمه هو تحديداً
   */
  private async assertGuardianAccess(
    parentPhone: string,
    studentId: string,
  ) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { id: studentId },
    });
    if (!student || student.guardianPhone !== parentPhone) {
      throw new ForbiddenException('غير مصرح لك بالوصول إلى بيانات هذا الطالب.');
    }
    return student;
  }

  /**
   * ملف الطالب: البيانات الأساسية + إحصائيات عامة + قائمة الكورسات (للفلترة)
   */
  async getStudentProfile(parentPhone: string, studentId: string) {
    const student = await this.assertGuardianAccess(parentPhone, studentId);

    const [enrollments, examAttempts, quizAttempts, homeworkAttempts] =
      await Promise.all([
        this.prisma.enrollment.findMany({
          where: { studentId: student.id, status: 'ACTIVE' },
          select: {
            course: {
              select: { id: true, title: true, subject: true, thumbnailUrl: true },
            },
          },
        }),
        this.prisma.examAttempt.findMany({
          where: { studentId: student.id, status: { not: 'IN_PROGRESS' } },
          select: { score: true, isPassed: true, exam: { select: { totalMarks: true } } },
        }),
        this.prisma.quizAttempt.findMany({
          where: { studentId: student.id, status: { not: 'IN_PROGRESS' } },
          select: { earnedMarks: true, totalMarks: true, isPassed: true },
        }),
        this.prisma.homeworkAttempt.findMany({
          where: { studentId: student.id, status: { not: 'IN_PROGRESS' } },
          select: { earnedMarks: true, totalMarks: true, isPassed: true },
        }),
      ]);

    const courseIds = enrollments.map((e) => e.course.id);
    const [totalLessons, completedLessons] = await Promise.all([
      this.prisma.lesson.count({ where: { courseId: { in: courseIds }, isDeleted: false } }),
      this.prisma.progress.count({
        where: { studentId: student.id, isCompleted: true, lesson: { courseId: { in: courseIds }, isDeleted: false } },
      }),
    ]);

    const pct = (earned: number, total: number) =>
      total > 0 ? Math.round((earned / total) * 100) : 0;

    const examPcts = examAttempts.map((a) => pct(a.score ?? 0, a.exam.totalMarks));
    const quizPcts = quizAttempts.map((a) => pct(a.earnedMarks ?? 0, a.totalMarks ?? 0));
    const hwPcts = homeworkAttempts.map((a) => pct(a.earnedMarks ?? 0, a.totalMarks ?? 0));

    const avg = (arr: number[]) =>
      arr.length > 0 ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;

    return {
      profile: {
        id: student.id,
        fullName: student.fullName,
        photoUrl: student.photoUrl,
        gradeLevel: student.gradeLevel,
        lastSeenAt: student.lastSeenAt,
      },
      stats: {
        coursesCount: enrollments.length,
        lessonsTotal: totalLessons,
        lessonsCompleted: completedLessons,
        examsCount: examAttempts.length,
        examsPassed: examAttempts.filter((a) => a.isPassed).length,
        examsAvgPercent: avg(examPcts),
        quizzesCount: quizAttempts.length,
        quizzesPassed: quizAttempts.filter((a) => a.isPassed).length,
        quizzesAvgPercent: avg(quizPcts),
        homeworkCount: homeworkAttempts.length,
        homeworkPassed: homeworkAttempts.filter((a) => a.isPassed).length,
        homeworkAvgPercent: avg(hwPcts),
      },
      courses: enrollments.map((e) => e.course),
    };
  }

  /**
   * نتائج الطالب: امتحانات + كويزات + واجبات مع الدرجات وأرقام المحاولات
   * (attemptId يُستخدم لتحميل ورقة النتيجة PDF)
   */
  async getStudentResults(parentPhone: string, studentId: string, filter: ResultsFilter) {
    await this.assertGuardianAccess(parentPhone, studentId);

    const type = filter.type ?? 'ALL';
    const status = filter.status ?? 'ALL';
    const courseId = filter.courseId;

    const wantExams = type === 'ALL' || type === 'EXAM';
    const wantQuizzes = type === 'ALL' || type === 'QUIZ';
    const wantHomework = type === 'ALL' || type === 'HOMEWORK';

    const matchStatus = (isPassed: boolean | null): boolean => {
      if (status === 'PASSED') return isPassed === true;
      if (status === 'FAILED') return isPassed === false;
      return true;
    };

    const [examAttempts, quizAttempts, homeworkAttempts] = await Promise.all([
      wantExams
        ? this.prisma.examAttempt.findMany({
            where: {
              studentId,
              status: { not: 'IN_PROGRESS' },
              ...(courseId ? { exam: { courseId } } : {}),
            },
            select: {
              id: true,
              attemptNumber: true,
              score: true,
              isPassed: true,
              status: true,
              submittedAt: true,
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
          })
        : Promise.resolve([]),
      wantQuizzes
        ? this.prisma.quizAttempt.findMany({
            where: {
              studentId,
              status: { not: 'IN_PROGRESS' },
              ...(courseId ? { quiz: { lesson: { courseId } } } : {}),
            },
            select: {
              id: true,
              attemptNumber: true,
              earnedMarks: true,
              totalMarks: true,
              isPassed: true,
              status: true,
              submittedAt: true,
              quiz: {
                select: {
                  id: true,
                  title: true,
                  lesson: {
                    select: {
                      title: true,
                      course: { select: { id: true, title: true } },
                    },
                  },
                },
              },
            },
            orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
            take: 200,
          })
        : Promise.resolve([]),
      wantHomework
        ? this.prisma.homeworkAttempt.findMany({
            where: {
              studentId,
              status: { not: 'IN_PROGRESS' },
              ...(courseId ? { homework: { lesson: { courseId } } } : {}),
            },
            select: {
              id: true,
              attemptNumber: true,
              earnedMarks: true,
              totalMarks: true,
              isPassed: true,
              status: true,
              submittedAt: true,
              homework: {
                select: {
                  id: true,
                  title: true,
                  pdfUrl: true,
                  lesson: {
                    select: {
                      title: true,
                      course: { select: { id: true, title: true } },
                    },
                  },
                },
              },
            },
            orderBy: [{ submittedAt: 'desc' }, { startedAt: 'desc' }],
            take: 200,
          })
        : Promise.resolve([]),
    ]);

    return {
      examAttempts: examAttempts
        .filter((a) => matchStatus(a.isPassed))
        .map((a) => ({
          attemptId: a.id,
          attemptNumber: a.attemptNumber,
          kind: 'EXAM' as const,
          title: a.exam.title,
          courseTitle: a.exam.course.title,
          courseId: a.exam.course.id,
          score: a.score ?? 0,
          totalMarks: a.exam.totalMarks,
          passingMarks: a.exam.passingMarks,
          percent:
            a.exam.totalMarks > 0
              ? Math.round(((a.score ?? 0) / a.exam.totalMarks) * 100)
              : 0,
          isPassed: a.isPassed,
          submittedAt: a.submittedAt,
          paperPdfUrl: `/exam-attempts/${a.id}/result/pdf`,
        })),
      quizAttempts: quizAttempts
        .filter((a) => matchStatus(a.isPassed))
        .map((a) => ({
          attemptId: a.id,
          attemptNumber: a.attemptNumber,
          kind: 'QUIZ' as const,
          title: a.quiz.title,
          lessonTitle: a.quiz.lesson.title,
          courseTitle: a.quiz.lesson.course.title,
          courseId: a.quiz.lesson.course.id,
          score: a.earnedMarks ?? 0,
          totalMarks: a.totalMarks ?? 0,
          percent:
            (a.totalMarks ?? 0) > 0
              ? Math.round(((a.earnedMarks ?? 0) / (a.totalMarks ?? 0)) * 100)
              : 0,
          isPassed: a.isPassed,
          submittedAt: a.submittedAt,
          paperPdfUrl: `/quiz-attempts/${a.id}/result/pdf`,
        })),
      homeworkAttempts: homeworkAttempts
        .filter((a) => matchStatus(a.isPassed))
        .map((a) => ({
          attemptId: a.id,
          attemptNumber: a.attemptNumber,
          kind: 'HOMEWORK' as const,
          title: a.homework.title,
          lessonTitle: a.homework.lesson.title,
          courseTitle: a.homework.lesson.course.title,
          courseId: a.homework.lesson.course.id,
          score: a.earnedMarks ?? 0,
          totalMarks: a.totalMarks ?? 0,
          percent:
            (a.totalMarks ?? 0) > 0
              ? Math.round(((a.earnedMarks ?? 0) / (a.totalMarks ?? 0)) * 100)
              : 0,
          isPassed: a.isPassed,
          submittedAt: a.submittedAt,
          sheetPdfUrl: a.homework.pdfUrl ? `/homework/${a.homework.id}/pdf` : null,
          paperPdfUrl: `/quiz-attempts/${a.id}/result/pdf`,
        })),
    };
  }

  /**
   * دروس الطالب: كل الكورسات المشترك فيها مع حالة كل درس (شاهده / لم يشاهده)
   */
  async getStudentLessons(parentPhone: string, studentId: string, courseId?: string) {
    await this.assertGuardianAccess(parentPhone, studentId);

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        studentId,
        status: 'ACTIVE',
        ...(courseId ? { courseId } : {}),
      },
      select: {
        course: {
          select: {
            id: true,
            title: true,
            subject: true,
            thumbnailUrl: true,
            lessons: {
              where: { isDeleted: false },
              select: {
                id: true,
                title: true,
                description: true,
                orderIndex: true,
                durationSeconds: true,
                dueDate: true,
              },
              orderBy: { orderIndex: 'asc' },
            },
          },
        },
      },
    });

    if (enrollments.length === 0) {
      return { courses: [] };
    }

    const progressRecords = await this.prisma.progress.findMany({
      where: { studentId },
      select: {
        lessonId: true,
        watchedPercentage: true,
        isCompleted: true,
        lastWatchedAt: true,
      },
    });
    const progressMap = new Map(progressRecords.map((p) => [p.lessonId, p]));

    return {
      courses: enrollments.map(({ course }) => {
        const lessons = course.lessons.map((l) => {
          const p = progressMap.get(l.id);
          return {
            ...l,
            isTaken: Boolean(p?.isCompleted),
            watchedPercentage: p?.watchedPercentage ?? 0,
            lastWatchedAt: p?.lastWatchedAt ?? null,
          };
        });
        return {
          id: course.id,
          title: course.title,
          subject: course.subject,
          thumbnailUrl: course.thumbnailUrl,
          lessonsTotal: lessons.length,
          lessonsTaken: lessons.filter((l) => l.isTaken).length,
          lessons,
        };
      }),
    };
  }

  /**
   * تقرير الأداء الأسبوعي للابن/البنت (لقطة تُحدَّث أسبوعياً).
   * يرجع التقرير + أسابيع اللقطات المتاحة + الكورسات للفلترة.
   */
  async getStudentWeeklyReport(
    parentPhone: string,
    studentId: string,
    courseId?: string,
    weekStart?: string,
  ) {
    await this.assertGuardianAccess(parentPhone, studentId);

    const [weekly, weeks, courses] = await Promise.all([
      this.analytics.getWeeklyReportForStudent(studentId, courseId, weekStart),
      this.analytics.getWeeklyReportWeeks(studentId, courseId),
      this.analytics.getStudentReportCourses(studentId),
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
