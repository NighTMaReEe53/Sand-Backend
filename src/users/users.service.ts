import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import {
  CourseStatus,
  EnrollmentStatus,
  GradeLevel,
  PaymentStatus,
  QuestionStatus,
  Role,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../shared/prisma/prisma.service';
import { CreateTeacherDto } from './dtos/create-teacher.dto';
import { StudentQueryDto } from './dtos/student-query.dto';
import { PaginationQueryDto } from '../common/dtos/pagination-query.dto';
import { UpdateProfileDto } from './dtos/update-profile.dto';
import { ChangePasswordDto } from './dtos/change-password.dto';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { attachCourseOwnershipAndEnrollment } from '../common/utils/course-access.util';
import { StorageService } from '../shared/storage/storage.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly saltRounds = 12;

  private readonly gradeLevelsEnum = [
    'PREP_1',
    'PREP_2',
    'PREP_3',
    'SEC_1',
    'SEC_2',
    'SEC_3_LITERARY',
    'SEC_3_SCIENTIFIC',
    // Taxonomy-derived compatibility values (match Prisma GradeLevel enum)
    'AZHAR_PREP',
    'AZHAR_SEC',
    'BAC',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * إنشاء حساب مدرس جديد بواسطة الأدمن (is_verified = true مباشرة بدون OTP)
   */
  async createTeacher(adminId: string, dto: CreateTeacherDto) {
    const email = dto.email.toLowerCase().trim();
    const phone = dto.phone.trim();

    // 1. فحص عدم تكرار الإيميل أو رقم الهاتف
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { phone }],
      },
    });

    if (existing) {
      if (existing.email.toLowerCase() === email) {
        throw new ConflictException('يوجد حساب بنفس البريد الإلكتروني بالفعل.');
      }
      throw new ConflictException('يوجد حساب بنفس رقم الهاتف بالفعل.');
    }

    // 2. تشفير كلمة المرور
    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

    // 3. إنشاء المستخدم والبروفايل في عملية واحدة
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          phone,
          passwordHash,
          role: Role.TEACHER,
          isVerified: true, // تفعيل مباشر لأن الحساب أُنشئ بواسطة الأدمن
          isActive: true,
        },
      });

      const profile = await tx.teacherProfile.create({
        data: {
          userId: user.id,
          fullName: dto.fullName.trim(),
          specialization: dto.specialization.trim(),
          photoUrl: dto.photoUrl || null,
          address: dto.address || null,
          bio: dto.bio || null,
          extraInfo: dto.extraInfo || null,
          workPlaces: dto.workPlaces || [],
          createdByAdminId: adminId,
        },
      });

      return { user, profile };
    });

    this.logger.log(`Teacher created successfully: [ID: ${result.user.id}, Email: ${result.user.email}] by Admin: [${adminId}]`);

    return {
      id: result.user.id,
      email: result.user.email,
      phone: result.user.phone,
      role: result.user.role,
      isVerified: result.user.isVerified,
      isActive: result.user.isActive,
      profile: result.profile,
      createdAt: result.user.createdAt,
    };
  }

  /**
   * استعراض قائمة المدرسين مع Pagination وبحث للأدمن
   */
  async getTeachers(query: PaginationQueryDto) {
    const { page = 1, limit = 10, search } = query;
    const skip = (page - 1) * limit;

    const whereClause: any = {
      role: Role.TEACHER,
    };

    if (search && search.trim()) {
      const term = search.trim();
      whereClause.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
        { teacherProfile: { fullName: { contains: term, mode: 'insensitive' } } },
        { teacherProfile: { specialization: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [total, teachers] = await Promise.all([
      this.prisma.user.count({ where: whereClause }),
      this.prisma.user.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          phone: true,
          role: true,
          isVerified: true,
          isActive: true,
          createdAt: true,
          teacherProfile: true,
        },
      }),
    ]);

    return {
      teachers,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * ADMIN: ملف تشغيلي للمعلم. الأرقام محكومة بالاشتراكات النشطة والمدفوعات
   * المقبولة فقط حتى لا تعرض اللوحة تقديرات أو بيانات متضخمة.
   */
  async getTeacherDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
        teacherProfile: {
          select: {
            id: true,
            fullName: true,
            specialization: true,
            photoUrl: true,
            bio: true,
            address: true,
            extraInfo: true,
            workPlaces: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!user || user.role !== Role.TEACHER || !user.teacherProfile) {
      throw new NotFoundException('المعلم غير موجود.');
    }

    const courses = await this.prisma.course.findMany({
      where: { teacherId: user.teacherProfile.id, isDeleted: false },
      select: {
        id: true,
        title: true,
        subject: true,
        thumbnailUrl: true,
        price: true,
        isFree: true,
        status: true,
        updatedAt: true,
        _count: {
          select: {
            enrollments: { where: { status: EnrollmentStatus.ACTIVE } },
            lessons: { where: { isDeleted: false } },
            exams: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const courseIds = courses.map((course) => course.id);
    const activeEnrollmentKeys = new Set<string>();
    const completedByCourse = new Map<string, number>();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [activeEnrollments, revenue, pendingPayments, ratings, recentReviews, completedProgress, latestAudit, actionsLast30Days, activeStudentsLast30Days, openQuestionsCount] =
      await Promise.all([
        this.prisma.enrollment.findMany({
          where: {
            status: EnrollmentStatus.ACTIVE,
            course: { teacherId: user.teacherProfile.id, isDeleted: false },
          },
          select: { studentId: true, courseId: true },
        }),
        this.prisma.payment.aggregate({
          where: {
            status: PaymentStatus.ACCEPTED,
            course: { teacherId: user.teacherProfile.id, isDeleted: false },
          },
          _sum: { amount: true },
          _count: { id: true },
        }),
        this.prisma.payment.count({
          where: {
            status: PaymentStatus.PENDING,
            course: { teacherId: user.teacherProfile.id, isDeleted: false },
          },
        }),
        this.prisma.courseReview.aggregate({
          where: {
            isHidden: false,
            course: { teacherId: user.teacherProfile.id, isDeleted: false },
          },
          _avg: { rating: true },
          _count: { id: true },
        }),
        this.prisma.courseReview.findMany({
          where: {
            isHidden: false,
            course: { teacherId: user.teacherProfile.id, isDeleted: false },
          },
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true,
            student: { select: { fullName: true, gradeLevel: true } },
            course: { select: { id: true, title: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 8,
        }),
        this.prisma.progress.findMany({
          where: {
            isCompleted: true,
            lesson: { courseId: { in: courseIds }, isDeleted: false },
          },
          select: { studentId: true, lesson: { select: { courseId: true } } },
        }),
        this.prisma.auditLog.findFirst({
          where: { userId },
          select: { action: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.auditLog.count({
          where: { userId, createdAt: { gte: thirtyDaysAgo } },
        }),
        this.prisma.studentProfile.count({
          where: {
            lastSeenAt: { gte: thirtyDaysAgo },
            enrollments: {
              some: {
                status: EnrollmentStatus.ACTIVE,
                course: { teacherId: user.teacherProfile.id, isDeleted: false },
              },
            },
          },
        }),
        this.prisma.courseQuestion.count({
          where: {
            status: QuestionStatus.OPEN,
            course: { teacherId: user.teacherProfile.id, isDeleted: false },
          },
        }),
      ]);

    activeEnrollments.forEach((enrollment) =>
      activeEnrollmentKeys.add(`${enrollment.studentId}:${enrollment.courseId}`),
    );
    completedProgress.forEach((progress) => {
      const courseId = progress.lesson.courseId;
      if (!activeEnrollmentKeys.has(`${progress.studentId}:${courseId}`)) return;
      completedByCourse.set(courseId, (completedByCourse.get(courseId) ?? 0) + 1);
    });

    const revenueByCourse = new Map<string, number>();
    const courseRevenue = await this.prisma.payment.groupBy({
      by: ['courseId'],
      where: { courseId: { in: courseIds }, status: PaymentStatus.ACCEPTED },
      _sum: { amount: true },
    });
    courseRevenue.forEach((row) => {
      if (row.courseId) revenueByCourse.set(row.courseId, Number(row._sum.amount ?? 0));
    });

    const ratingByCourse = new Map<string, { average: number | null; count: number }>();
    const courseRatings = await this.prisma.courseReview.groupBy({
      by: ['courseId'],
      where: { courseId: { in: courseIds }, isHidden: false },
      _avg: { rating: true },
      _count: { id: true },
    });
    courseRatings.forEach((row) =>
      ratingByCourse.set(row.courseId, {
        average: row._avg.rating === null ? null : Number(row._avg.rating),
        count: row._count.id,
      }),
    );

    const activeStudents = new Set(activeEnrollments.map((enrollment) => enrollment.studentId));
    const lessonSlots = courses.reduce(
      (total, course) => total + course._count.lessons * course._count.enrollments,
      0,
    );
    const completedLessonRecords = [...completedByCourse.values()].reduce(
      (total, count) => total + count,
      0,
    );
    const completionRate =
      lessonSlots > 0 ? Math.round((completedLessonRecords / lessonSlots) * 100) : null;
    const lastCourseUpdate = courses.reduce<Date | null>(
      (latest, course) => (!latest || course.updatedAt > latest ? course.updatedAt : latest),
      null,
    );
    const lastActivityAt = latestAudit?.createdAt ?? lastCourseUpdate ?? user.teacherProfile.updatedAt;

    const totals = {
      coursesCount: courses.length,
      studentsCount: activeStudents.size,
      lessonsCount: courses.reduce((s, c) => s + c._count.lessons, 0),
      examsCount: courses.reduce((s, c) => s + c._count.exams, 0),
    };

    return {
      teacher: { ...user, totals },
      analytics: {
        totalRevenue: Number(revenue._sum.amount ?? 0),
        acceptedPaymentsCount: revenue._count.id,
        pendingPaymentsCount: pendingPayments,
        averageRating: ratings._avg.rating === null ? null : Number(ratings._avg.rating),
        reviewsCount: ratings._count.id,
        activeStudentsLast30Days,
        completedLessonRecords,
        lessonSlots,
        completionRate,
        openQuestionsCount,
        actionsLast30Days,
        lastActivityAt,
        lastActivityAction: latestAudit?.action ?? null,
        lastActivitySource: latestAudit ? 'سجل نشاط المنصة' : 'آخر تحديث للمحتوى أو الملف',
      },
      courses: courses.map((course) => ({
        ...course,
        completedLessons: completedByCourse.get(course.id) ?? 0,
        lessonSlots: course._count.lessons * course._count.enrollments,
        totalRevenue: revenueByCourse.get(course.id) ?? 0,
        averageRating: ratingByCourse.get(course.id)?.average ?? null,
        reviewsCount: ratingByCourse.get(course.id)?.count ?? 0,
      })),
      recentReviews,
    };
  }

  /**
   * استعراض قائمة الطلاب مع Pagination وبحث وفلترة حسب الصف الدراسي للأدمن
   */
  /**
   * Phase 6 — Student Search Dashboard.
   * Search students by name/email/phone and return a full profile:
   * personal info, enrolled courses, exam attempts and quiz attempts.
   * Teachers are scoped to students enrolled in their own courses.
   */
  async searchStudentsForStaff(
    q: string,
    user: AuthenticatedUser,
    limit = 10,
  ) {
    const term = q.trim();
    if (!term) return { results: [] };
    const take = Math.min(Math.max(limit || 10, 1), 25);

    const whereClause: any = {
      role: Role.STUDENT,
      OR: [
        { studentProfile: { fullName: { contains: term, mode: 'insensitive' } } },
        { email: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
        { studentProfile: { guardianPhone: { contains: term } } },
      ],
    };

    // Teachers only see students enrolled in their own courses
    if (user.role === Role.TEACHER) {
      const teacher = await this.prisma.teacherProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      whereClause.studentProfile = {
        enrollments: {
          some: {
            status: EnrollmentStatus.ACTIVE,
            course: { teacherId: teacher?.id ?? '00000000-0000-0000-0000-000000000000', isDeleted: false },
          },
        },
      };
    }

    const students = await this.prisma.user.findMany({
      where: whereClause,
      take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        phone: true,
        isActive: true,
        createdAt: true,
        studentProfile: {
          select: {
            id: true,
            fullName: true,
            gradeLevel: true,
            guardianPhone: true,
            enrollments: {
              where: { status: EnrollmentStatus.ACTIVE },
              select: {
                enrolledAt: true,
                status: true,
                course: { select: { id: true, title: true, subject: true } },
              },
            },
            examAttempts: {
              orderBy: { createdAt: 'desc' },
              take: 10,
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
                    course: { select: { id: true, title: true } },
                  },
                },
              },
            },
            quizAttempts: {
              orderBy: { createdAt: 'desc' },
              take: 10,
              select: {
                id: true,
                attemptNumber: true,
                score: true,
                isPassed: true,
                status: true,
                submittedAt: true,
                quiz: {
                  select: {
                    id: true,
                    title: true,
                    lesson: {
                      select: { title: true, section: { select: { courseId: true } } },
                    },
                  },
                },
              },
            },
            homeworkAttempts: {
              orderBy: { startedAt: 'desc' },
              take: 10,
              select: {
                id: true,
                attemptNumber: true,
                score: true,
                isPassed: true,
                status: true,
                submittedAt: true,
                homework: {
                  select: {
                    id: true,
                    title: true,
                    lesson: {
                      select: { title: true, section: { select: { courseId: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    return {
      results: students.map((u) => ({
        userId: u.id,
        studentProfileId: u.studentProfile?.id ?? null,
        email: u.email,
        phone: u.phone,
        isActive: u.isActive,
        memberSince: u.createdAt,
        fullName: u.studentProfile?.fullName ?? '',
        gradeLevel: u.studentProfile?.gradeLevel ?? null,
        guardianPhone: u.studentProfile?.guardianPhone ?? null,
        courses: (u.studentProfile?.enrollments ?? []).map((e) => ({
          id: e.course.id,
          title: e.course.title,
          subject: e.course.subject,
          enrolledAt: e.enrolledAt,
          enrollmentStatus: e.status,
        })),
        examAttempts: (u.studentProfile?.examAttempts ?? []).map((a) => ({
          attemptId: a.id,
          attemptNumber: a.attemptNumber,
          examId: a.exam.id,
          examTitle: a.exam.title,
          courseTitle: a.exam.course.title,
          score: a.score,
          isPassed: a.isPassed,
          status: a.status,
          submittedAt: a.submittedAt,
        })),
        quizAttempts: (u.studentProfile?.quizAttempts ?? []).map((a) => ({
          attemptId: a.id,
          attemptNumber: a.attemptNumber,
          quizId: a.quiz.id,
          quizTitle: a.quiz.title,
          lessonTitle: a.quiz.lesson?.title ?? '',
          score: a.score,
          isPassed: a.isPassed,
          status: a.status,
          submittedAt: a.submittedAt,
        })),
        homeworkAttempts: (u.studentProfile?.homeworkAttempts ?? []).map((a) => ({
          attemptId: a.id,
          attemptNumber: a.attemptNumber,
          homeworkId: a.homework.id,
          homeworkTitle: a.homework.title,
          lessonTitle: a.homework.lesson?.title ?? '',
          score: a.score,
          isPassed: a.isPassed,
          status: a.status,
          submittedAt: a.submittedAt,
        })),
      })),
    };
  }

  /**
   * PUBLIC: get public profile of a student by their StudentProfile ID.
   * Returns only public-safe data — no email, phone, or sensitive fields.
   */
  async getStudentPublicProfile(studentProfileId: string) {
    const profile = await this.prisma.studentProfile.findFirst({
      where: {
        id: studentProfileId,
        user: { is: { role: Role.STUDENT, isActive: true } },
      },
      select: {
        id: true,
        fullName: true,
        gradeLevel: true,
        photoUrl: true,
        createdAt: true,
        user: { select: { createdAt: true } },
        enrollments: {
          where: {
            status: EnrollmentStatus.ACTIVE,
            course: { isDeleted: false, status: CourseStatus.PUBLISHED },
          },
          select: {
            enrolledAt: true,
            course: {
              select: {
                id: true,
                title: true,
                subject: true,
                thumbnailUrl: true,
                teacher: { select: { id: true, fullName: true, photoUrl: true } },
              },
            },
          },
        },
        examAttempts: {
          where: { status: { in: ['SUBMITTED', 'TIMED_OUT', 'EXPIRED'] } },
          select: {
            id: true,
            score: true,
            isPassed: true,
            submittedAt: true,
            exam: { select: { totalMarks: true } },
          },
        },
        quizAttempts: {
          where: { status: 'SUBMITTED' },
          select: {
            id: true,
            score: true,
            isPassed: true,
            submittedAt: true,
          },
        },
        ownedAvatars: {
          where: { isActive: true },
          take: 1,
          select: { avatar: { select: { imageUrl: true, name: true } } },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('الطالب غير موجود.');
    }

    const totalExamAttempts = profile.examAttempts.length;
    const passedExams = profile.examAttempts.filter((a) => a.isPassed).length;
    // An attempt's score is earned marks, not a percentage. Normalizing each
    // attempt first keeps the displayed public average correct when exams have
    // different total marks.
    const scoredExamAttempts = profile.examAttempts.filter(
      (attempt) => attempt.score !== null && attempt.exam.totalMarks > 0,
    );
    const avgScore = scoredExamAttempts.length
      ? Math.round(
          scoredExamAttempts.reduce(
            (sum, attempt) => sum + ((attempt.score ?? 0) / attempt.exam.totalMarks) * 100,
            0,
          ) / scoredExamAttempts.length,
        )
      : 0;

    const enrolledCoursesCount = profile.enrollments.length;
    const totalQuizAttempts = profile.quizAttempts.length;
    const passedQuizzes = profile.quizAttempts.filter((a) => a.isPassed).length;

    // Build achievement badges
    const achievements: string[] = [];
    if (enrolledCoursesCount >= 1) achievements.push('أول كورس');
    if (enrolledCoursesCount >= 5) achievements.push('متعلم نشيط');
    if (enrolledCoursesCount >= 10) achievements.push('طالب متميز');
    if (passedExams >= 1) achievements.push('أول امتحان ناجح');
    if (passedExams >= 5) achievements.push('متفوق في الامتحانات');
    if (passedExams >= 10) achievements.push('نجم الامتحانات');
    if (avgScore >= 90) achievements.push('متفوق');
    if (passedQuizzes >= 10) achievements.push('منجز الكويزات');

    const activeAvatar = profile.ownedAvatars?.[0]?.avatar ?? null;

    return {
      id: profile.id,
      fullName: profile.fullName,
      gradeLevel: profile.gradeLevel,
      photoUrl: activeAvatar?.imageUrl ?? profile.photoUrl ?? null,
      memberSince: profile.user.createdAt,
      stats: {
        enrolledCourses: enrolledCoursesCount,
        totalExamAttempts,
        passedExams,
        avgScore,
        totalQuizAttempts,
        passedQuizzes,
      },
      achievements,
      enrolledCourses: profile.enrollments.map((e) => ({
        courseId: e.course.id,
        title: e.course.title,
        subject: e.course.subject,
        thumbnailUrl: e.course.thumbnailUrl,
        enrolledAt: e.enrolledAt,
        teacher: e.course.teacher,
      })),
    };
  }

  /**
   * TEACHER/ADMIN: create a student account (optionally enrolling into a course).
   * Returns the generated password once if it was auto-created.
   */
  async createStudentByStaff(dto: {
    fullName: string;
    email: string;
    studentPhone: string;
    guardianPhone: string;
    password?: string;
    gradeLevel: string;
    courseId?: string;
  }, user: AuthenticatedUser) {
    const email = dto.email.toLowerCase().trim();
    const phone = dto.studentPhone.trim();

    if (!this.gradeLevelsEnum.includes(dto.gradeLevel)) {
      throw new BadRequestException('المرحلة الدراسية غير صحيحة.');
    }

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
    });
    if (existing) {
      throw new ConflictException('يوجد حساب بنفس البريد الإلكتروني أو رقم الهاتف بالفعل.');
    }

    // رقم ولي الأمر: فريد ولا يطابق رقم الطالب أو أي حساب آخر
    await this.assertGuardianPhoneAvailable(dto.guardianPhone, dto.studentPhone);

    const rawPassword = dto.password || Math.random().toString(36).slice(2, 8) + Math.floor(Math.random() * 90 + 10);
    const passwordHash = await bcrypt.hash(rawPassword, this.saltRounds);

    let enrollCourseId: string | null = null;
    if (dto.courseId) {
      const courseWhere: any = { id: dto.courseId, isDeleted: false };
      if (user.role === Role.TEACHER) {
        const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id } });
        if (!teacher) throw new ForbiddenException('لم تم العثور على ملف المدرس — تأكد من صلاحياتك.');
        courseWhere.teacherId = teacher.id;
      }
      const course = await this.prisma.course.findFirst({ where: courseWhere, select: { id: true } });
      if (!course) throw new NotFoundException('الكورس غير موجود أو لا تملك صلاحية الوصول إليه.');
      enrollCourseId = course.id;
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          phone,
          passwordHash,
          role: Role.STUDENT,
          isVerified: true,
          isActive: true,
        },
      });

      const profile = await tx.studentProfile.create({
        data: {
          userId: newUser.id,
          fullName: dto.fullName.trim(),
          gradeLevel: dto.gradeLevel as GradeLevel,
          guardianPhone: dto.guardianPhone.trim(),
        },
      });

      if (enrollCourseId) {
        await tx.enrollment.create({
          data: {
            studentId: profile.id,
            courseId: enrollCourseId,
            status: EnrollmentStatus.ACTIVE,
            enrolledAt: new Date(),
          },
        });
      }

      return { user: newUser, profile };
    });

    this.logger.log(`Student created by staff: [${result.user.id}] by [${user.id}]`);

    return {
      id: result.user.id,
      email: result.user.email,
      isActive: result.user.isActive,
      enrolledIntoCourseId: enrollCourseId,
      generatedPassword: dto.password ? undefined : rawPassword,
    };
  }

  /** ADMIN: activate / deactivate any account. */
  async setAccountStatus(userId: string, isActive: boolean, adminId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('الحساب غير موجود.');
    if (target.role === Role.ADMIN) {
      throw new ForbiddenException('لا يمكن إيقاف حسابات المشرفين من هنا.');
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: { id: true, isActive: true },
    });
    this.logger.log(`Account ${userId} set active=${isActive} by admin [${adminId}]`);
    return updated;
  }

  /** ADMIN: partially update a student account (profile + credentials). */
  async updateStudentByAdmin(
    userId: string,
    dto: {
      fullName?: string;
      email?: string;
      studentPhone?: string;
      guardianPhone?: string;
      gradeLevel?: string;
      isActive?: boolean;
    },
    adminId: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { studentProfile: true },
    });
    if (!user || !user.studentProfile || user.role !== Role.STUDENT) {
      throw new NotFoundException('الطالب غير موجود.');
    }

    const email = dto.email?.toLowerCase().trim();
    const phone = dto.studentPhone?.trim();

    // Uniqueness check on User-level contacts (email / phone)
    if (email || phone) {
      const clash = await this.prisma.user.findFirst({
        where: {
          id: { not: userId },
          OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
        },
        select: { email: true, phone: true },
      });
      if (clash) {
        if (email && clash.email.toLowerCase() === email) {
          throw new ConflictException('هذا البريد الإلكتروني مستخدم بالفعل.');
        }
        throw new ConflictException('رقم الهاتف مستخدم بالفعل.');
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(email && { email }),
          ...(phone && { phone }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
      return tx.studentProfile.update({
        where: { userId },
        data: {
          ...(dto.fullName !== undefined && { fullName: dto.fullName.trim() }),
          ...(dto.guardianPhone !== undefined && { guardianPhone: dto.guardianPhone.trim() }),
          ...(dto.gradeLevel && { gradeLevel: dto.gradeLevel as GradeLevel }),
        },
      });
    });

    this.logger.log(`Student ${userId} updated by admin [${adminId}]`);
    return { message: 'تم تحديث بيانات الطالب بنجاح.', student: updated };
  }

  /** ADMIN: permanently delete a student account and all of their data. */
  async deleteStudentByAdmin(userId: string, adminId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { studentProfile: true },
    });
    if (!user || !user.studentProfile || user.role !== Role.STUDENT) {
      throw new NotFoundException('الطالب غير موجود.');
    }

    await this.prisma.$transaction(async (tx) => {
      // Rows that reference the user without DB cascade must be detached first.
      await tx.lessonAnswer.deleteMany({ where: { authorUserId: userId } });
      // Keep the audit trail but detach it from the deleted account.
      await tx.auditLog.updateMany({ where: { userId }, data: { userId: null } });
      // Cascades to StudentProfile -> enrollments, attempts, progress, ...
      await tx.user.delete({ where: { id: userId } });
    });

    this.logger.log(`Student ${userId} deleted by admin [${adminId}]`);
    return { message: 'تم حذف حساب الطالب وكل بياناته نهائياً.' };
  }

  /** ADMIN: partially update a teacher account. */
  async updateTeacherByAdmin(
    teacherUserId: string,
    dto: {
      fullName?: string;
      email?: string;
      phone?: string;
      specialization?: string;
      bio?: string;
      address?: string;
      photoUrl?: string;
      isActive?: boolean;
    },
    adminId: string,
  ) {
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId: teacherUserId },
    });
    if (!teacher) throw new NotFoundException('المدرس غير موجود.');

    const email = dto.email?.toLowerCase().trim();
    const phone = dto.phone?.trim();

    if (email || phone) {
      const clash = await this.prisma.user.findFirst({
        where: {
          id: { not: teacherUserId },
          OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
        },
        select: { email: true, phone: true },
      });
      if (clash) {
        if (email && clash.email.toLowerCase() === email) {
          throw new ConflictException('هذا البريد الإلكتروني مستخدم بالفعل.');
        }
        throw new ConflictException('رقم الهاتف مستخدم بالفعل.');
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: teacherUserId },
        data: {
          ...(email && { email }),
          ...(phone && { phone }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
      return tx.teacherProfile.update({
        where: { userId: teacherUserId },
        data: {
          ...(dto.fullName !== undefined && { fullName: dto.fullName.trim() }),
          ...(dto.specialization !== undefined && { specialization: dto.specialization.trim() }),
          ...(dto.bio !== undefined && { bio: dto.bio }),
          ...(dto.address !== undefined && { address: dto.address }),
          ...(dto.photoUrl !== undefined && { photoUrl: dto.photoUrl }),
        },
      });
    });

    this.logger.log(`Teacher ${teacherUserId} updated by admin [${adminId}]`);
    return { message: 'تم تحديث بيانات المدرس بنجاح.', teacher: updated };
  }

  async getStudents(query: StudentQueryDto) {
    const { page = 1, limit = 10, search, gradeLevel } = query;
    const skip = (page - 1) * limit;

    const whereClause: any = {
      role: Role.STUDENT,
    };

    if (gradeLevel) {
      whereClause.studentProfile = {
        gradeLevel,
      };
    }

    if (search && search.trim()) {
      const term = search.trim();
      whereClause.AND = [
        whereClause.studentProfile ? { studentProfile: whereClause.studentProfile } : {},
        {
          OR: [
            { email: { contains: term, mode: 'insensitive' } },
            { phone: { contains: term } },
            { studentProfile: { fullName: { contains: term, mode: 'insensitive' } } },
            { studentProfile: { guardianPhone: { contains: term } } },
          ],
        },
      ];
      delete whereClause.studentProfile;
    }

    const [total, students] = await Promise.all([
      this.prisma.user.count({ where: whereClause }),
      this.prisma.user.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          phone: true,
          role: true,
          isVerified: true,
          isActive: true,
          createdAt: true,
          studentProfile: true,
        },
      }),
    ]);

    return {
      students,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * استرجاع البروفايل الكامل للمستخدم الحالي (مدرس / طالب / أدمن)
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        studentProfile: {
          include: {
            enrollments: {
              where: {
                status: EnrollmentStatus.ACTIVE,
                course: { isDeleted: false },
              },
              orderBy: { enrolledAt: 'desc' },
              include: {
                course: {
                  include: {
                    targets: {
                      include: {
                        grade: { include: { stage: true } },
                        track: true,
                      },
                    },
                    teacher: {
                      select: {
                        id: true,
                        fullName: true,
                        specialization: true,
                        photoUrl: true,
                      },
                    },
                    _count: {
                      select: {
                        lessons: { where: { isDeleted: false } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        teacherProfile: {
          include: {
            courses: {
              where: { isDeleted: false },
              orderBy: { createdAt: 'desc' },
              include: {
                targets: {
                  include: {
                    grade: { include: { stage: true } },
                    track: true,
                  },
                },
                _count: {
                  select: {
                    lessons: { where: { isDeleted: false } },
                    enrollments: { where: { status: EnrollmentStatus.ACTIVE } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User profile not found.');
    }

    if (user.role === Role.STUDENT && user.studentProfile) {
      const enrolledCourses = user.studentProfile.enrollments.map((e) => ({
        ...e.course,
        enrolledAt: e.enrolledAt,
        enrollmentId: e.id,
      }));

      return {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
        createdAt: user.createdAt,
        fullName: user.studentProfile.fullName,
        guardianPhone: user.studentProfile.guardianPhone,
        gradeLevel: user.studentProfile.gradeLevel,
        photoUrl: user.studentProfile.photoUrl,
        enrolledCourses,
        hasEnrollments: enrolledCourses.length > 0,
        totalEnrolledCourses: enrolledCourses.length,
        studentProfile: user.studentProfile,
      };
    }

    if (user.role === Role.TEACHER && user.teacherProfile) {
      const courses = user.teacherProfile.courses.map((course) => ({
        id: course.id,
        title: course.title,
        description: course.description,
        thumbnailUrl: course.thumbnailUrl,
        price: Number(course.price),
        isFree: course.isFree,
        gradeLevel: course.gradeLevel,
        gradeLevels: course.gradeLevels,
        targets: course.targets,
        status: course.status,
        createdAt: course.createdAt,
        totalLessons: course._count.lessons,
        totalStudents: course._count.enrollments,
      }));

      const totalStudents = courses.reduce((sum, c) => sum + (c.totalStudents || 0), 0);
      const totalLessons = courses.reduce((sum, c) => sum + (c.totalLessons || 0), 0);

      return {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
        createdAt: user.createdAt,
        fullName: user.teacherProfile.fullName,
        specialization: user.teacherProfile.specialization,
        photoUrl: user.teacherProfile.photoUrl,
        bio: user.teacherProfile.bio,
        workPlaces: user.teacherProfile.workPlaces,
        address: user.teacherProfile.address,
        totalCourses: courses.length,
        totalStudents,
        totalLessons,
        courses,
        teacherProfile: user.teacherProfile,
      };
    }

    return user;
  }

  /**
   * تحديث بيانات البروفايل للمستخدم الحالي
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        studentProfile: true,
        teacherProfile: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (user.role === Role.STUDENT) {
      // رقم ولي الأمر: فريد ولا يطابق رقم الطالب أو أي حساب آخر (يُسمح برقم حساب ولي أمر موجود بالفعل)
      if (
        dto.guardianPhone !== undefined &&
        dto.guardianPhone.trim() !== user.studentProfile?.guardianPhone
      ) {
        await this.assertGuardianPhoneAvailable(dto.guardianPhone, user.phone, {
          allowParentAccount: true,
        });
      }

      const updatedProfile = await this.prisma.studentProfile.update({
        where: { userId },
        data: {
          fullName: dto.fullName !== undefined ? dto.fullName.trim() : undefined,
          guardianPhone: dto.guardianPhone !== undefined ? dto.guardianPhone.trim() : undefined,
          gradeLevel: dto.gradeLevel !== undefined ? dto.gradeLevel : undefined,
        },
      });

      return {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        profile: updatedProfile,
      };
    }

    if (user.role === Role.TEACHER) {
      // المسمى (specialization) لا يمكن للمعلم تعديله بنفسه — الأدمن فقط
      const updatedProfile = await this.prisma.teacherProfile.update({
        where: { userId },
        data: {
          fullName: dto.fullName !== undefined ? dto.fullName.trim() : undefined,
          photoUrl: dto.photoUrl !== undefined ? dto.photoUrl : undefined,
          address: dto.address !== undefined ? dto.address : undefined,
          bio: dto.bio !== undefined ? dto.bio : undefined,
          extraInfo: dto.extraInfo !== undefined ? dto.extraInfo : undefined,
          workPlaces: dto.workPlaces !== undefined ? dto.workPlaces : undefined,
        },
      });

      return {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        profile: updatedProfile,
      };
    }

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
    };
  }

  /**
   * ADMIN فقط: تعديل مسمى/لقب المعلم (specialization).
   * المعلم نفسه ممنوع من تعديله عبر تحديث الملف الشخصي.
   */
  async updateTeacherTitleByAdmin(teacherUserId: string, specialization: string) {
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId: teacherUserId },
      select: { id: true },
    });
    if (!teacher) throw new NotFoundException('Teacher profile not found.');

    const updated = await this.prisma.teacherProfile.update({
      where: { userId: teacherUserId },
      data: { specialization: specialization.trim() },
      select: { id: true, fullName: true, specialization: true },
    });

    return { message: 'تم تحديث مسمى المعلم بنجاح.', teacher: updated };
  }

  /**
   * TEACHER / ADMIN: رفع صورة الملف الشخصي من الجهاز (ملف محلي)
   * وتحديث photoUrl مباشرة.
   */
  /**
   * ADMIN: رفع صورة لمدرس (قبل أو بعد إنشاء الحساب) وإرجاع الرابط فقط.
   */
  async uploadTeacherPhoto(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Image file is required.');

    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Only JPEG, PNG and WebP images are allowed.');
    }
    const maxBytes = 5 * 1024 * 1024; // 5 MB
    if (file.size > maxBytes) {
      throw new BadRequestException('Image size exceeds 5MB limit.');
    }

    const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const uniqueFileName = `teacher_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;

    const imageUrl = await this.storageService.uploadFile(
      {
        originalname: uniqueFileName,
        buffer: file.buffer,
        mimetype: file.mimetype,
      },
      'profiles',
    );

    return { url: imageUrl };
  }

  async uploadProfileImage(userId: string, file: Express.Multer.File) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    if (user.role !== Role.TEACHER && user.role !== Role.ADMIN) {
      throw new ForbiddenException('Only teachers and admins can upload a profile image.');
    }

    if (!file) throw new BadRequestException('Image file is required.');

    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Only JPEG, PNG and WebP images are allowed.');
    }
    const maxBytes = 5 * 1024 * 1024; // 5 MB
    if (file.size > maxBytes) {
      throw new BadRequestException('Image size exceeds 5MB limit.');
    }

    const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const uniqueFileName = `profile_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;

    const imageUrl = await this.storageService.uploadFile(
      {
        originalname: uniqueFileName,
        buffer: file.buffer,
        mimetype: file.mimetype,
      },
      'profiles',
    );

    const updated = await this.prisma.teacherProfile.update({
      where: { userId },
      data: { photoUrl: imageUrl },
      select: { photoUrl: true },
    });

    return { message: 'تم تحديث صورة الملف الشخصي بنجاح.', photoUrl: updated.photoUrl };
  }

  /**
   * تغيير كلمة المرور للمستخدم الحالي
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    // 1. التحقق من كلمة المرور الحالية
    const isMatch = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    // 2. التأكد من أن كلمة المرور الجديدة مختلفة عن الحالية
    const isSame = await bcrypt.compare(dto.newPassword, user.passwordHash);
    if (isSame) {
      throw new BadRequestException('New password cannot be the same as the current password.');
    }

    // 3. تشفير وحفظ كلمة المرور الجديدة
    const newPasswordHash = await bcrypt.hash(dto.newPassword, this.saltRounds);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    // 4. إبطال الجلسات السابقة (Soft-Revoke: ممنوع حذف السجلات)
    await this.prisma.userSession.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });

    return {
      message: 'Password changed successfully. Please log in with your new password.',
    };
  }

  /**
   * حذف حساب مدرس (Soft Delete) مع تطبيق الحذف المتسلسل التلقائي على كورساته ودروسه
   */
  async deleteTeacher(teacherUserId: string) {
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId: teacherUserId },
    });

    if (!teacher) {
      throw new NotFoundException('Teacher profile not found.');
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. تعطيل المستخدم
      await tx.user.update({
        where: { id: teacherUserId },
        data: { isActive: false },
      });

      // 2. استرجاع كل كورسات المدرس
      const courses = await tx.course.findMany({
        where: { teacherId: teacher.id, isDeleted: false },
        select: { id: true },
      });
      const courseIds = courses.map((c) => c.id);

      if (courseIds.length > 0) {
        // Soft delete all courses
        await tx.course.updateMany({
          where: { id: { in: courseIds } },
          data: { isDeleted: true },
        });

        // Soft delete all lessons
        await tx.lesson.updateMany({
          where: { courseId: { in: courseIds } },
          data: { isDeleted: true },
        });

        // Soft delete all materials
        await tx.courseMaterial.updateMany({
          where: { courseId: { in: courseIds }, deletedAt: null },
          data: { deletedAt: new Date() },
        });
      }
    });

    return { message: 'Teacher and associated courses soft-deleted successfully.' };
  }

  /**
   * جلب بروفايل المدرس العام مع كورساته وإحصائياته المحسوبة مسبقاً
   * متاح للعامة مع عرض الكورسات المسودة (DRAFT) إذا كان المستعلم هو المدرس نفسه أو أدمن
   */
  async getTeacherProfile(teacherIdentifier: string, currentUser?: AuthenticatedUser) {
    // دعم البحث إما بـ TeacherProfile.id أو User.id
    const teacher = await this.prisma.teacherProfile.findFirst({
      where: {
        OR: [
          { id: teacherIdentifier },
          { userId: teacherIdentifier },
        ],
        user: { role: Role.TEACHER, isActive: true },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            role: true,
            createdAt: true,
          },
        },
      },
    });

    if (!teacher) {
      throw new NotFoundException('المدرس غير موجود / Teacher not found.');
    }

    // التحقق هل الزائر هو نفس المدرس أو أدمن لرؤية الكورسات المسودة أيضاً
    const isSelfOrAdmin =
      currentUser &&
      (currentUser.role === Role.ADMIN || currentUser.id === teacher.userId);

    const courseWhere: any = {
      teacherId: teacher.id,
      isDeleted: false,
    };

    if (!isSelfOrAdmin) {
      courseWhere.status = CourseStatus.PUBLISHED;
    }

    const rawCourses = await this.prisma.course.findMany({
      where: courseWhere,
      orderBy: { createdAt: 'desc' },
      include: {
        teacher: {
          select: {
            id: true,
            userId: true,
            fullName: true,
            specialization: true,
            photoUrl: true,
          },
        },
        _count: {
          select: {
            lessons: { where: { isDeleted: false } },
            materials: { where: { deletedAt: null } },
            enrollments: { where: { status: EnrollmentStatus.ACTIVE } },
          },
        },
      },
    });

    const courses = await attachCourseOwnershipAndEnrollment(this.prisma, rawCourses, currentUser);

    const totalCourses = courses.length;
    const totalStudents = courses.reduce((sum, c) => sum + (c._count?.enrollments || 0), 0);
    const totalLessons = courses.reduce((sum, c) => sum + (c._count?.lessons || 0), 0);

    return {
      id: teacher.id,
      userId: teacher.userId,
      fullName: teacher.fullName,
      specialization: teacher.specialization,
      title: teacher.specialization,
      photoUrl: teacher.photoUrl,
      avatarUrl: teacher.photoUrl,
      bio: teacher.bio,
      extraInfo: teacher.extraInfo,
      workPlaces: teacher.workPlaces,
      address: teacher.address,
      // بيانات التواصل لا تُكشف للعامة — فقط لصاحب الحساب أو الأدمن
      ...(isSelfOrAdmin && {
        email: teacher.user.email,
        phone: teacher.user.phone,
      }),
      totalCourses,
      totalStudents,
      totalLessons,
      courses,
    };
  }

  /**
   * التحقق من رقم ولي الأمر: فريد ولا يطابق رقم الطالب أو أي حساب آخر.
   * (نفس منطق AuthService.assertGuardianPhoneAvailable)
   */
  private async assertGuardianPhoneAvailable(
    guardianPhone: string,
    studentPhone?: string,
    options: { allowParentAccount?: boolean } = {},
  ): Promise<void> {
    const phone = guardianPhone.trim();

    if (studentPhone && phone === studentPhone.trim()) {
      throw new ConflictException(
        'لا يمكن أن يكون رقم ولي الأمر هو نفسه رقم هاتف الطالب.',
      );
    }

    const phoneUser = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true, role: true },
    });
    if (
      phoneUser &&
      !(options.allowParentAccount && phoneUser.role === Role.PARENT)
    ) {
      throw new ConflictException(
        'رقم ولي الأمر مستخدم بالفعل في حساب آخر مسجل. يجب إدخال رقم مختلف.',
      );
    }

    const usedByStudent = await this.prisma.studentProfile.findFirst({
      where: { guardianPhone: phone },
      select: { id: true },
    });
    if (usedByStudent) {
      throw new ConflictException(
        'رقم ولي الأمر هذا مستخدم بالفعل لحساب طالب آخر. كل حساب يحتاج رقم ولي أمر خاصًا به.',
      );
    }
  }
}
