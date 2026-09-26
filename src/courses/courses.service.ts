import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import {
  AccessType,
  CourseStatus,
  EnrollmentStatus,
  GradeLevel,
  Role,
  QuizAttemptStatus,
  ExamAttemptStatus,
  SummaryStatus,
} from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../shared/prisma/prisma.service';
import { StorageService } from '../shared/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateCourseDto } from './dtos/create-course.dto';
import { UpdateCourseDto } from './dtos/update-course.dto';
import { CourseQueryDto } from './dtos/course-query.dto';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { attachCourseOwnershipAndEnrollment, canManageCourse } from '../common/utils/course-access.util';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import * as crypto from 'crypto';
import * as path from 'path';

@Injectable()
export class CoursesService {
  private readonly logger = new Logger(CoursesService.name);

constructor(
private readonly prisma: PrismaService,
private readonly storageService: StorageService,
private readonly notificationsService: NotificationsService,
private readonly taxonomy: TaxonomyService,
  ) {}

  /**
   * إنشاء كورس جديد بواسطة المدرس
   */
  async createCourse(userId: string, dto: CreateCourseDto) {
    let teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId },
    });

    // ADMIN has full management powers — auto-provision a teacher profile so
    // admins can create and own courses just like teachers do.
    if (!teacher) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (user?.role === Role.ADMIN) {
        teacher = await this.prisma.teacherProfile.create({
          data: {
            userId,
            fullName: 'فريق الإدارة',
            specialization: 'إدارة المنصة',
            createdByAdminId: userId,
          },
        });
      }
    }

    if (!teacher) {
      throw new ForbiddenException('Teacher profile not found.');
    }

    const isFree = dto.isFree || dto.price === 0;
    const price = isFree ? 0 : dto.price || 0;
    const discount = this.normalizeDiscount(dto.discountPercent, dto.discountEndsAt);
    // Accept legacy callers that still submit one gradeLevel while the UI uses
    // gradeLevels for the proper multi-target experience. Do NOT throw here when
    // the array is empty — the new UI sends `targets` instead, and the grade
    // levels are derived from those targets below. The "at least one" check is
    // enforced after derivation (see final guard).
    let gradeLevels = this.cleanGradeLevels(dto.gradeLevels || (dto.gradeLevel ? [dto.gradeLevel] : []));

    // Normalized taxonomy targets — validated server-side before anything is written
    let validatedTargets: { gradeId: string; trackId: string | null }[] = [];
    if (dto.targets?.length) {
      const seen = new Set<string>();
      for (const t of dto.targets) {
        await this.taxonomy.validateGradeTrackPair(t.gradeId, t.trackId ?? null);
        const key = `${t.gradeId}:${t.trackId ?? ''}`;
        if (seen.has(key)) continue; // silently dedupe on create
        seen.add(key);
        validatedTargets.push({ gradeId: t.gradeId, trackId: t.trackId ?? null });
      }
    }

    // New UI no longer sends legacy gradeLevels — derive them from the
    // normalized targets so the compatibility columns stay populated.
    if (!gradeLevels.length && validatedTargets.length) {
      const codes = new Set<GradeLevel>();
      for (const t of validatedTargets) {
        const g = await this.prisma.grade.findUnique({
          where: { id: t.gradeId },
          select: { code: true },
        });
        const track = t.trackId
          ? await this.prisma.track.findUnique({ where: { id: t.trackId }, select: { code: true } })
          : null;
        const code = g?.code as string | undefined;
        if (code === 'SEC_3') {
          codes.add(
            /SCIENCE|MATH$/.test(track?.code ?? '')
              ? GradeLevel.SEC_3_SCIENTIFIC
              : GradeLevel.SEC_3_LITERARY,
          );
        } else if (code && Object.values(GradeLevel).includes(code as GradeLevel)) {
          codes.add(code as GradeLevel);
        }
      }
      if (!codes.size) codes.add(GradeLevel.SEC_1);
      gradeLevels = Array.from(codes);
    }

    // Final guard: a course must target at least one grade level, whether it
    // came from the legacy `gradeLevels`/`gradeLevel` fields or was derived
    // from the normalized `targets`.
    if (!gradeLevels.length) {
      throw new BadRequestException('اختر مرحلة دراسية واحدة على الأقل للكورس.');
    }

    // If a normalized subject was supplied, resolve + keep legacy label in sync
    let subjectRef: { id: string } | null = null;
    if (dto.subjectId) {
      const subj = await this.prisma.subject.findUnique({ where: { id: dto.subjectId } });
      if (!subj || !subj.isActive) {
        throw new NotFoundException('المادة الدراسية غير موجودة.');
      }
      subjectRef = { id: subj.id };
    }

    const course = await this.prisma.course.create({
      data: {
        teacherId: teacher.id,
        title: dto.title.trim(),
        description: dto.description.trim(),
        learningOutcomes: this.cleanLearningOutcomes(dto.learningOutcomes),
        thumbnailUrl: dto.thumbnailUrl || null,
        price,
        isFree,
        discountPercent: discount.discountPercent,
        discountEndsAt: discount.discountEndsAt,
        gradeLevel: gradeLevels[0],
        gradeLevels,
        subject: dto.subject?.trim() || null,
        subjectId: subjectRef?.id ?? null,
        status: dto.status || CourseStatus.DRAFT,
        accessType: dto.accessType || AccessType.LIFETIME,
        durationMonths:
          dto.accessType === AccessType.LIMITED
            ? (dto.durationMonths ?? null)
            : null,
        ...(validatedTargets.length
          ? { targets: { create: validatedTargets.map((t) => ({ gradeId: t.gradeId, trackId: t.trackId })) } }
          : {}),
      },
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
      },
    });

    this.logger.log(`Course created: [ID: ${course.id}, Title: "${course.title}"] by Teacher [${teacher.id}]`);

    // If created directly as PUBLISHED, announce it to the target stage
    if (course.status === CourseStatus.PUBLISHED) {
      this.notificationsService
        .notifyStudentsOfCourseStage(course.id, {
          type: 'COURSE_NEW',
          title: 'كورس جديد',
          body: `تم نشر كورس جديد "${course.title}". اكتشفه الآن!`,
          linkUrl: `/courses/${course.id}`,
        })
        .catch(() => undefined);
    }

    return course;
  }

  /**
   * استعراض الكورسات مع البحث والفلترة والـ Pagination
   * وإضافة وسوم الملكية والاشتراك (isOwner / isEnrolled) موحدة لكل الكروت
   */
  /** Courses the student is actually subscribed to (enrollment ACTIVE or PENDING). */
  async getStudentEnrolledCourses(studentUserId: string): Promise<{ id: string; title: string }[]> {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: studentUserId },
      select: { id: true },
    });
    if (!student) return [];
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        studentId: student.id,
        status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.PENDING] },
      },
      include: { course: { select: { id: true, title: true, isDeleted: true } } },
    });
    const seen = new Set<string>();
    const courses: { id: string; title: string }[] = [];
    for (const e of enrollments) {
      if (e.course && !e.course.isDeleted && !seen.has(e.courseId)) {
        seen.add(e.courseId);
        courses.push({ id: e.course.id, title: e.course.title });
      }
    }
    return courses;
  }

  async getCourses(query: CourseQueryDto, user?: AuthenticatedUser) {
    const {
      page = 1,
      limit = 10,
      search,
      gradeLevel,
      isFree,
      status,
      accessType,
      teacherId,
      mine,
      subject,
      minPrice,
      maxPrice,
      minRating,
      enrolledOnly,
      sort,
      educationSystemId,
      stageId,
      gradeId,
      trackId,
      subjectId,
    } = query;
    const skip = (page - 1) * limit;

    const whereClause: any = {
      isDeleted: false,
    };

    // ─── Taxonomy targeting filters (normalized) ──────────────────────
    // gradeId+trackId → CourseTarget rows; trackId alone matches courses
    // targeted at that track OR open to all tracks (trackId: null).
    // educationSystemId/stageId constrain the grade's position in the
    // hierarchy so invalid combinations can never match.
    const gradeScope: any = {};
    if (stageId) gradeScope.stageId = stageId;
    if (educationSystemId) gradeScope.stage = { educationSystemId };
    const hasGradeScope = Object.keys(gradeScope).length > 0;

    if (gradeId) {
      // Resolve the taxonomy grade once so legacy courses that only carry the
      // enum in gradeLevels[] (no CourseTarget rows) still match the filter.
      // Taxonomy codes don't always equal legacy enum values � e.g. "SEC_3"
      // (with SCIENCE/MATH/LITERARY tracks) maps to BOTH SEC_3_* enums.
      const gradeRow = await this.prisma.grade.findUnique({
        where: { id: gradeId },
        select: { code: true },
      });
      // NOTE: must carry the `targets` relation key when used standalone
      // inside an OR[] - a bare { some: ... } is invalid at this level.
      const targetMatch = {
        targets: {
          some: {
            gradeId,
            ...(hasGradeScope ? { grade: gradeScope } : {}),
            ...(trackId ? { OR: [{ trackId }, { trackId: null }] } : {}),
          },
        },
      };
      let legacyCodes: GradeLevel[] = [];
      if (gradeRow?.code) {
        if (Object.values(GradeLevel).includes(gradeRow.code as GradeLevel)) {
          legacyCodes = [gradeRow.code as GradeLevel];
        } else {
          const aliases: Record<string, string[]> = {
            SEC_3: ['SEC_3_LITERARY', 'SEC_3_SCIENTIFIC'],
            SG_SEC_3: ['SEC_3_LITERARY', 'SEC_3_SCIENTIFIC'],
          };
          legacyCodes = (aliases[gradeRow.code] ?? []) as GradeLevel[];
        }
      }
      const gradeOrFilters: any[] = [targetMatch];
      if (legacyCodes.length > 0) {
        gradeOrFilters.push({ gradeLevels: { hasSome: legacyCodes } });
      }
      // Use AND (not targets=) to avoid clashing with the mine/OR merge below
      whereClause.AND = [{ OR: gradeOrFilters }];
    } else if (trackId || hasGradeScope) {
      whereClause.targets = {
        some: {
          ...(trackId ? { OR: [{ trackId }, { trackId: null }] } : {}),
          ...(hasGradeScope ? { grade: gradeScope } : {}),
        },
      };
    }
    if (subjectId) {
      whereClause.subjectId = subjectId;
    }

    // إذا كان الزائر غير مسجل أو طالب، يُعرض له فقط الكورسات المنشورة PUBLISHED
    const isTeacherOrAdmin = user && (user.role === Role.TEACHER || user.role === Role.ADMIN);
    if (!isTeacherOrAdmin) {
      whereClause.status = CourseStatus.PUBLISHED;
    } else if (status) {
      whereClause.status = status;
    }

    if (gradeLevel) {
      whereClause.gradeLevels = { has: gradeLevel };
    }

    if (isFree !== undefined) {
      whereClause.isFree = isFree;
    }

    // فلتر نوع الوصول: LIFETIME (دروس للأبد) أو LIMITED (باقة بمؤقت)
    if (accessType) {
      whereClause.accessType = accessType;
    }

    if (teacherId) {
      whereClause.teacherId = teacherId;
    }

    // mine=true: المدرس يرى كورساته هو فقط — يُجبر الفلتر على هوية المدرس الحالي
    // ويتم تجاهل أي teacherId قادم من الطلب لمنع تسريب كورسات مدرسين آخرين
    if (mine && user?.role === Role.TEACHER) {
      const teacher = await this.prisma.teacherProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      const ownCoursesFilter = { teacherId: teacher?.id ?? '00000000-0000-0000-0000-000000000000' };
      if (whereClause.OR) {
        whereClause.AND = [ownCoursesFilter, { OR: whereClause.OR }];
        delete whereClause.OR;
      } else {
        whereClause.teacherId = ownCoursesFilter.teacherId;
      }
    }

    if (subject && subject.trim()) {
      whereClause.subject = { contains: subject.trim(), mode: 'insensitive' };
    }

    // enrolledOnly=true: الطالب يرى الكورسات المشترك بها فقط (اشتراك ACTIVE)
    // تُدمج مع باقي الفلاتر بـ AND (مثال: "مشترك بها" + "٥ نجوم")
    if (enrolledOnly) {
      if (user?.role === Role.STUDENT) {
        const student = await this.prisma.studentProfile.findUnique({
          where: { userId: user.id },
          select: { id: true },
        });
        whereClause.enrollments = {
          some: {
            studentId: student?.id ?? '00000000-0000-0000-0000-000000000000',
            status: EnrollmentStatus.ACTIVE,
          },
        };
      } else {
        // غير الطلاب لا يملكون اشتراكات — نتيجة فارغة بدلاً من تجاهل الفلتر
        whereClause.enrollments = {
          some: { studentId: '00000000-0000-0000-0000-000000000000' },
        };
      }
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      whereClause.price = {
        ...(minPrice !== undefined && { gte: minPrice }),
        ...(maxPrice !== undefined && { lte: maxPrice }),
      };
    }

    // Rating filter/sort: aggregate visible reviews per course in the DB
    const MIN_RATINGS_FOR_TOP = 3;
    let ratingOrderIds: string[] | null = null;
    if (minRating !== undefined || sort === 'rating') {
      const grouped = await this.prisma.courseReview.groupBy({
        by: ['courseId'],
        where: { isHidden: false },
        _avg: { rating: true },
        _count: { _all: true },
        ...(minRating !== undefined && { having: { rating: { _avg: { gte: minRating } } } as any }),
      });
      // "الأعلى تقييماً": الكورسات ذات سجل حقيقي (٣+ تقييمات) أولاً حسب المتوسط،
      // والكورسات الأقل من الحد تُدفع للنهاية حتى لا يتقدم تقييم واحد الكورس على غيره
      const byAvg = (a: any, b: any) => (b._avg.rating ?? 0) - (a._avg.rating ?? 0);
      const qualified = grouped.filter((g) => g._count._all >= MIN_RATINGS_FOR_TOP).sort(byAvg);
      const underThreshold = grouped
        .filter((g) => g._count._all < MIN_RATINGS_FOR_TOP)
        .sort(byAvg);
      ratingOrderIds = [...qualified, ...underThreshold].map((g) => g.courseId);

      if (minRating !== undefined) {
        // Courses with no reviews can never satisfy a minimum rating
        whereClause.id = { in: ratingOrderIds.length > 0 ? ratingOrderIds : ['00000000-0000-0000-0000-000000000000'] };
      }
    }

    if (search && search.trim()) {
      const term = search.trim();
      whereClause.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { teacher: { fullName: { contains: term, mode: 'insensitive' } } },
      ];
    }

    let orderBy: any = { createdAt: 'desc' };
    const useRatingSort = sort === 'rating';
    if (sort === 'price_asc') {
      orderBy = { price: 'asc' };
    } else if (sort === 'price_desc') {
      orderBy = { price: 'desc' };
    } else if (sort === 'popular') {
      orderBy = { enrollments: { _count: 'desc' } };
    }

    // Rating sort needs the aggregate order preserved — fetch page by id list
    let skipOverride = skip;
    let takeOverride = limit;
    if (useRatingSort && ratingOrderIds) {
      whereClause.id = { in: ratingOrderIds };
    }

    const [total, rawCourses] = await Promise.all([
      this.prisma.course.count({ where: whereClause }),
      this.prisma.course.findMany({
        where: whereClause,
        skip: skipOverride,
        take: takeOverride,
        orderBy,
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
          subjectRef: { select: { id: true, code: true, name: true } },
          targets: {
            include: {
              grade: { select: { id: true, code: true, name: true } },
              track: { select: { id: true, code: true, name: true } },
            },
          },
          reviews: { where: { isHidden: false }, select: { rating: true } },
          _count: {
            select: {
              lessons: { where: { isDeleted: false } },
              materials: { where: { deletedAt: null } },
              enrollments: { where: { status: EnrollmentStatus.ACTIVE } },
            },
          },
        },
      }),
    ]);

    // Preserve DB-computed rating order when sorting by rating
    if (useRatingSort && ratingOrderIds) {
      rawCourses.sort(
        (a, b) => ratingOrderIds!.indexOf(a.id) - ratingOrderIds!.indexOf(b.id),
      );
    }

    // إضافة وسمي isOwner و isEnrolled لجميع الكورسات المعروضة
    const courses = await attachCourseOwnershipAndEnrollment(this.prisma, rawCourses, user);

    return {
      courses: courses.map((c: any) => {
        const ratings = c.reviews?.map((r: any) => r.rating) ?? [];
        const avgRating =
          ratings.length > 0
            ? Math.round((ratings.reduce((s: number, v: number) => s + v, 0) / ratings.length) * 10) / 10
            : null;
        const { reviews, ...rest } = c;
        void reviews;
        return { ...rest, averageRating: avgRating, reviewCount: ratings.length };
      }),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * تفاصيل كورس معين وقائمة الدروس مع وسوم المعاينة المجانية
   */
  async getCourseById(courseId: string, user?: AuthenticatedUser) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: {
        teacher: {
          select: {
            id: true,
            userId: true,
            fullName: true,
            specialization: true,
            photoUrl: true,
            bio: true,
          },
        },
        lessons: {
          where: { isDeleted: false },
          orderBy: { orderIndex: 'asc' },
          select: {
            id: true,
            title: true,
            description: true,
            orderIndex: true,
            durationSeconds: true,
            isPreview: true,
            createdAt: true,
            quizzes: {
              where: { isDeleted: false },
              select: {
                id: true,
                title: true,
                passingPercentage: true,
                timeLimitMinutes: true,
                maxAttempts: true,
                isPublished: true,
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        materials: {
          where: { deletedAt: null },
          select: {
            id: true,
            title: true,
            description: true,
            fileType: true,
            fileSizeBytes: true,
            createdAt: true,
          },
        },
        // Normalized taxonomy targets (with grade → stage + track) so the
        // course detail page can render the full grade/stage/track targeting.
        targets: {
          include: {
            grade: { include: { stage: true } },
            track: true,
          },
        },
        _count: {
          select: {
            enrollments: { where: { status: EnrollmentStatus.ACTIVE } },
          },
        },
      },
    });

    if (!course || course.isDeleted) {
      throw new NotFoundException('Course not found.');
    }

    // التحقق من صلاحية الإدارة والملكية
    const isOwner = user ? await canManageCourse(this.prisma, user.id, courseId, user.role as Role) : false;
    const isAdmin = user && user.role === Role.ADMIN;

    if (course.status !== CourseStatus.PUBLISHED && !isOwner && !isAdmin) {
      throw new NotFoundException('Course is not available.');
    }

    // فحص هل الطالب الحالي مشترك في الكورس
    let enrollmentStatus: EnrollmentStatus | null = null;
    if (user && user.role === Role.STUDENT) {
      const student = await this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
      });
      if (student) {
        const enrollment = await this.prisma.enrollment.findFirst({
          where: {
            studentId: student.id,
            courseId: course.id,
          },
          orderBy: { enrolledAt: 'desc' },
        });
        enrollmentStatus = enrollment?.status || null;
      }
    }

    // الكويزات غير المنشورة تظهر لصاحب الكورس/الأدمن فقط
    const canSeeAllQuizzes = !!isOwner || !!isAdmin;
    const lessonsWithQuizzes = course.lessons.map((lesson) =>
      canSeeAllQuizzes
        ? lesson
        : { ...lesson, quizzes: lesson.quizzes.filter((q) => q.isPublished) },
    );

    return {
      ...course,
      lessons: lessonsWithQuizzes,
      isEnrolled: enrollmentStatus === EnrollmentStatus.ACTIVE,
      enrollmentStatus,
      isOwner: !!isOwner,
    };
  }

  /**
   * تعديل الكورس (مخصص للمدرس صاحب الكورس)
   */
  async updateCourse(courseId: string, dto: UpdateCourseDto) {
    const isFree = dto.isFree !== undefined ? dto.isFree : undefined;
    let price = dto.price;
    if (isFree === true) {
      price = 0;
    }
    const gradeLevels = dto.gradeLevels !== undefined ? this.cleanGradeLevels(dto.gradeLevels) : undefined;

    // Offer/discount — sparse semantics: only touched when the teacher sends it.
    // Sending discountPercent=0 (or null) clears the offer entirely.
    let discountUpdate: { discountPercent?: number | null; discountEndsAt?: Date | null } = {};
    if (dto.discountPercent !== undefined || dto.discountEndsAt !== undefined) {
      const nextPercent =
        dto.discountPercent !== undefined ? dto.discountPercent : null;
      if (!nextPercent || nextPercent <= 0) {
        discountUpdate = { discountPercent: null, discountEndsAt: null };
      } else {
        const normalized = this.normalizeDiscount(nextPercent, dto.discountEndsAt ?? null);
        // keep existing expiry when only the percentage is updated without one
        const existing = await this.prisma.course.findUnique({
          where: { id: courseId },
          select: { discountEndsAt: true },
        });
        discountUpdate = {
          discountPercent: normalized.discountPercent,
          discountEndsAt: normalized.discountEndsAt ?? existing?.discountEndsAt ?? null,
        };
      }
    }

    // Normalized subject — resolve + keep legacy label in sync
    let subjectUpdate: { subjectId?: string; subject?: string | null } = {};
    if (dto.subjectId !== undefined) {
      if (dto.subjectId === '') {
        subjectUpdate = { subjectId: null };
      } else {
        const subj = await this.prisma.subject.findUnique({ where: { id: dto.subjectId } });
        if (!subj || !subj.isActive) throw new NotFoundException('المادة الدراسية غير موجودة.');
        subjectUpdate = { subjectId: subj.id, subject: subj.name };
      }
    }

    const previousStatus = (
      await this.prisma.course.findUnique({
        where: { id: courseId },
        select: { status: true },
      })
    )?.status;

    // نوع الوصول — sparse semantics: LIMITED يفعّل المدة، LIFETIME يمسحها
    let accessUpdate: { accessType?: AccessType; durationMonths?: number | null } = {};
    if (dto.accessType !== undefined) {
      if (dto.accessType === AccessType.LIMITED) {
        accessUpdate = {
          accessType: AccessType.LIMITED,
          durationMonths:
            dto.durationMonths !== undefined ? dto.durationMonths : undefined,
        };
      } else {
        accessUpdate = { accessType: AccessType.LIFETIME, durationMonths: null };
      }
    } else if (dto.durationMonths !== undefined) {
      accessUpdate = { durationMonths: dto.durationMonths };
    }

    const updated = await this.prisma.course.update({
      where: { id: courseId },
      data: {
        title: dto.title !== undefined ? dto.title.trim() : undefined,
        description: dto.description !== undefined ? dto.description.trim() : undefined,
        learningOutcomes:
          dto.learningOutcomes !== undefined
            ? this.cleanLearningOutcomes(dto.learningOutcomes)
            : undefined,
        thumbnailUrl: dto.thumbnailUrl !== undefined ? dto.thumbnailUrl : undefined,
        price: price !== undefined ? price : undefined,
        isFree,
        discountPercent: discountUpdate.discountPercent,
        discountEndsAt: discountUpdate.discountEndsAt,
        // gradeLevel remains the primary/legacy value for older consumers.
        gradeLevel: gradeLevels ? gradeLevels[0] : dto.gradeLevel !== undefined ? dto.gradeLevel : undefined,
        gradeLevels,
        subject:
          dto.subject !== undefined ? dto.subject.trim() || null : subjectUpdate.subject,
        subjectId: subjectUpdate.subjectId,
        status: dto.status !== undefined ? dto.status : undefined,
        accessType: accessUpdate.accessType,
        durationMonths: accessUpdate.durationMonths,
      },
    });

    // Notify students of the target stage when a course goes live (publish transition only)
    if (updated.status === CourseStatus.PUBLISHED && previousStatus !== CourseStatus.PUBLISHED) {
      this.notificationsService
        .notifyStudentsOfCourseStage(courseId, {
          type: 'COURSE_NEW',
          title: 'كورس جديد',
          body: `تم نشر كورس جديد "${updated.title}". اكتشفه الآن!`,
          linkUrl: `/courses/${courseId}`,
        })
        .catch(() => undefined);
    }

    return updated;
  }

  /** Uploads a safe local/S3 cover image and replaces only the course image URL. */
  async uploadThumbnail(courseId: string, file?: Express.Multer.File) {
    if (!file?.buffer) {
      throw new BadRequestException('يرجى اختيار صورة غلاف لرفعها.');
    }

    const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowedMimeTypes.has(file.mimetype)) {
      throw new BadRequestException('صورة الغلاف يجب أن تكون JPG أو PNG أو WEBP.');
    }
    if (!this.hasValidImageSignature(file.buffer, file.mimetype)) {
      throw new BadRequestException('محتوى الملف لا يطابق نوع الصورة المختار. يرجى رفع صورة سليمة.');
    }

    const course = await this.prisma.course.findFirst({
      where: { id: courseId, isDeleted: false },
      select: { id: true },
    });
    if (!course) {
      throw new NotFoundException('الكورس غير موجود.');
    }

    const extensionByMime: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    };
    const fileName = `${crypto.randomUUID()}${extensionByMime[file.mimetype] || path.extname(file.originalname)}`;
    const thumbnailUrl = await this.storageService.uploadFile(
      { originalname: fileName, buffer: file.buffer, mimetype: file.mimetype },
      `courses/${courseId}/thumbnails`,
    );

    return this.prisma.course.update({
      where: { id: courseId },
      data: { thumbnailUrl },
    });
  }

  /**
   * حذف الكورس Soft Delete
   */
  async deleteCourse(courseId: string) {
    await this.prisma.$transaction(async (tx) => {
      // Soft delete the course
      await tx.course.update({
        where: { id: courseId },
        data: { isDeleted: true },
      });

      // Cascade soft delete to lessons and materials
      await tx.lesson.updateMany({
        where: { courseId, isDeleted: false },
        data: { isDeleted: true },
      });

      await tx.courseMaterial.updateMany({
        where: { courseId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    });

    return { message: 'Course deleted successfully.' };
  }

  /**
   * اشتراك الطالب المباشر في كورس مجاني
   */
  async enrollFreeCourse(courseId: string, studentUserId: string) {
    // 1. استرجاع الكورس والتحقق من وجوده ونشاطه
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: { teacher: true },
    });

    if (!course || course.isDeleted) {
      throw new NotFoundException('Course not found.');
    }

    if (course.teacher?.userId === studentUserId) {
      throw new BadRequestException('Teachers cannot enroll in their own courses.');
    }

    // شرط إلزامي 1: يجب أن يكون الكورس منشوراً
    if (course.status !== CourseStatus.PUBLISHED) {
      throw new BadRequestException('Cannot enroll in a course that is not published yet.');
    }

    // شرط إلزامي 2: يجب أن يكون الكورس مجانياً
    if (!course.isFree && Number(course.price) > 0) {
      throw new BadRequestException('This is a paid course. Please proceed through checkout to enroll.');
    }

    // 2. استرجاع بروفايل الطالب
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: studentUserId },
    });

    if (!student) {
      throw new ForbiddenException('Student profile not found.');
    }

    // 3. التحقق من عدم وجود اشتراك مسبق وإنشاء اشتراك ACTIVE
    try {
      const enrollment = await this.prisma.enrollment.create({
        data: {
          studentId: student.id,
          courseId: course.id,
          status: EnrollmentStatus.ACTIVE,
          activatedAt: new Date(),
        },
      });

      this.logger.log(`Student [${student.id}] enrolled in free course [${course.id}] successfully.`);

      return {
        message: 'Successfully enrolled in course.',
        enrollment,
      };
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('You are already enrolled in this course.');
      }
      throw error;
    }
  }

  private cleanLearningOutcomes(outcomes?: string[]): string[] {
    return (outcomes || []).map((outcome) => outcome.trim()).filter(Boolean);
  }

  /**
   * Normalize the course offer (coupon-style): clamps the percentage to 1–90
   * and parses the expiry. Zero/null clears the offer entirely.
   */
  private normalizeDiscount(
    percent?: number | null,
    endsAt?: string | Date | null,
  ): { discountPercent: number | null; discountEndsAt: Date | null } {
    const value = Number(percent);
    if (!value || value <= 0) {
      return { discountPercent: null, discountEndsAt: null };
    }
    const parsedEnds = endsAt ? new Date(endsAt) : null;
    return {
      discountPercent: Math.min(90, Math.max(1, Math.round(value))),
      discountEndsAt:
        parsedEnds && !isNaN(parsedEnds.getTime()) ? parsedEnds : null,
    };
  }

  /** Hourly sweep — clear expired offers so cards stop advertising them. */
  @Cron(CronExpression.EVERY_HOUR)
  async expireCourseDiscounts() {
    const res = await this.prisma.course.updateMany({
      where: { discountPercent: { not: null }, discountEndsAt: { lt: new Date() } },
      data: { discountPercent: null, discountEndsAt: null },
    });
    if (res.count > 0) {
      this.logger.log(`Cleared ${res.count} expired course offers.`);
    }
  }

  /**
   * باقة الكورس (accessType = LIMITED): عند انتهاء المدة (activatedAt +
   * durationMonths) يتحول اشتراك الطالب إلى EXPIRED — يفقد الوصول للمحتوى
   * لكن يظل الكورس ظاهراً لديه في قائمة كورساته.
   */
  /** Hourly sweep — انتهاء اشتراكات الباقات (LIMITED) التي انتهت مدتها. */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepExpiredTimedEnrollments(): Promise<number> {
    const candidates = await this.prisma.enrollment.findMany({
      where: {
        status: EnrollmentStatus.ACTIVE,
        course: {
          accessType: AccessType.LIMITED,
          durationMonths: { not: null },
          isDeleted: false,
        },
      },
      select: {
        id: true,
        activatedAt: true,
        course: { select: { durationMonths: true } },
      },
    });

    const now = Date.now();
    const monthMs = 30 * 24 * 60 * 60 * 1000;
    const expiredIds = candidates
      .filter((e) => {
        const months = e.course.durationMonths ?? 0;
        return e.activatedAt && months > 0 && e.activatedAt.getTime() + months * monthMs <= now;
      })
      .map((e) => e.id);

    if (expiredIds.length === 0) return 0;

    await this.prisma.enrollment.updateMany({
      where: { id: { in: expiredIds } },
      data: { status: EnrollmentStatus.EXPIRED },
    });
    this.logger.log(`Expired ${expiredIds.length} timed-course enrollments.`);
    return expiredIds.length;
  }

  private cleanGradeLevels(gradeLevels?: GradeLevel[]): GradeLevel[] {
    return [...new Set((gradeLevels || []).filter(Boolean))] as GradeLevel[];
  }

  private hasValidImageSignature(buffer: Buffer, mimeType: string): boolean {
    if (mimeType === 'image/jpeg') {
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    if (mimeType === 'image/png') {
      return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (mimeType === 'image/webp') {
      return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    }
    return false;
  }

  /**
   * GET /courses/:id/curriculum
   * يرجع الكورس كاملًا بشكل هرمي: كل section وجواه lessons + materials بترتيبهم
   * استعلام واحد فقط (لا N+1 queries)
   */
  async getCurriculum(courseId: string, user?: AuthenticatedUser) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: { teacher: true },
    });

    if (!course || course.isDeleted) {
      throw new NotFoundException('Course not found.');
    }

    const isTeacherOwner =
      user && user.role === Role.TEACHER && course.teacher?.userId === user.id;
    const isAdmin = user && user.role === Role.ADMIN;
    const hasManageAccess = isTeacherOwner || isAdmin;

    if (course.status !== CourseStatus.PUBLISHED && !hasManageAccess) {
      throw new NotFoundException('Course not found.');
    }

    // تحقق من الاشتراك (لإظهار videoUrl فقط للمشتركين)
    let isEnrolled = false;
    if (user && user.role === Role.STUDENT) {
      const student = await this.prisma.studentProfile.findUnique({ where: { userId: user.id } });
      if (student) {
        const enrollment = await this.prisma.enrollment.findFirst({
          where: { studentId: student.id, courseId, status: EnrollmentStatus.ACTIVE },
        });
        isEnrolled = !!enrollment;
      }
    }

    const canSeeVideo = hasManageAccess || isEnrolled;

    // استعلام واحد لجلب كل السكاشن مع الدروس والمواد
    const sections = await this.prisma.section.findMany({
      where: { courseId },
      orderBy: { order: 'asc' },
      include: {
        lessons: {
          where: { isDeleted: false },
          orderBy: { orderIndex: 'asc' },
          select: {
            id: true,
            title: true,
            description: true,
            orderIndex: true,
            durationSeconds: true,
            isPreview: true,
            // videoUrl يُظهر فقط لو المستخدم مشترك أو مدرس/أدمن أو الدرس preview
            videoUrl: canSeeVideo,
            createdAt: true,
            quizzes: {
              where: {
                isDeleted: false,
                ...(hasManageAccess ? {} : { isPublished: true }),
              },
              select: {
                id: true,
                title: true,
                passingPercentage: true,
                timeLimitMinutes: true,
                maxAttempts: true,
                isPublished: true,
                _count: { select: { questions: { where: { isDeleted: false } } } },
              },
              orderBy: { createdAt: 'asc' },
            },
            homeworks: {
              where: {
                isDeleted: false,
                ...(hasManageAccess ? {} : { isPublished: true }),
              },
              select: {
                id: true,
                title: true,
                isPublished: true,
                pdfUrl: hasManageAccess,
                _count: { select: { questions: { where: { isDeleted: false } } } },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        materials: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            title: true,
            description: true,
            fileType: true,
            fileSizeBytes: true,
            createdAt: true,
          },
        },
      },
    });

    // المدة الحقيقية لكل درس كما قِست أثناء التشغيل (أدق من القيمة المدخلة يدوياً)
    // نأخذ القيمة القصوى لأن كل الطلبة يقيسون نفس الفيديو
    const measuredDurations = await this.prisma.progress.groupBy({
      by: ['lessonId'],
      where: {
        lesson: { courseId, isDeleted: false },
        videoDurationSeconds: { not: null },
      },
      _max: { videoDurationSeconds: true },
    });
    const measuredMap = new Map(
      measuredDurations.map((m) => [m.lessonId, m._max.videoDurationSeconds as number]),
    );

    // للدروس التي isPreview=true، أظهر videoUrl دائماً (حتى لغير المشتركين)
    const processedSections = sections.map((section) => ({
      ...section,
      lessons: section.lessons.map((lesson) => {
        const { quizzes, homeworks, ...rest } = lesson;
        return {
          ...rest,
          videoUrl: canSeeVideo || lesson.isPreview ? lesson.videoUrl : undefined,
          // Prefer the real measured duration so totals update automatically
          durationSeconds: measuredMap.get(lesson.id) ?? lesson.durationSeconds,
          quizzes: (quizzes ?? []).map(({ _count, ...q }) => ({
            ...q,
            questionCount: _count.questions,
          })),
          homeworks: (homeworks ?? []).map(({ _count, ...h }) => ({
            ...h,
            questionCount: _count.questions,
          })),
        };
      }),
    }));

    const allLessons = processedSections.flatMap((s) => s.lessons);

    return {
      courseId,
      totalSections: sections.length,
      totalLessons: allLessons.length,
      totalMaterials: sections.reduce((acc, s) => acc + s.materials.length, 0),
      totalQuizzes: allLessons.reduce((acc, l) => acc + (l.quizzes?.length ?? 0), 0),
      totalHomeworks: allLessons.reduce((acc, l) => acc + (l.homeworks?.length ?? 0), 0),
      totalDurationSeconds: allLessons.reduce(
        (acc, l) => acc + (Number(l.durationSeconds) || 0),
        0,
      ),
      sections: processedSections,
    };
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * TEACHER: Manage Students in Course (List, Status Update, Remove)
   * ─────────────────────────────────────────────────────────────
   */
  async getCourseStudents(
    courseId: string,
    user: AuthenticatedUser,
    query: { search?: string; status?: string; page?: number; limit?: number },
  ) {
    const isOwner = await canManageCourse(this.prisma, user.id, courseId, user.role as Role);
    if (!isOwner) {
      throw new ForbiddenException('Access denied. You do not own this course.');
    }

    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: {
        lessons: { where: { isDeleted: false }, select: { id: true } },
        exams: { where: { isDeleted: false, isPublished: true }, select: { id: true } },
      },
    });
    if (!course || course.isDeleted) throw new NotFoundException('Course not found.');

    const lessonIds = course.lessons.map((l) => l.id);

    const [quizzes, homeworks] = await Promise.all([
      lessonIds.length > 0
        ? this.prisma.quiz.findMany({
            where: { lessonId: { in: lessonIds }, isDeleted: false, isPublished: true },
            select: { id: true },
          })
        : [],
      lessonIds.length > 0
        ? this.prisma.homework.findMany({
            where: { lessonId: { in: lessonIds }, isDeleted: false, isPublished: true },
            select: { id: true },
          })
        : [],
    ]);

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 20, 100);

    const whereClause: any = { courseId };
    if (query.status) {
      whereClause.status = query.status as EnrollmentStatus;
    }
    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      whereClause.student = {
        OR: [
          { fullName: { contains: term, mode: 'insensitive' } },
          { guardianPhone: { contains: term } },
          { user: { phone: { contains: term } } },
          { user: { email: { contains: term, mode: 'insensitive' } } },
        ],
      };
    }

    const [enrollments, total] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: whereClause,
        include: {
          student: {
            include: {
              user: { select: { email: true, phone: true, isActive: true } },
            },
          },
        },
        orderBy: { enrolledAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.enrollment.count({ where: whereClause }),
    ]);

    const totalLessons = course.lessons.length;
    const totalQuizzes = quizzes.length;
    const totalExams = course.exams.length;
    const totalHomeworks = homeworks.length;

    // Enhance students with progress stats
    const studentIds = enrollments.map((e) => e.studentId);
    const quizIds = quizzes.map((q) => q.id);
    const examIds = course.exams.map((e) => e.id);
    const homeworkIds = homeworks.map((h) => h.id);

    const [progressList, quizAttempts, examAttempts, homeworkAttempts] = await Promise.all([
      this.prisma.progress.findMany({
        where: {
          studentId: { in: studentIds },
          lesson: { courseId, isDeleted: false },
        },
        select: { studentId: true, isCompleted: true, watchedPercentage: true },
      }),
      quizIds.length > 0
        ? this.prisma.quizAttempt.findMany({
            where: {
              studentId: { in: studentIds },
              quizId: { in: quizIds },
              status: QuizAttemptStatus.SUBMITTED,
            },
            select: { studentId: true, isPassed: true, score: true },
          })
        : [],
      examIds.length > 0
        ? this.prisma.examAttempt.findMany({
            where: {
              studentId: { in: studentIds },
              examId: { in: examIds },
              status: ExamAttemptStatus.SUBMITTED,
            },
            select: { studentId: true, isPassed: true, score: true },
          })
        : [],
      homeworkIds.length > 0
        ? this.prisma.homeworkAttempt.findMany({
            where: {
              studentId: { in: studentIds },
              homeworkId: { in: homeworkIds },
              status: QuizAttemptStatus.SUBMITTED,
            },
            select: { studentId: true, isPassed: true, score: true },
          })
        : [],
    ]);

    const students = enrollments.map((e) => {
      const studentProgress = progressList.filter((p) => p.studentId === e.studentId);
      const watchedCount = studentProgress.filter((p) => p.isCompleted || (p.watchedPercentage ?? 0) >= 80).length;
      const watchedPercentage = totalLessons > 0 ? Math.round((watchedCount / totalLessons) * 100) : 0;

      const sQuizAttempts = quizAttempts.filter((q) => q.studentId === e.studentId);
      const passedQuizzes = sQuizAttempts.filter((q) => q.isPassed).length;
      const quizAverage =
        sQuizAttempts.length > 0
          ? Math.round(sQuizAttempts.reduce((acc, q) => acc + (q.score ?? 0), 0) / sQuizAttempts.length)
          : null;

      const sExamAttempts = examAttempts.filter((ex) => ex.studentId === e.studentId);
      const passedExams = sExamAttempts.filter((ex) => ex.isPassed).length;
      const examAverage =
        sExamAttempts.length > 0
          ? Math.round(sExamAttempts.reduce((acc, ex) => acc + (ex.score ?? 0), 0) / sExamAttempts.length)
          : null;

      const sHwAttempts = homeworkAttempts.filter((h) => h.studentId === e.studentId);
      const submittedHomeworks = sHwAttempts.length;

      return {
        enrollmentId: e.id,
        studentId: e.student.id,
        userId: e.student.userId,
        fullName: e.student.fullName,
        guardianPhone: e.student.guardianPhone,
        phone: e.student.user.phone,
        email: e.student.user.email,
        photoUrl: e.student.photoUrl,
        gradeLevel: e.student.gradeLevel,
        status: e.status,
        enrolledAt: e.enrolledAt,
        activatedAt: e.activatedAt,
        stats: {
          watchedLessons: watchedCount,
          totalLessons,
          watchedPercentage,
          passedQuizzes,
          totalQuizzes,
          quizAverage,
          passedExams,
          totalExams,
          examAverage,
          submittedHomeworks,
          totalHomeworks,
        },
      };
    });

    return {
      students,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async updateCourseStudentStatus(
    courseId: string,
    studentId: string,
    status: EnrollmentStatus,
    user: AuthenticatedUser,
  ) {
    const isOwner = await canManageCourse(this.prisma, user.id, courseId, user.role as Role);
    if (!isOwner) {
      throw new ForbiddenException('Access denied. You do not own this course.');
    }

    const enrollment = await this.prisma.enrollment.findFirst({
      where: { courseId, studentId },
      include: {
        student: { select: { userId: true, fullName: true } },
        course: { select: { title: true } },
      },
    });
    if (!enrollment) {
      throw new NotFoundException('Enrollment record not found for this student in this course.');
    }

    const updated = await this.prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        status,
        activatedAt: status === EnrollmentStatus.ACTIVE ? new Date() : enrollment.activatedAt,
      },
    });

    // Notify student on status change
    if (status === EnrollmentStatus.ACTIVE) {
      await this.notificationsService.notify({
        userId: enrollment.student.userId,
        type: 'PAYMENT_APPROVED',
        title: '🎉 تم تفعيل اشتراكك في الكورس',
        body: `تم تفعيل اشتراكك في كورس "${enrollment.course.title}". يمكنك الآن متابعة جميع الدروس والاختبارات!`,
        linkUrl: `/courses/${courseId}/learn`,
      }).catch(() => undefined);
    } else if (status === EnrollmentStatus.CANCELLED || status === EnrollmentStatus.REJECTED) {
      await this.notificationsService.notify({
        userId: enrollment.student.userId,
        type: 'PAYMENT_REJECTED',
        title: '⚠️ تم تعليق اشتراكك في الكورس',
        body: `تم تعليق وصولك إلى كورس "${enrollment.course.title}". يرجى مراجعة المعلم للتفاصيل.`,
        linkUrl: `/my-courses`,
      }).catch(() => undefined);
    }

    return {
      message: `تم تحديث حالة اشتراك الطالب ${enrollment.student.fullName} إلى ${status}.`,
      enrollment: updated,
    };
  }

  async removeCourseStudent(courseId: string, studentId: string, user: AuthenticatedUser) {
    const isOwner = await canManageCourse(this.prisma, user.id, courseId, user.role as Role);
    if (!isOwner) {
      throw new ForbiddenException('Access denied. You do not own this course.');
    }

    const enrollment = await this.prisma.enrollment.findFirst({
      where: { courseId, studentId },
      include: {
        student: { select: { userId: true, fullName: true } },
        course: { select: { title: true } },
      },
    });
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found for this student.');
    }

    // Safely update to CANCELLED to preserve payment integrity and audit logs
    await this.prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { status: EnrollmentStatus.CANCELLED },
    });

    await this.notificationsService.notify({
      userId: enrollment.student.userId,
      type: 'PAYMENT_REJECTED',
      title: 'تم إلغاء تسجيلك في الكورس',
      body: `تم إلغاء تسجيلك في كورس "${enrollment.course.title}".`,
      linkUrl: `/courses`,
    }).catch(() => undefined);

    return {
      message: `تم حذف اشتراك الطالب ${enrollment.student.fullName} من الكورس بنجاح.`,
    };
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * Universal Smart Search — searches Courses, Lessons/Videos, Quizzes, Exams, Homeworks, Summaries
   * ─────────────────────────────────────────────────────────────
   */
  async globalSearch(q: string, user?: AuthenticatedUser) {
    const term = q.trim();
    if (!term || term.length < 2) {
      return { courses: [], lessons: [], quizzes: [], exams: [], homeworks: [], summaries: [], students: [] };
    }

    const [coursesRaw, lessonsRaw, quizzesRaw, examsRaw, homeworksRaw, summariesRaw] = await Promise.all([
      // Courses
      this.prisma.course.findMany({
        where: {
          isDeleted: false,
          status: CourseStatus.PUBLISHED,
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
            { subject: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: 6,
        select: {
          id: true,
          title: true,
          subject: true,
          thumbnailUrl: true,
          isFree: true,
          teacher: { select: { fullName: true } },
        },
      }),

      // Lessons & Videos
      this.prisma.lesson.findMany({
        where: {
          isDeleted: false,
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
          ],
          course: { isDeleted: false, status: CourseStatus.PUBLISHED },
        },
        take: 6,
        select: {
          id: true,
          title: true,
          description: true,
          orderIndex: true,
          durationSeconds: true,
          course: { select: { id: true, title: true } },
        },
      }),

      // Quizzes (and quiz questions)
      this.prisma.quiz.findMany({
        where: {
          isDeleted: false,
          isPublished: true,
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { questions: { some: { isDeleted: false, text: { contains: term, mode: 'insensitive' } } } },
          ],
          lesson: { course: { isDeleted: false, status: CourseStatus.PUBLISHED } },
        },
        take: 5,
        select: {
          id: true,
          title: true,
          lessonId: true,
          lesson: { select: { id: true, title: true, courseId: true, course: { select: { id: true, title: true } } } },
        },
      }),

      // Exams (and questions)
      this.prisma.exam.findMany({
        where: {
          isDeleted: false,
          isPublished: true,
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
            { questions: { some: { isDeleted: false, text: { contains: term, mode: 'insensitive' } } } },
          ],
          course: { isDeleted: false, status: CourseStatus.PUBLISHED },
        },
        take: 5,
        select: {
          id: true,
          title: true,
          courseId: true,
          course: { select: { id: true, title: true } },
        },
      }),

      // Homeworks & Materials
      this.prisma.homework.findMany({
        where: {
          isDeleted: false,
          isPublished: true,
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
          ],
          lesson: { course: { isDeleted: false, status: CourseStatus.PUBLISHED } },
        },
        take: 4,
        select: {
          id: true,
          title: true,
          lessonId: true,
          lesson: { select: { id: true, title: true, courseId: true, course: { select: { id: true, title: true } } } },
        },
      }),

      // Approved Summaries
      this.prisma.summary.findMany({
        where: {
          status: SummaryStatus.APPROVED,
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: 4,
        select: {
          id: true,
          title: true,
          courseId: true,
          student: { select: { fullName: true } },
          course: { select: { id: true, title: true } },
        },
      }),
    ]);

    // Student identities are visible only to staff
    let studentsRaw: any[] = [];
    const isStaff = user?.role === Role.TEACHER || user?.role === Role.ADMIN;
    if (isStaff) {
      studentsRaw = await this.prisma.studentProfile.findMany({
        where: {
          OR: [
            { fullName: { contains: term, mode: 'insensitive' } },
            { guardianPhone: { contains: term } },
            { user: { phone: { contains: term } } },
          ],
        },
        take: 4,
        select: {
          id: true,
          fullName: true,
          gradeLevel: true,
          photoUrl: true,
        },
      });
    }

    return {
      courses: coursesRaw.map((c) => ({
        id: c.id,
        title: c.title,
        subject: c.subject,
        thumbnailUrl: c.thumbnailUrl,
        isFree: c.isFree,
        teacherName: c.teacher?.fullName ?? null,
        url: `/courses/${c.id}`,
        type: 'course' as const,
      })),
      lessons: lessonsRaw.map((l) => ({
        id: l.id,
        title: l.title,
        courseTitle: l.course.title,
        courseId: l.course.id,
        url: `/courses/${l.course.id}/learn?lesson=${l.id}`,
        type: 'lesson' as const,
      })),
      quizzes: quizzesRaw.map((q) => ({
        id: q.id,
        title: q.title,
        lessonTitle: q.lesson.title,
        courseTitle: q.lesson.course.title,
        courseId: q.lesson.course.id,
        url: `/courses/${q.lesson.course.id}/learn?lesson=${q.lessonId}`,
        type: 'quiz' as const,
      })),
      exams: examsRaw.map((e) => ({
        id: e.id,
        title: e.title,
        courseTitle: e.course.title,
        courseId: e.course.id,
        url: `/courses/${e.course.id}/exams/${e.id}`,
        type: 'exam' as const,
      })),
      homeworks: homeworksRaw.map((h) => ({
        id: h.id,
        title: h.title,
        lessonTitle: h.lesson.title,
        courseTitle: h.lesson.course.title,
        courseId: h.lesson.course.id,
        url: `/courses/${h.lesson.course.id}/learn?lesson=${h.lessonId}`,
        type: 'homework' as const,
      })),
      summaries: summariesRaw.map((s) => ({
        id: s.id,
        title: s.title,
        courseTitle: s.course.title,
        studentName: s.student.fullName,
        url: `/courses/${s.courseId}/summaries/${s.id}`,
        type: 'summary' as const,
      })),
      students: studentsRaw.map((student) => ({
        id: student.id,
        fullName: student.fullName,
        gradeLevel: student.gradeLevel,
        photoUrl: student.photoUrl,
        url: `/students/${student.id}`,
        type: 'student' as const,
      })),
    };
  }
}
