import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { CourseStatus, EnrollmentStatus, MaterialKind, Role } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { StorageService } from '../shared/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateCourseMaterialDto, DownloadMaterialResponseDto } from './dtos/create-material.dto';
import { validateAndDetectMaterialFile } from './utils/file-validation.util';
import { canManageCourse } from '../common/utils/course-access.util';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class MaterialsService {
  private readonly logger = new Logger(MaterialsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * رفع ملف تعليمي جديد للكورس مع التحقق من الملكية وصحة الملف وحجمه
   */
  async uploadMaterial(
    courseId: string,
    user: AuthenticatedUser,
    dto: CreateCourseMaterialDto,
    file?: Express.Multer.File,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('A material file (PDF, Word, or PowerPoint) is required.');
    }

    // 1. التحقق من وجود الكورس وملكية المدرس
    await this.verifyCourseOwnership(courseId, user.id);

    // 2. التحقق من الـ Magic Bytes والنوع الحقيقي للملف
    const { fileType } = validateAndDetectMaterialFile(file);

    // 3. رفع الملف لنظام التخزين وتوليد الـ Storage Key الداخلي
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueFileName = `${crypto.randomUUID()}${ext}`;
    const storageFolder = `courses/${courseId}/materials`;
    const storageKey = `${storageFolder}/${uniqueFileName}`;

    await this.storageService.uploadFile(
      {
        originalname: uniqueFileName,
        buffer: file.buffer,
        mimetype: file.mimetype,
      },
      storageFolder,
    );

    // 4. تحديد السكشن أو السكشن الافتراضي
    let sectionId = dto.sectionId;
    if (sectionId) {
      const section = await this.prisma.section.findFirst({
        where: { id: sectionId, courseId },
      });
      if (!section) {
        throw new NotFoundException('Section not found or does not belong to this course.');
      }
    } else {
      let defaultSection = await this.prisma.section.findFirst({
        where: { courseId },
        orderBy: { order: 'asc' },
      });
      if (!defaultSection) {
        defaultSection = await this.prisma.section.create({
          data: {
            courseId,
            title: 'المحتوى العام',
            order: 0,
          },
        });
      }
      sectionId = defaultSection.id;
    }

    // 5. حفظ بيانات المرفق في قاعدة البيانات بالـ Storage Key فقط (بدون رابط عام مكشوف)
    const material = await this.prisma.courseMaterial.create({
      data: {
        courseId,
        sectionId,
        title: dto.title.trim(),
        description: dto.description ? dto.description.trim() : null,
        fileUrl: storageKey,
        fileType,
        kind: dto.kind === MaterialKind.HOMEWORK ? MaterialKind.HOMEWORK : MaterialKind.MATERIAL,
        fileSizeBytes: file.buffer.length,
        uploadedById: user.id,
      },
      select: {
        id: true,
        courseId: true,
        sectionId: true,
        title: true,
        description: true,
        fileType: true,
        kind: true,
        fileSizeBytes: true,
        uploadedById: true,
        createdAt: true,
      },
    });

    this.logger.log(
      `Course material uploaded: [ID: ${material.id}, Course: ${courseId}, Section: ${sectionId}, Type: ${fileType}, Size: ${file.buffer.length} bytes] by User: ${user.id}`,
    );

    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { title: true },
    });
    const isHomework = material.kind === MaterialKind.HOMEWORK;
    this.notificationsService
      .notifyEnrolledStudents(courseId, {
        type: isHomework ? 'HOMEWORK_NEW' : 'MATERIAL_NEW',
        title: isHomework ? 'ملف واجب جديد' : 'ملف جديد',
        body: `تم رفع ${isHomework ? 'ملف واجب' : 'مادة تعليمية'} "${material.title}" في كورس "${course?.title ?? ''}".`,
        linkUrl: `/courses/${courseId}/learn`,
      })
      .catch(() => undefined);

    return material;
  }

  /**
   * جلب قائمة المواد التعليمية للكورس مع حراسة صريحة (Explicit Guard)
   * يرفض الطلب بـ 403 إذا لم يكن المستخدم هو المدرس المالك أو طالب مشترك بحالة ACTIVE
   */
  async getCourseMaterials(courseId: string, user: AuthenticatedUser) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: {
        teacher: true,
      },
    });

    if (!course || course.isDeleted) {
      throw new NotFoundException('Course not found.');
    }

    const hasManageAccess = await canManageCourse(this.prisma, user.id, courseId, user.role as Role);

    let isActiveStudent = false;
    if (user.role === Role.STUDENT) {
      const student = await this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
      });

      if (student) {
        const enrollment = await this.prisma.enrollment.findFirst({
          where: {
            courseId,
            studentId: student.id,
            status: EnrollmentStatus.ACTIVE,
          },
        });
        isActiveStudent = !!enrollment;
      }
    }

    if (!hasManageAccess && !isActiveStudent) {
      throw new ForbiddenException('Active enrollment or course ownership required');
    }

    return this.prisma.courseMaterial.findMany({
      where: { courseId, deletedAt: null },
      select: {
        id: true,
        sectionId: true,
        title: true,
        description: true,
        fileType: true,
        kind: true,
        fileSizeBytes: true,
        createdAt: true,
        section: { select: { id: true, title: true, order: true } },
      },
      orderBy: [{ section: { order: 'asc' } }, { createdAt: 'desc' }],
    });
  }

  /**
   * مكتبة ملفات الطالب: كل الملفات المرفوعة في كل الكورسات المشترك بها
   * (اشتراك ACTIVE فقط) مع اسم الكورس والسكشن — لصفحة المكتبة الموحدة
   */
  async getMyMaterials(user: AuthenticatedUser) {
    if (user.role !== Role.STUDENT) {
      throw new ForbiddenException('This endpoint is for students only.');
    }

    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
    });

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        studentId: student?.id ?? '00000000-0000-0000-0000-000000000000',
        status: EnrollmentStatus.ACTIVE,
        course: { isDeleted: false, status: CourseStatus.PUBLISHED },
      },
      select: {
        courseId: true,
        course: {
          select: {
            id: true,
            title: true,
            thumbnailUrl: true,
            accessType: true,
            durationMonths: true,
          },
        },
      },
    });

    // No active enrollments → empty library (not an error)
    if (enrollments.length === 0) return [];

    const materials = await this.prisma.courseMaterial.findMany({
      where: {
        courseId: { in: enrollments.map((e) => e.courseId) },
        deletedAt: null,
      },
      select: {
        id: true,
        courseId: true,
        sectionId: true,
        title: true,
        description: true,
        fileType: true,
        kind: true,
        fileSizeBytes: true,
        createdAt: true,
        section: { select: { id: true, title: true, order: true } },
      },
      orderBy: [{ courseId: 'asc' }, { section: { order: 'asc' } }, { createdAt: 'desc' }],
    });

    const courseById = new Map(enrollments.map((e) => [e.courseId, e.course]));

    return materials.map((m) => ({
      ...m,
      course: courseById.get(m.courseId) ?? null,
    }));
  }

  /**
   * توليد رابط تنزيل آمن ومؤقت (Signed URL) صالح لمدة 5 دقائق
   * يتم التحقق الصارم من صلاحية المدرس المالك أو الطالب المشترك ACTIVE
   */
  async getSecureDownloadUrl(
    materialId: string,
    user: AuthenticatedUser,
  ): Promise<DownloadMaterialResponseDto> {
    const material = await this.prisma.courseMaterial.findUnique({
      where: { id: materialId },
      include: {
        course: {
          include: {
            teacher: true,
          },
        },
      },
    });

    if (!material || material.deletedAt !== null) {
      throw new NotFoundException('Course material not found.');
    }

    const course = material.course;
    if (!course || course.isDeleted) {
      throw new NotFoundException('Associated course not found.');
    }

    const hasManageAccess = await canManageCourse(this.prisma, user.id, course.id, user.role as Role);

    let isActiveStudent = false;
    if (user.role === Role.STUDENT) {
      const student = await this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
      });

      if (student) {
        const enrollment = await this.prisma.enrollment.findFirst({
          where: {
            courseId: course.id,
            studentId: student.id,
            status: EnrollmentStatus.ACTIVE,
          },
        });
        isActiveStudent = !!enrollment;
      }
    }

    if (!hasManageAccess && !isActiveStudent) {
      throw new ForbiddenException('Active enrollment required to access and download this material.');
    }

    // توليد Signed URL مؤقت ينتهي بعد 300 ثانية (5 دقائق)
    const expiresInSeconds = 300;
    const downloadUrl = await this.storageService.generateSignedDownloadUrl(
      material.fileUrl,
      expiresInSeconds,
    );

    // تجهيز اسم الملف الأصلي القابل للتنزيل
    const ext = path.extname(material.fileUrl) || `.${material.fileType.toLowerCase()}`;
    const sanitizedTitle = material.title.replace(/[/\\?%*:|"<>]/g, '_');
    const fileName = sanitizedTitle.endsWith(ext) ? sanitizedTitle : `${sanitizedTitle}${ext}`;

    this.logger.log(
      `[Material Download Request] Material: ${material.id} downloaded by User: ${user.id} (${user.role})`,
    );

    return {
      downloadUrl,
      expiresInSeconds,
      fileName,
    };
  }

  async deleteMaterial(materialId: string, user: AuthenticatedUser) {
    const material = await this.prisma.courseMaterial.findUnique({
      where: { id: materialId },
      include: {
        course: {
          include: {
            teacher: true,
          },
        },
      },
    });

    if (!material || material.deletedAt !== null) {
      throw new NotFoundException('Course material not found.');
    }

    const isTeacherOwner =
      user.role === Role.TEACHER && material.course?.teacher?.userId === user.id;
    const isAdmin = user.role === Role.ADMIN;

    if (!isTeacherOwner && !isAdmin) {
      const hasManageAccess = await canManageCourse(this.prisma, user.id, material.courseId, user.role as Role);
      if (!hasManageAccess) {
        throw new ForbiddenException('You do not have permission to delete this material.');
      }
    }

    await this.prisma.courseMaterial.update({
      where: { id: materialId },
      data: { deletedAt: new Date() },
    });

    this.logger.log(`Course material [ID: ${materialId}] soft-deleted by User: ${user.id}`);

    return { message: 'Material deleted successfully.' };
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
