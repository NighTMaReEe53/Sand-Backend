import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CourseStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { CreateBundleDto, UpdateBundleDto } from './dtos/bundle.dtos';

interface AuthUser {
  id: string;
  role: Role;
}

@Injectable()
export class BundlesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public list of active bundles with course summaries. */
  async listPublic() {
    const bundles = await this.prisma.bundle.findMany({
      where: { isActive: true, isDeleted: false },
      include: {
        teacher: { select: { fullName: true } },
        items: {
          include: {
            course: {
              select: {
                id: true,
                title: true,
                price: true,
                isFree: true,
                thumbnailUrl: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      bundles: bundles.map((b) => this.decorate(b)),
    };
  }

  async listOwn(user: AuthUser) {
    let teacherId: string | undefined;
    if (user.role !== Role.ADMIN) {
      const teacher = await this.getTeacher(user.id);
      teacherId = teacher.id;
    }

    const bundles = await this.prisma.bundle.findMany({
      where: { isDeleted: false, ...(teacherId && { teacherId }) },
      include: {
        items: {
          include: {
            course: { select: { id: true, title: true, price: true, isFree: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { bundles: bundles.map((b) => this.decorate(b)) };
  }

  private decorate(b: any) {
    const courses = b.items.map((i: any) => i.course);
    const originalTotal = courses.reduce(
      (sum: number, c: any) => sum + (c.isFree ? 0 : Number(c.price)),
      0,
    );
    return {
      ...b,
      courses,
      courseCount: courses.length,
      originalTotal,
      savings: Math.max(0, Math.round((originalTotal - Number(b.price)) * 100) / 100),
    };
  }

  async create(userId: string, dto: CreateBundleDto) {
    const teacher = await this.getTeacher(userId);

    if (!dto.courseIds || dto.courseIds.length < 2) {
      throw new BadRequestException('الباقة يجب أن تحتوي على كورسين على الأقل.');
    }

    // All courses must belong to the bundle owner and be published
    const courses = await this.prisma.course.findMany({
      where: { id: { in: dto.courseIds }, teacherId: teacher.id, isDeleted: false },
      select: { id: true, status: true },
    });
    if (courses.length !== new Set(dto.courseIds).size) {
      throw new BadRequestException('بعض الكورسات غير موجودة أو لا تملكها.');
    }

    const bundle = await this.prisma.bundle.create({
      data: {
        teacherId: teacher.id,
        title: dto.title.trim(),
        description: dto.description ?? null,
        price: dto.price,
        items: {
          create: [...new Set(dto.courseIds)].map((courseId) => ({ courseId })),
        },
      },
    });

    return { message: 'Bundle created successfully.', bundle };
  }

  async update(bundleId: string, userId: string, dto: UpdateBundleDto) {
    await this.assertOwnership(bundleId, userId);

    if (dto.courseIds && dto.courseIds.length < 2) {
      throw new BadRequestException('الباقة يجب أن تحتوي على كورسين على الأقل.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const bundle = await tx.bundle.update({
        where: { id: bundleId },
        data: {
          ...(dto.title !== undefined && { title: dto.title.trim() }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.price !== undefined && { price: dto.price }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });

      if (dto.courseIds) {
        await tx.bundleCourse.deleteMany({ where: { bundleId } });
        await tx.bundleCourse.createMany({
          data: [...new Set(dto.courseIds)].map((courseId) => ({ bundleId, courseId })),
        });
      }

      return bundle;
    });

    return { message: 'Bundle updated successfully.', bundle: updated };
  }

  async delete(bundleId: string, userId: string, user: AuthUser) {
    if (user.role === Role.ADMIN) {
      const exists = await this.prisma.bundle.findFirst({ where: { id: bundleId, isDeleted: false } });
      if (!exists) throw new NotFoundException('Bundle not found.');
    } else {
      await this.assertOwnership(bundleId, userId);
    }
    await this.prisma.bundle.update({ where: { id: bundleId }, data: { isDeleted: true } });
    return { message: 'Bundle deleted successfully.' };
  }

  /**
   * Load a purchasable bundle for checkout: active, published courses only.
   * Returns the effective course list and total price.
   */
  async getPurchasable(bundleId: string) {
    const bundle = await this.prisma.bundle.findFirst({
      where: { id: bundleId, isActive: true, isDeleted: false },
      include: {
        items: {
          include: {
            course: { select: { id: true, status: true, isFree: true, price: true } },
          },
        },
      },
    });
    if (!bundle) throw new NotFoundException('Bundle not found or unavailable.');

    const paidCourses = bundle.items
      .map((i) => i.course)
      .filter((c) => c.status === CourseStatus.PUBLISHED && !c.isFree && Number(c.price) > 0);

    if (paidCourses.length === 0) {
      throw new BadRequestException('لا توجد كورسات مدفوعة متاحة في هذه الباقة.');
    }

    return { bundle, payableCourses: paidCourses };
  }

  private async getTeacher(userId: string) {
    const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId } });
    if (!teacher) throw new ForbiddenException('Teacher profile not found.');
    return teacher;
  }

  private async assertOwnership(bundleId: string, userId: string) {
    const teacher = await this.getTeacher(userId);
    const bundle = await this.prisma.bundle.findFirst({
      where: { id: bundleId, isDeleted: false },
    });
    if (!bundle) throw new NotFoundException('Bundle not found.');
    if (bundle.teacherId !== teacher.id) {
      throw new ForbiddenException('You do not own this bundle.');
    }
    return { bundle, teacher };
  }
}
