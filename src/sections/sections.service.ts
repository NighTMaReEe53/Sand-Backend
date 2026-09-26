import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { CreateSectionDto } from './dtos/create-section.dto';
import { UpdateSectionDto } from './dtos/update-section.dto';
import { ReorderSectionsDto } from './dtos/reorder-sections.dto';

interface AuthUser {
  id: string;
  role: Role;
}

@Injectable()
export class SectionsService {
  private readonly logger = new Logger(SectionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * التحقق من ملكية المدرس للكورس
   */
  private async verifyTeacherOwnership(courseId: string, userId: string): Promise<void> {
    const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId } });
    if (!teacher) throw new ForbiddenException('Teacher profile not found.');

    const course = await this.prisma.course.findFirst({
      where: { id: courseId, teacherId: teacher.id, isDeleted: false },
    });
    if (!course) throw new NotFoundException('Course not found or access denied.');
  }

  /**
   * POST /courses/:id/sections — إنشاء سكشن جديد
   */
  async createSection(courseId: string, dto: CreateSectionDto, user: AuthUser) {
    if (user.role === Role.ADMIN) {
      const course = await this.prisma.course.findFirst({ where: { id: courseId, isDeleted: false } });
      if (!course) throw new NotFoundException('Course not found.');
    } else {
      await this.verifyTeacherOwnership(courseId, user.id);
    }

    // احسب الـ order التالي لو مش متبعت
    let order = dto.order;
    if (order === undefined) {
      const lastSection = await this.prisma.section.findFirst({
        where: { courseId },
        orderBy: { order: 'desc' },
      });
      order = lastSection ? lastSection.order + 1 : 0;
    }

    const section = await this.prisma.section.create({
      data: { courseId, title: dto.title.trim(), order },
      include: {
        _count: { select: { lessons: true, materials: true } },
      },
    });

    this.logger.log(`Section created: [ID: ${section.id}, Title: "${section.title}"] in Course [${courseId}]`);
    return section;
  }

  /**
   * PATCH /sections/:id — تعديل عنوان/ترتيب السكشن
   */
  async updateSection(sectionId: string, dto: UpdateSectionDto, user: AuthUser) {
    const section = await this.prisma.section.findUnique({ where: { id: sectionId } });
    if (!section) throw new NotFoundException('Section not found.');

    if (user.role !== Role.ADMIN) {
      await this.verifyTeacherOwnership(section.courseId, user.id);
    }

    const updated = await this.prisma.section.update({
      where: { id: sectionId },
      data: {
        ...(dto.title && { title: dto.title.trim() }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
      include: {
        _count: { select: { lessons: true, materials: true } },
      },
    });

    return updated;
  }

  /**
   * DELETE /sections/:id — حذف سكشن (يرفض لو فيه محتوى)
   */
  async deleteSection(sectionId: string, user: AuthUser) {
    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
      include: {
        _count: { select: { lessons: true, materials: true } },
      },
    });
    if (!section) throw new NotFoundException('Section not found.');

    if (user.role !== Role.ADMIN) {
      await this.verifyTeacherOwnership(section.courseId, user.id);
    }

    // رفض الحذف لو فيه محتوى
    const hasLessons = await this.prisma.lesson.count({
      where: { sectionId, isDeleted: false },
    });
    const hasMaterials = await this.prisma.courseMaterial.count({
      where: { sectionId, deletedAt: null },
    });

    if (hasLessons > 0 || hasMaterials > 0) {
      throw new BadRequestException(
        `لا يمكن حذف الفصل لأنه يحتوي على ${hasLessons} درس/دروس و${hasMaterials} ملف/ملفات. يرجى نقل المحتوى أو حذفه أولاً.`,
      );
    }

    await this.prisma.section.delete({ where: { id: sectionId } });
    this.logger.log(`Section deleted: [ID: ${sectionId}]`);
    return { message: 'Section deleted successfully.' };
  }

  /**
   * POST /sections/reorder — إعادة ترتيب السكاشن
   */
  async reorderSections(courseId: string, dto: ReorderSectionsDto, user: AuthUser) {
    if (user.role !== Role.ADMIN) {
      await this.verifyTeacherOwnership(courseId, user.id);
    }

    // تأكد أن كل الـ IDs تنتمي للكورس ده
    const sections = await this.prisma.section.findMany({
      where: { courseId },
      select: { id: true },
    });
    const validIds = new Set(sections.map((s) => s.id));

    for (const id of dto.sectionIds) {
      if (!validIds.has(id)) {
        throw new BadRequestException(`Section ID "${id}" does not belong to this course.`);
      }
    }

    // تحديث الـ order لكل section
    await this.prisma.$transaction(
      dto.sectionIds.map((id, index) =>
        this.prisma.section.update({
          where: { id },
          data: { order: index },
        }),
      ),
    );

    return { message: 'Sections reordered successfully.' };
  }
}
