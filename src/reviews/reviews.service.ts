import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CourseStatus, EnrollmentStatus, Role } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

interface AuthUser {
  id: string;
  role: Role;
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async getStudent(userId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');
    return student;
  }

  async upsertReview(courseId: string, userId: string, dto: { rating: number; comment?: string }) {
    const student = await this.getStudent(userId);

    const course = await this.prisma.course.findFirst({
      where: { id: courseId, isDeleted: false, status: CourseStatus.PUBLISHED },
      select: { id: true, title: true, teacher: { select: { userId: true } } },
    });
    if (!course) throw new NotFoundException('Course not found.');

    // Only students with an active enrollment can review
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId: student.id,
        courseId,
        status: EnrollmentStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (!enrollment) {
      throw new ForbiddenException(
        'You must have an active enrollment in this course to review it.',
      );
    }

    const review = await this.prisma.courseReview.upsert({
      where: { studentId_courseId: { studentId: student.id, courseId } },
      create: {
        studentId: student.id,
        courseId,
        rating: dto.rating,
        comment: dto.comment?.trim() || null,
      },
      update: {
        rating: dto.rating,
        comment: dto.comment?.trim() || null,
      },
    });

    const isNewReview = review.createdAt.getTime() === review.updatedAt.getTime();

    // إشعار المدرس صاحب الكورس بتقييم جديد من طالب
    if (isNewReview && course.teacher?.userId) {
      try {
        await this.notificationsService.notify({
          userId: course.teacher.userId,
          type: 'COURSE_REVIEWED',
          title: 'تقييم جديد لكورسك',
          body: `قام الطالب "${student.fullName}" بتقييم كورس "${course.title}" بـ ${dto.rating} من 5 نجوم.`,
          linkUrl: `/courses/${courseId}`,
        });
      } catch {
        /* non-blocking */
      }
    }

    return { message: 'Review saved successfully.', review };
  }

  async deleteOwnReview(courseId: string, userId: string) {
    const student = await this.getStudent(userId);
    const review = await this.prisma.courseReview.findUnique({
      where: { studentId_courseId: { studentId: student.id, courseId } },
    });
    if (!review) throw new NotFoundException('Review not found.');

    await this.prisma.courseReview.delete({ where: { id: review.id } });
    return { message: 'Review deleted successfully.' };
  }

  /** Public visible reviews for a course with the aggregate rating. */
  async getCourseReviews(courseId: string, query: { page?: number; limit?: number }) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 10, 50);

    const where = { courseId, isHidden: false };

    const [reviews, total, agg] = await Promise.all([
      this.prisma.courseReview.findMany({
        where,
        include: { student: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.courseReview.count({ where }),
      this.prisma.courseReview.aggregate({
        where,
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);

    return {
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        studentName: r.student.fullName,
        createdAt: r.createdAt,
      })),
      averageRating: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : null,
      totalReviews: agg._count._all,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async getMyReviews(userId: string) {
    const student = await this.getStudent(userId);
    const reviews = await this.prisma.courseReview.findMany({
      where: { studentId: student.id },
      include: { course: { select: { id: true, title: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      reviews: reviews.map((r) => ({
        id: r.id,
        courseId: r.course.id,
        courseTitle: r.course.title,
        rating: r.rating,
        comment: r.comment,
        isHidden: r.isHidden,
        createdAt: r.createdAt,
      })),
    };
  }

  /**
   * Testimonials منشورة (§12.8): تقييمات حقيقية من طلاب مشتركين فعلاً فقط،
   * عينة محدودة بأعلى التقييمات مع تنويع بين الكورسات (كورس واحد كحد أقصى لكل تقييم ظاهر).
   */
  async getTestimonials(limit = 6) {
    const safeLimit = Math.min(Math.max(limit, 1), 12);

    const pool = await this.prisma.courseReview.findMany({
      where: {
        isHidden: false,
        comment: { not: null },
        course: { isDeleted: false, status: CourseStatus.PUBLISHED },
      },
      include: {
        student: { select: { fullName: true, gradeLevel: true, photoUrl: true } },
        course: { select: { id: true, title: true } },
      },
      orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });

    // التحقق من الاشتراك النشط لكل مرشح (تقييمات طلاب مشتركين فعلاً فقط)
    const activeEnrollments = await this.prisma.enrollment.findMany({
      where: {
        status: EnrollmentStatus.ACTIVE,
        studentId: { in: [...new Set(pool.map((r) => r.studentId))] },
        courseId: { in: [...new Set(pool.map((r) => r.courseId))] },
      },
      select: { studentId: true, courseId: true },
    });
    const enrolledKeys = new Set(activeEnrollments.map((e) => `${e.studentId}:${e.courseId}`));
    const verifiedPool = pool.filter((r) => enrolledKeys.has(`${r.studentId}:${r.courseId}`));

    // تنويع: لا تكرار لنفس الكورس في العينة النهائية قبل إعادة الملء
    const byCourse = new Map<string, typeof verifiedPool>();
    for (const review of verifiedPool) {
      const list = byCourse.get(review.course.id) ?? [];
      list.push(review);
      byCourse.set(review.course.id, list);
    }

    const picked: typeof verifiedPool = [];
    let added = true;
    while (picked.length < safeLimit && added) {
      added = false;
      for (const list of byCourse.values()) {
        if (picked.length >= safeLimit) break;
        const next = list.shift();
        if (next) {
          picked.push(next);
          added = true;
        }
      }
    }

    return {
      testimonials: picked.map((r) => ({
        id: r.id,
        studentName: r.student.fullName,
        gradeLevel: r.student.gradeLevel,
        photoUrl: r.student.photoUrl,
        rating: r.rating,
        comment: r.comment,
        courseId: r.course.id,
        courseTitle: r.course.title,
        createdAt: r.createdAt,
      })),
    };
  }

  /** Teacher/admin moderation: hide or restore a review on their own course. */  async moderate(reviewId: string, hide: boolean, user: AuthUser) {
    const review = await this.prisma.courseReview.findUnique({
      where: { id: reviewId },
      include: { course: { select: { teacherId: true } } },
    });
    if (!review) throw new NotFoundException('Review not found.');

    if (user.role !== Role.ADMIN) {
      const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id } });
      if (!teacher || review.course.teacherId !== teacher.id) {
        throw new ForbiddenException('You can only moderate reviews on your own courses.');
      }
    }

    const updated = await this.prisma.courseReview.update({
      where: { id: reviewId },
      data: { isHidden: hide },
    });
    return {
      message: hide ? 'Review hidden.' : 'Review restored.',
      review: updated,
    };
  }
}
