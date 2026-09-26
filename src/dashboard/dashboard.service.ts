import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseStatus,
  EnrollmentStatus,
  ExamAttemptStatus,
  PaymentStatus,
  QuestionStatus,
  QuizAttemptStatus,
  Role,
  SummaryStatus,
} from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * A small, role-aware action center. Every count here is derived from a
   * record that requires a human decision; it intentionally does not invent
   * a "task" from broad dashboard statistics.
   */
  async getActionCenter(userId: string, role: Role) {
    if (role === Role.TEACHER) {
      const teacher = await this.prisma.teacherProfile.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (!teacher) {
        throw new ForbiddenException('Teacher profile not found.');
      }

      const [essayAnswers, openQuestions, pendingPayments, draftCourses, pendingSummaries] =
        await Promise.all([
          this.prisma.homeworkAnswer.count({
            where: {
              teacherGrade: null,
              attempt: { status: QuizAttemptStatus.SUBMITTED },
              question: {
                requiresImageAnswer: true,
                homework: {
                  isDeleted: false,
                  lesson: {
                    isDeleted: false,
                    course: { teacherId: teacher.id, isDeleted: false },
                  },
                },
              },
            },
          }),
          this.prisma.courseQuestion.count({
            where: {
              status: QuestionStatus.OPEN,
              course: { teacherId: teacher.id, isDeleted: false },
            },
          }),
          this.prisma.payment.count({
            where: {
              status: PaymentStatus.PENDING,
              course: { teacherId: teacher.id, isDeleted: false },
            },
          }),
          this.prisma.course.count({
            where: { teacherId: teacher.id, status: CourseStatus.DRAFT, isDeleted: false },
          }),
          this.prisma.summary.count({
            where: {
              status: SummaryStatus.PENDING,
              course: { teacherId: teacher.id, isDeleted: false },
            },
          }),
        ]);

      return this.buildActionCenter('TEACHER', [
        {
          id: 'homework-grading',
          title: 'إجابات واجبات تحتاج تصحيحًا',
          description: 'إجابات صور أو مقالية أرسلها الطلاب وتنتظر رصد الدرجة.',
          count: essayAnswers,
          priority: 'high' as const,
          href: '/dashboard/homeworks',
          icon: 'clipboard',
        },
        {
          id: 'student-questions',
          title: 'أسئلة طلاب بلا رد',
          description: 'أسئلة مفتوحة في كورساتك تحتاج متابعة أو إجابة.',
          count: openQuestions,
          priority: 'high' as const,
          href: '/dashboard/qa-inbox',
          icon: 'messages',
        },
        {
          id: 'payment-review',
          title: 'طلبات دفع معلقة',
          description: 'طلبات مرتبطة بكورساتك ولم تُراجع بعد.',
          count: pendingPayments,
          priority: 'medium' as const,
          href: '/dashboard/payments',
          icon: 'wallet',
        },
        {
          id: 'summary-review',
          title: 'ملخصات بانتظار المراجعة',
          description: 'ملخصات طلاب تحتاج قبولًا أو ملاحظة واضحة.',
          count: pendingSummaries,
          priority: 'medium' as const,
          href: '/dashboard/summaries-moderation',
          icon: 'file-check',
        },
        {
          id: 'course-drafts',
          title: 'كورسـات لم تُنشر',
          description: 'مسودات محفوظة تحتاج استكمال المحتوى أو النشر.',
          count: draftCourses,
          priority: 'low' as const,
          href: '/dashboard/courses',
          icon: 'book',
        },
      ]);
    }

    if (role !== Role.ADMIN) {
      throw new ForbiddenException('This action center is for staff only.');
    }

    const [essayAnswers, openQuestions, pendingPayments, reviewCourses, pendingSummaries] =
      await Promise.all([
        this.prisma.homeworkAnswer.count({
          where: {
            teacherGrade: null,
            attempt: { status: QuizAttemptStatus.SUBMITTED },
            question: {
              requiresImageAnswer: true,
              homework: { isDeleted: false, lesson: { isDeleted: false } },
            },
          },
        }),
        this.prisma.courseQuestion.count({ where: { status: QuestionStatus.OPEN } }),
        this.prisma.payment.count({ where: { status: PaymentStatus.PENDING } }),
        this.prisma.course.count({ where: { needsReview: true, isDeleted: false } }),
        this.prisma.summary.count({ where: { status: SummaryStatus.PENDING } }),
      ]);

    return this.buildActionCenter('ADMIN', [
      {
        id: 'payment-review',
        title: 'طلبات دفع معلقة',
        description: 'طلبات دفـع تحتاج مراجعة الإدارة قبل تفعيل الاشتراك.',
        count: pendingPayments,
        priority: 'high' as const,
        href: '/dashboard/payments',
        icon: 'wallet',
      },
      {
        id: 'course-review',
        title: 'كورسـات تحتاج مراجعة',
        description: 'كورسـات تم تمييزها لمراجعة بياناتها أو تصنيفها.',
        count: reviewCourses,
        priority: 'high' as const,
        href: '/dashboard/courses',
        icon: 'book',
      },
      {
        id: 'homework-grading',
        title: 'إجابات واجبات بانتظار التصحيح',
        description: 'إجابات مقالية أو مصوّرة لم تُرصد درجاتها بعد.',
        count: essayAnswers,
        priority: 'medium' as const,
        href: '/dashboard/homeworks',
        icon: 'clipboard',
      },
      {
        id: 'student-questions',
        title: 'أسئلة طلاب مفتوحة',
        description: 'أسئلة لم يرد عليها صاحب الكورس حتى الآن.',
        count: openQuestions,
        priority: 'medium' as const,
        href: '/dashboard/qa-inbox',
        icon: 'messages',
      },
      {
        id: 'summary-review',
        title: 'ملخصات تنتظر المراجعة',
        description: 'ملخصات طلاب تحتاج قرار قبول أو رفض مع ملاحظة.',
        count: pendingSummaries,
        priority: 'low' as const,
        href: '/dashboard/summaries-moderation',
        icon: 'file-check',
      },
    ]);
  }

  private buildActionCenter(
    role: 'TEACHER' | 'ADMIN',
    tasks: Array<{
      id: string;
      title: string;
      description: string;
      count: number;
      priority: 'high' | 'medium' | 'low';
      href: string;
      icon: string;
    }>,
  ) {
    return {
      role,
      generatedAt: new Date(),
      totalOpenItems: tasks.reduce((total, task) => total + task.count, 0),
      tasks,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STUDENT DASHBOARD
  // ─────────────────────────────────────────────────────────────
  async getStudentDashboard(userId: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      include: { user: { select: { email: true, phone: true } } },
    });
    if (!student) {
      throw new ForbiddenException('Student profile not found.');
    }

    // 1. الكورسات المشترك بها الطالب
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        studentId: student.id,
        status: EnrollmentStatus.ACTIVE,
        course: { isDeleted: false },
      },
      include: {
        course: {
          include: {
            teacher: {
              select: {
                id: true,
                fullName: true,
                specialization: true,
                photoUrl: true,
              },
            },
            lessons: {
              where: { isDeleted: false },
              select: { id: true, title: true, orderIndex: true },
              orderBy: { orderIndex: 'asc' },
            },
          },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });

    // جلب كل سجلات التقدم للطالب
    const allProgress = await this.prisma.progress.findMany({
      where: { studentId: student.id },
      include: {
        lesson: { select: { id: true, title: true, courseId: true } },
      },
      orderBy: { lastWatchedAt: 'desc' },
    });

    const progressByLesson = new Map(allProgress.map((p) => [p.lessonId, p]));

    let totalCompletedCourses = 0;

    const enrolledCourses = enrollments.map((enr) => {
      const course = enr.course;
      const totalLessons = course.lessons.length;
      const completedLessons = course.lessons.filter(
        (l) => progressByLesson.get(l.id)?.isCompleted,
      ).length;

      const progressPercentage =
        totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

      if (totalLessons > 0 && completedLessons === totalLessons) {
        totalCompletedCourses++;
      }

      // آخر درس شاهده الطالب في هذا الكورس
      const lastWatched = allProgress.find((p) => p.lesson.courseId === course.id);

      return {
        courseId: course.id,
        title: course.title,
        gradeLevel: course.gradeLevel,
        thumbnailUrl: course.thumbnailUrl,
        enrolledAt: enr.enrolledAt,
        teacher: course.teacher,
        totalLessons,
        completedLessons,
        progressPercentage,
        lastWatchedLesson: lastWatched
          ? {
              lessonId: lastWatched.lesson.id,
              title: lastWatched.lesson.title,
              watchedPercentage: lastWatched.watchedPercentage,
              lastWatchedAt: lastWatched.lastWatchedAt,
            }
          : null,
      };
    });

    // 2. آخر الامتحانات ومحاولات الطالب
    const recentExamAttempts = await this.prisma.examAttempt.findMany({
      where: {
        studentId: student.id,
        status: { in: [ExamAttemptStatus.SUBMITTED, ExamAttemptStatus.TIMED_OUT] },
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
      orderBy: { submittedAt: 'desc' },
      take: 5,
    });

    const examsStats = await this.prisma.examAttempt.aggregate({
      where: {
        studentId: student.id,
        status: { in: [ExamAttemptStatus.SUBMITTED, ExamAttemptStatus.TIMED_OUT] },
        score: { not: null },
      },
      _avg: { score: true },
      _count: { id: true },
    });

    return {
      student: {
        id: student.id,
        fullName: student.fullName,
        gradeLevel: student.gradeLevel,
        email: student.user.email,
        phone: student.user.phone,
      },
      stats: {
        totalEnrolledCourses: enrollments.length,
        completedCourses: totalCompletedCourses,
        totalExamsTaken: examsStats._count.id,
        averageExamScore: examsStats._avg.score ? Math.round(examsStats._avg.score * 10) / 10 : 0,
      },
      enrolledCourses,
      recentExamAttempts: recentExamAttempts.map((att) => ({
        attemptId: att.id,
        examTitle: att.exam.title,
        courseTitle: att.exam.course.title,
        score: att.score,
        totalMarks: att.exam.totalMarks,
        passingMarks: att.exam.passingMarks,
        isPassed: att.isPassed,
        submittedAt: att.submittedAt,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER DASHBOARD
  // ─────────────────────────────────────────────────────────────
  async getTeacherDashboard(userId: string) {
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId },
    });
    if (!teacher) {
      throw new ForbiddenException('Teacher profile not found.');
    }

    // 1. الكورسات الخاصة بالمدرس
    const courses = await this.prisma.course.findMany({
      where: { teacherId: teacher.id, isDeleted: false },
      include: {
        _count: {
          select: {
            lessons: { where: { isDeleted: false } },
            enrollments: { where: { status: EnrollmentStatus.ACTIVE } },
            exams: { where: { isDeleted: false } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 2. إجمالي الطلاب الفعليين غير المكررين
    const uniqueStudents = await this.prisma.enrollment.findMany({
      where: {
        course: { teacherId: teacher.id },
        status: EnrollmentStatus.ACTIVE,
      },
      distinct: ['studentId'],
      select: { studentId: true },
    });

    // 3. إجمالي الأرباح من المدفوعات المقبولة
    const revenueAgg = await this.prisma.payment.aggregate({
      where: {
        course: { teacherId: teacher.id },
        status: PaymentStatus.ACCEPTED,
      },
      _sum: { amount: true },
      _count: { id: true },
    });

    // 4. الإيصالات المعلقة بانتظار المراجعة
    const pendingReceiptsCount = await this.prisma.payment.count({
      where: {
        course: { teacherId: teacher.id },
        status: PaymentStatus.PENDING,
        // No receipt filter — count every pending payment order (with or
        // without an uploaded receipt) so the overview never shows a false 0.
      },
    });

    // 5. تفاصيل أداء كل كورس
    const coursePerformance = await Promise.all(
      courses.map(async (course) => {
        const courseRevenue = await this.prisma.payment.aggregate({
          where: {
            courseId: course.id,
            status: PaymentStatus.ACCEPTED,
          },
          _sum: { amount: true },
        });

        const examScoreAvg = await this.prisma.examAttempt.aggregate({
          where: {
            exam: { courseId: course.id, isDeleted: false },
            status: ExamAttemptStatus.SUBMITTED,
            score: { not: null },
          },
          _avg: { score: true },
        });

        return {
          courseId: course.id,
          title: course.title,
          status: course.status,
          price: Number(course.price),
          isFree: course.isFree,
          gradeLevel: course.gradeLevel,
          totalLessons: course._count.lessons,
          activeStudentsCount: course._count.enrollments,
          totalExams: course._count.exams,
          totalRevenue: Number(courseRevenue._sum.amount ?? 0),
          averageExamScore: examScoreAvg._avg.score
            ? Math.round(examScoreAvg._avg.score * 10) / 10
            : null,
        };
      }),
    );

    // 6. آخر النشاطات (آخر 5 اشتراكات + آخر 5 دفعات + آخر 5 تسليمات امتحانات)
    const recentEnrollments = await this.prisma.enrollment.findMany({
      where: {
        course: { teacherId: teacher.id },
        status: EnrollmentStatus.ACTIVE,
      },
      include: {
        student: { select: { fullName: true, gradeLevel: true } },
        course: { select: { title: true } },
      },
      orderBy: { enrolledAt: 'desc' },
      take: 5,
    });

    const recentPayments = await this.prisma.payment.findMany({
      where: { course: { teacherId: teacher.id } },
      include: {
        course: { select: { title: true } },
        enrollment: {
          include: { student: { select: { fullName: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const recentSubmissions = await this.prisma.examAttempt.findMany({
      where: {
        exam: { course: { teacherId: teacher.id } },
        status: ExamAttemptStatus.SUBMITTED,
      },
      include: {
        student: { select: { fullName: true } },
        exam: { select: { title: true, totalMarks: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 5,
    });

    return {
      overview: {
        totalUniqueStudents: uniqueStudents.length,
        totalCourses: courses.length,
        publishedCourses: courses.filter((c) => c.status === CourseStatus.PUBLISHED).length,
        draftCourses: courses.filter((c) => c.status === CourseStatus.DRAFT).length,
        totalGrossRevenue: Number(revenueAgg._sum.amount ?? 0),
        successfulPaymentsCount: revenueAgg._count.id,
        pendingReceiptsCount,
      },
      courses: coursePerformance,
      recentActivity: {
        enrollments: recentEnrollments.map((e) => ({
          studentName: e.student.fullName,
          courseTitle: e.course.title,
          gradeLevel: e.student.gradeLevel,
          enrolledAt: e.enrolledAt,
        })),
        payments: recentPayments.map((p) => ({
          paymentId: p.id,
          orderReference: p.orderReference,
          studentName: p.enrollment.student.fullName,
          courseTitle: p.course.title,
          amount: Number(p.amount),
          status: p.status,
          createdAt: p.createdAt,
        })),
        submissions: recentSubmissions.map((s) => ({
          attemptId: s.id,
          studentName: s.student.fullName,
          examTitle: s.exam.title,
          score: s.score,
          totalMarks: s.exam.totalMarks,
          isPassed: s.isPassed,
          submittedAt: s.submittedAt,
        })),
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // ADMIN DASHBOARD
  // ─────────────────────────────────────────────────────────────
  async getAdminDashboard() {
    // 1. المستخدمين حسب الدور
    const [totalUsers, studentsCount, teachersCount, adminsCount, verifiedStudentsCount] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { role: Role.STUDENT } }),
        this.prisma.user.count({ where: { role: Role.TEACHER } }),
        this.prisma.user.count({ where: { role: Role.ADMIN } }),
        this.prisma.user.count({ where: { role: Role.STUDENT, isVerified: true } }),
      ]);

    // 2. الكورسات
    const [totalCourses, publishedCourses, draftCourses, archivedCourses] =
      await Promise.all([
        this.prisma.course.count({ where: { isDeleted: false } }),
        this.prisma.course.count({ where: { status: CourseStatus.PUBLISHED, isDeleted: false } }),
        this.prisma.course.count({ where: { status: CourseStatus.DRAFT, isDeleted: false } }),
        this.prisma.course.count({ where: { status: CourseStatus.ARCHIVED, isDeleted: false } }),
      ]);

    // 3. المالية الشاملة على مستوى المنصة
    const [acceptedPayments, pendingPayments, rejectedPayments] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.ACCEPTED },
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.payment.count({ where: { status: PaymentStatus.PENDING } }),
      this.prisma.payment.count({ where: { status: PaymentStatus.REJECTED } }),
    ]);

    // 4. الامتحانات
    const [totalExams, totalAttempts, passedAttempts] = await Promise.all([
      this.prisma.exam.count({ where: { isDeleted: false } }),
      this.prisma.examAttempt.count({ where: { status: ExamAttemptStatus.SUBMITTED } }),
      this.prisma.examAttempt.count({
        where: { status: ExamAttemptStatus.SUBMITTED, isPassed: true },
      }),
    ]);

    const globalPassRate =
      totalAttempts > 0 ? Math.round((passedAttempts / totalAttempts) * 100) : 0;

    // 4.5 توزيع الطلاب على الكورسات (للمخطط البياني في نظرة عامة)
    const coursesRaw = await this.prisma.course.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        title: true,
        status: true,
        teacher: { select: { fullName: true } },
        _count: {
          select: { enrollments: { where: { status: EnrollmentStatus.ACTIVE } } },
        },
      },
      orderBy: { enrollments: { _count: 'desc' } },
    });

    const coursesBreakdown = coursesRaw.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      teacherName: c.teacher.fullName,
      studentsCount: c._count.enrollments,
    }));

    // 5. آخر الحسابات المسجلة
    const recentUsers = await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        isVerified: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return {
      users: {
        total: totalUsers,
        students: studentsCount,
        verifiedStudents: verifiedStudentsCount,
        teachers: teachersCount,
        admins: adminsCount,
      },
      courses: {
        total: totalCourses,
        published: publishedCourses,
        draft: draftCourses,
        archived: archivedCourses,
      },
      financials: {
        totalPlatformGrossRevenue: Number(acceptedPayments._sum.amount ?? 0),
        acceptedPaymentsCount: acceptedPayments._count.id,
        pendingPaymentsCount: pendingPayments,
        rejectedPaymentsCount: rejectedPayments,
      },
      exams: {
        totalExams,
        totalSubmittedAttempts: totalAttempts,
        passedAttempts,
        globalPassRate,
      },
      recentRegistrations: recentUsers,
      coursesBreakdown,
    };
  }
}
