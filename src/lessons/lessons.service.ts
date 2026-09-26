import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { CourseStatus, EnrollmentStatus, Role } from '@prisma/client';
import * as crypto from 'crypto';
import * as path from 'path';
import { PrismaService } from '../shared/prisma/prisma.service';
import { StorageService } from '../shared/storage/storage.service';
import { CreateLessonDto } from './dtos/create-lesson.dto';
import { UpdateLessonDto } from './dtos/update-lesson.dto';
import { ReorderLessonsDto } from './dtos/reorder-lessons.dto';
import { ConfirmVideoDto } from './dtos/confirm-video.dto';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { canManageCourse } from '../common/utils/course-access.util';
import { NotificationsService } from '../notifications/notifications.service';
import { LessonAccessService } from './lesson-access.service';

@Injectable()
export class LessonsService {
  private readonly logger = new Logger(LessonsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly notificationsService: NotificationsService,
    private readonly lessonAccessService: LessonAccessService,
  ) {}

  /**
   * جلب جميع حصص الكورس
   */
  async getCourseLessons(courseId: string, user?: AuthenticatedUser) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: { teacher: true },
    });

    if (!course || course.isDeleted) {
      throw new NotFoundException('Course not found.');
    }

    const isTeacherOwner = user && user.role === Role.TEACHER && course.teacher?.userId === user.id;
    const isAdmin = user && user.role === Role.ADMIN;
    const hasManageAccess = isTeacherOwner || isAdmin || (user ? await canManageCourse(this.prisma, user.id, courseId, user.role as Role) : false);

    // إذا كان الكورس غير منشور، يُسمح فقط للمدرس المالك أو الأدمن برؤية الحصص
    if (course.status !== CourseStatus.PUBLISHED && !hasManageAccess) {
      throw new NotFoundException('Course not found.');
    }

    return this.prisma.lesson.findMany({
      where: { courseId, isDeleted: false },
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true,
        title: true,
        description: true,
        orderIndex: true,
        durationSeconds: true,
        videoUrl: true,
        isPreview: true,
        createdAt: true,
      },
    });
  }

  /**
   * إضافة درس جديد للكورس بترتيب تلقائي
   */
  async createLesson(courseId: string, userId: string, dto: CreateLessonDto) {
    const course = await this.verifyCourseOwnership(courseId, userId);

    let orderIndex = dto.orderIndex;
    if (!orderIndex) {
      const highestLesson = await this.prisma.lesson.findFirst({
        where: { courseId: course.id, isDeleted: false },
        orderBy: { orderIndex: 'desc' },
      });
      orderIndex = highestLesson ? highestLesson.orderIndex + 1 : 1;
    }

    // تفادي تصادم الـ Unique Constraint @@unique([courseId, orderIndex])
    // بإزاحة الدروس على مرحلتين داخل Transaction (نفس أسلوب reorderLessons)
    const ORDER_OFFSET = 1_000_000;
    await this.prisma.$transaction(async (tx) => {
      // المرحلة الأولى: دفع كل الدروس من هذا الترتيب وما بعده بعيداً (يشمل المحذوفة ناعمياً لأنها تحجز نفس الفهرس)
      await tx.lesson.updateMany({
        where: { courseId: course.id, orderIndex: { gte: orderIndex } },
        data: { orderIndex: { increment: ORDER_OFFSET } },
      });
      // المرحلة الثانية: إرجاعها لمواضعها النهائية (+1) بدون أي تصادم
      await tx.lesson.updateMany({
        where: { courseId: course.id, orderIndex: { gte: ORDER_OFFSET + orderIndex } },
        data: { orderIndex: { decrement: ORDER_OFFSET - 1 } },
      });
    });

    let sectionId = dto.sectionId;
    if (sectionId) {
      const section = await this.prisma.section.findFirst({
        where: { id: sectionId, courseId: course.id },
      });
      if (!section) {
        throw new NotFoundException('Section not found or does not belong to this course.');
      }
    } else {
      // Find first section or create a default one
      let defaultSection = await this.prisma.section.findFirst({
        where: { courseId: course.id },
        orderBy: { order: 'asc' },
      });
      if (!defaultSection) {
        defaultSection = await this.prisma.section.create({
          data: {
            courseId: course.id,
            title: 'المحتوى العام',
            order: 0,
          },
        });
      }
      sectionId = defaultSection.id;
    }

    const lesson = await this.prisma.lesson.create({
      data: {
        courseId: course.id,
        sectionId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        videoUrl: dto.videoUrl || '',
        durationSeconds: dto.durationSeconds || 0,
        isPreview: dto.isPreview || false,
        orderIndex,
      },
    });

    this.logger.log(`Lesson created: [ID: ${lesson.id}, Section: ${sectionId}, Order: ${lesson.orderIndex}] in Course [${course.id}]`);

    // إشعار جميع الطلاب المشتركين في الكورس بوجود درس جديد
    this.notificationsService
      .notifyEnrolledStudents(course.id, {
        type: 'LESSON_NEW',
        title: 'درس جديد',
        body: `تم إضافة درس جديد "${lesson.title}" إلى كورس "${course.title}".`,
        linkUrl: `/courses/${course.id}/learn?lesson=${lesson.id}`,
      })
      .catch(() => undefined);

    return lesson;
  }

  /**
   * تعديل درس
   */
  async updateLesson(lessonId: string, userId: string, dto: UpdateLessonDto) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { course: { include: { teacher: true } } },
    });

    if (!lesson || lesson.isDeleted) {
      throw new NotFoundException('Lesson not found.');
    }

    if (lesson.course?.teacher?.userId !== userId) {
      const hasAccess = await canManageCourse(this.prisma, userId, lesson.courseId);
      if (!hasAccess) {
        throw new ForbiddenException('You do not have permission to modify this content.');
      }
    }

    if (dto.sectionId) {
      const section = await this.prisma.section.findFirst({
        where: { id: dto.sectionId, courseId: lesson.courseId },
      });
      if (!section) {
        throw new NotFoundException('Section not found or does not belong to this course.');
      }
    }

    // تفادي تصادم الـ Unique Constraint عند تغيير ترتيب الدرس
    const ORDER_OFFSET = 1_000_000;
    if (dto.orderIndex !== undefined && dto.orderIndex !== lesson.orderIndex) {
      await this.prisma.$transaction(async (tx) => {
        await tx.lesson.updateMany({
          where: { courseId: lesson.courseId, orderIndex: { gte: dto.orderIndex! } },
          data: { orderIndex: { increment: ORDER_OFFSET } },
        });
        await tx.lesson.updateMany({
          where: { courseId: lesson.courseId, orderIndex: { gte: ORDER_OFFSET + dto.orderIndex! } },
          data: { orderIndex: { decrement: ORDER_OFFSET - 1 } },
        });
      });
    }

    const updated = await this.prisma.lesson.update({
      where: { id: lessonId },
      data: {
        title: dto.title !== undefined ? dto.title.trim() : undefined,
        description: dto.description !== undefined ? dto.description.trim() : undefined,
        videoUrl: dto.videoUrl !== undefined ? dto.videoUrl : undefined,
        durationSeconds: dto.durationSeconds !== undefined ? dto.durationSeconds : undefined,
        isPreview: dto.isPreview !== undefined ? dto.isPreview : undefined,
        orderIndex: dto.orderIndex !== undefined ? dto.orderIndex : undefined,
        sectionId: dto.sectionId !== undefined ? dto.sectionId : undefined,
      },
    });

    return updated;
  }

  /**
   * حذف درس (Soft Delete)
   */
  async deleteLesson(lessonId: string, userId: string) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { course: { include: { teacher: true } } },
    });

    if (!lesson || lesson.isDeleted) {
      throw new NotFoundException('Lesson not found.');
    }

    if (lesson.course?.teacher?.userId !== userId) {
      const hasAccess = await canManageCourse(this.prisma, userId, lesson.courseId);
      if (!hasAccess) {
        throw new ForbiddenException('You do not have permission to modify this content.');
      }
    }

    await this.prisma.lesson.update({
      where: { id: lessonId },
      data: { isDeleted: true },
    });

    // إشعار الطلاب المشتركين بإزالة الدرس
    this.notificationsService
      .notifyEnrolledStudents(lesson.courseId, {
        type: 'LESSON_REMOVED',
        title: 'تم حذف درس',
        body: `تم حذف درس "${lesson.title}" من كورس "${lesson.course.title}".`,
        linkUrl: `/courses/${lesson.courseId}/learn`,
      })
      .catch(() => undefined);

    return { message: 'Lesson deleted successfully.' };
  }

  /**
   * إعادة ترتيب الدروس مع التحقق الصارم من التبعية وتفادي تصادم الـ Unique Constraint
   */
  async reorderLessons(userId: string, dto: ReorderLessonsDto) {
    const course = await this.verifyCourseOwnership(dto.courseId, userId);

    // 1. استرجاع كل دروس الكورس النشطة
    const courseLessons = await this.prisma.lesson.findMany({
      where: { courseId: course.id, isDeleted: false },
      select: { id: true },
    });

    const courseLessonIds = new Set(courseLessons.map((l) => l.id));

    // 2. التحقق من أن كل الـ IDs المرسلة تنتمي فعلياً لهذا الكورس
    for (const item of dto.orders) {
      if (!courseLessonIds.has(item.lessonId)) {
        throw new BadRequestException(
          `Lesson ID [${item.lessonId}] does not belong to course [${dto.courseId}] or is invalid.`,
        );
      }
    }

    // 3. تنفيذ التعديل داخل Transaction على مرحلتين لتجنب تكرار orderIndex اللحظي
    await this.prisma.$transaction(async (tx) => {
      // المرحلة الأولى: إعطاء قيم سالبة مؤقتة لمنع تصادم @@unique([courseId, orderIndex])
      for (let i = 0; i < dto.orders.length; i++) {
        await tx.lesson.update({
          where: { id: dto.orders[i].lessonId },
          data: { orderIndex: -(i + 1000) },
        });
      }

      // المرحلة الثانية: تعيين القيم النهائية المطلوبة
      for (const item of dto.orders) {
        await tx.lesson.update({
          where: { id: item.lessonId },
          data: { orderIndex: item.newOrderIndex },
        });
      }
    });

    // استرجاع الدروس بالترتيب الجديد
    return this.prisma.lesson.findMany({
      where: { courseId: course.id, isDeleted: false },
      orderBy: { orderIndex: 'asc' },
    });
  }

  /**
   * توليد رابط Presigned PUT لرفع الفيديو المباشر من الفرونت إند إلى التخزين
   */
  async getVideoUploadUrl(
    lessonId: string,
    userId: string,
    fileName: string,
    contentType: string,
  ) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { course: { include: { teacher: true } } },
    });

    if (!lesson || lesson.isDeleted) {
      throw new NotFoundException('Lesson not found.');
    }

    if (lesson.course?.teacher?.userId !== userId) {
      const hasAccess = await canManageCourse(this.prisma, userId, lesson.courseId);
      if (!hasAccess) {
        throw new ForbiddenException('You do not have permission to modify this content.');
      }
    }

    const presigned = await this.storageService.generatePresignedUploadUrl(
      fileName || `lesson_${lesson.id}.mp4`,
      contentType || 'video/mp4',
      'videos',
      1800, // 30 minutes validity for large video upload
    );

    return {
      lessonId: lesson.id,
      uploadUrl: presigned.uploadUrl,
      fileUrl: presigned.fileUrl,
      key: presigned.key,
      expiresInSeconds: presigned.expiresInSeconds,
    };
  }

  /**
   * رفع فيديو محلي مباشرة (multipart/form-data) وتحديث الدرس
   */
  async uploadLessonVideoFile(
    lessonId: string,
    userId: string,
    file: Express.Multer.File,
    durationSeconds?: number,
  ) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { course: { include: { teacher: true } } },
    });

    if (!lesson || lesson.isDeleted) {
      throw new NotFoundException('Lesson not found.');
    }

    if (lesson.course?.teacher?.userId !== userId) {
      const hasAccess = await canManageCourse(this.prisma, userId, lesson.courseId);
      if (!hasAccess) {
        throw new ForbiddenException('You do not have permission to modify this content.');
      }
    }

    if (!file || !file.mimetype.startsWith('video/')) {
      throw new BadRequestException('Only video files are allowed.');
    }

    // اسم فريد لتفادي الكتابة فوق ملفات موجودة
    const ext = path.extname(file.originalname) || '.mp4';
    const uniqueName = `${crypto.randomUUID()}${ext}`;
    const stored = { ...file, originalname: uniqueName };
    const videoUrl = await this.storageService.uploadFile(stored, 'videos');

    // حذف الفيديو القديم إن كان مخزناً محلياً لنفس نظام التخزين
    if (lesson.videoUrl && lesson.videoUrl !== videoUrl) {
      this.storageService.deleteFile(lesson.videoUrl).catch(() => undefined);
    }

    return this.prisma.lesson.update({
      where: { id: lessonId },
      data: {
        videoUrl,
        durationSeconds: durationSeconds !== undefined ? durationSeconds : lesson.durationSeconds,
      },
    });
  }

  /**
   * تأكيد اكتمال رفع الفيديو وتحديث رابط الفيديو ومدة التشغيل
   */
  async confirmVideoUpload(lessonId: string, userId: string, dto: ConfirmVideoDto) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { course: { include: { teacher: true } } },
    });

    if (!lesson || lesson.isDeleted) {
      throw new NotFoundException('Lesson not found.');
    }

    if (lesson.course?.teacher?.userId !== userId) {
      const hasAccess = await canManageCourse(this.prisma, userId, lesson.courseId);
      if (!hasAccess) {
        throw new ForbiddenException('You do not have permission to modify this content.');
      }
    }

    // التحقق من أن الملف موجود بالفعل في وحدة التخزين
    const exists = await this.storageService.fileExists(dto.videoUrl);
    if (!exists) {
      this.logger.warn(`Video confirmation for lesson [${lessonId}] with unverified file path: ${dto.videoUrl}`);
    }

    return this.prisma.lesson.update({
      where: { id: lessonId },
      data: {
        videoUrl: dto.videoUrl,
        durationSeconds: dto.durationSeconds !== undefined ? dto.durationSeconds : lesson.durationSeconds,
      },
    });
  }

  /**
   * توليد رابط تشغيل مؤقت ومشفر (Signed URL)
   * 
   * شروط وأولويات الوصول:
   * 1. المدرس صاحب الكورس أو الأدمن (الأولوية القصوى).
   * 2. فحص اشتراك الطالب النشط (Enrollment.status = ACTIVE).
   * 3. الدرس متاح كمعاينة مجانية (isPreview = true).
   */
  async getLessonStreamUrl(lessonId: string, user?: AuthenticatedUser) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        course: {
          include: {
            teacher: true,
          },
        },
      },
    });

    if (!lesson || lesson.isDeleted || lesson.course.isDeleted) {
      throw new NotFoundException('Lesson not found.');
    }

    if (!lesson.videoUrl) {
      throw new BadRequestException('This lesson does not have a video uploaded yet.');
    }

    let isAuthorized = false;

    // 1. فحص هل المستخدم أدمن أو المدرس صاحب الكورس (الأولوية القصوى)
    if (user) {
      if (user.role === Role.ADMIN) {
        isAuthorized = true;
      } else if (user.role === Role.TEACHER && lesson.course.teacher?.userId === user.id) {
        isAuthorized = true;
      }
    }

    // 2. فحص اشتراك الطالب النشط
    if (!isAuthorized && user && user.role === Role.STUDENT) {
      const student = await this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
      });

      if (student) {
        const enrollment = await this.prisma.enrollment.findFirst({
          where: {
            studentId: student.id,
            courseId: lesson.courseId,
            status: EnrollmentStatus.ACTIVE,
          },
        });

        if (enrollment) {
          // Phase 1: sequential unlocking — an enrolled student can only
          // stream a lesson when the previous lesson AND its quiz are done.
          const states = await this.lessonAccessService.getCourseLessonStates(
            lesson.courseId,
            student.id,
          );
          const state = states.get(lesson.id);
          if (state?.status === 'LOCKED') {
            throw new ForbiddenException({
              success: false,
              code: 'LESSON_LOCKED',
              message:
                state.lockMessage ??
                'You must complete the previous lesson and its quiz first.',
              lockReasonCode: state.lockReasonCode,
            });
          }
          isAuthorized = true;
        }
      }
    }

    // 3. فحص هل الدرس متاح كمعاينة مجانية
    if (!isAuthorized && lesson.isPreview) {
      isAuthorized = true;
    }

    if (!isAuthorized) {
      throw new ForbiddenException(
        'Access denied. You must have an active enrollment in this course to stream this lesson.',
      );
    }

    const streamUrl = await this.storageService.generateSignedDownloadUrl(lesson.videoUrl, 600); // 10 mins validity

    return {
      lessonId: lesson.id,
      title: lesson.title,
      durationSeconds: lesson.durationSeconds,
      isPreview: lesson.isPreview,
      streamUrl,
      expiresInSeconds: 600,
    };
  }

  /**
   * Phase 1 — lightweight access/state check for a single lesson.
   * GET /lessons/:id/access
   */
  async getLessonAccess(lessonId: string, user?: AuthenticatedUser) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { course: { include: { teacher: true } } },
    });
    if (!lesson || lesson.isDeleted || lesson.course.isDeleted) {
      throw new NotFoundException('Lesson not found.');
    }

    // Teacher owner / Admin always have access
    if (
      user &&
      (user.role === Role.ADMIN ||
        (user.role === Role.TEACHER && lesson.course.teacher?.userId === user.id))
    ) {
      return {
        lessonId: lesson.id,
        status: 'AVAILABLE' as const,
        lockReasonCode: null,
        lockMessage: null,
        watchedPercentage: null,
        isCompleted: false,
        quizCompleted: true,
      };
    }

    const student = user
      ? await this.prisma.studentProfile.findUnique({ where: { userId: user.id } })
      : null;
    if (!student) {
      throw new ForbiddenException('Student profile not found.');
    }

    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId: student.id,
        courseId: lesson.courseId,
        status: EnrollmentStatus.ACTIVE,
      },
      select: { id: true },
    });

    const progress = await this.prisma.progress.findUnique({
      where: { studentId_lessonId: { studentId: student.id, lessonId } },
      select: { watchedPercentage: true, isCompleted: true },
    });

    if (!enrollment) {
      return {
        lessonId: lesson.id,
        status: 'LOCKED' as const,
        lockReasonCode: 'NOT_ENROLLED' as const,
        lockMessage: 'يجب الاشتراك في الكورس أولاً.',
        watchedPercentage: progress?.watchedPercentage ?? 0,
        isCompleted: progress?.isCompleted ?? false,
        quizCompleted: false,
      };
    }

    const states = await this.lessonAccessService.getCourseLessonStates(
      lesson.courseId,
      student.id,
    );
    const state =
      states.get(lesson.id) ??
      ({
        status: 'LOCKED',
        lockReasonCode: null,
        lockMessage: null,
        quizCompleted: true,
      } as const);

    return {
      lessonId: lesson.id,
      status: state.status,
      lockReasonCode: state.lockReasonCode,
      lockMessage: state.lockMessage,
      watchedPercentage: progress?.watchedPercentage ?? 0,
      isCompleted: progress?.isCompleted ?? false,
      quizCompleted: state.quizCompleted,
    };
  }

  private async verifyCourseOwnership(courseId: string, userId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: { teacher: true },
    });

    if (!course || course.isDeleted) {
      throw new NotFoundException('Course not found.');
    }

    if (course.teacher?.userId !== userId) {
      const hasAccess = await canManageCourse(this.prisma, userId, courseId);
      if (!hasAccess) {
        throw new ForbiddenException('You do not have permission to modify this course.');
      }
    }

    return course;
  }
}
