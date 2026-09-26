import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

type TxClient = Prisma.TransactionClient | PrismaClient;

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Compute the discount for a coupon against an original amount. */
  private computeDiscount(
    coupon: { discountType: 'PERCENTAGE' | 'FIXED'; discountValue: unknown },
    originalAmount: number,
  ): number {
    const value = Number(coupon.discountValue);
    let discount =
      coupon.discountType === 'PERCENTAGE' ? (originalAmount * value) / 100 : value;
    discount = Math.min(Math.max(0, Math.round(discount * 100) / 100), originalAmount);
    return discount;
  }

  /**
   * Validate a coupon against a purchase target and return pricing info.
   * Throws the same errors whether invalid (never leak why beyond message).
   */
  async validate(code: string, studentId: string | null, target: { courseId?: string; bundleId?: string }) {
    const coupon = await this.prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });

    const invalid = new BadRequestException('كود الخصم غير صالح أو منتهي الصلاحية.');
    if (!coupon || !coupon.isActive) throw invalid;
    if (coupon.expiresAt && coupon.expiresAt < new Date()) throw invalid;
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) throw invalid;

    // Course-specific coupons only apply to that course
    if (coupon.courseId && target.bundleId) {
      throw new BadRequestException('كود الخصم لا يصلح للباقات.');
    }
    if (coupon.courseId && target.courseId && coupon.courseId !== target.courseId) {
      throw new BadRequestException('كود الخصم لا يصلح لهذا الكورس.');
    }

    // Per-user usage limit
    if (studentId) {
      const used = await this.prisma.couponRedemption.count({
        where: { couponId: coupon.id, studentId },
      });
      if (used >= coupon.maxUsesPerUser) {
        throw new BadRequestException('لقد استخدمت هذا الكود من قبل.');
      }
    }

    return coupon;
  }

  /** Validate + price calculation used by checkout (needs original amount). */
  async validateForCheckout(
    code: string,
    studentId: string,
    target: { courseId?: string; bundleId?: string },
    teacherId?: string | null,
  ) {
    const coupon = await this.validate(code, studentId, target);

    if (teacherId && coupon.teacherId && coupon.teacherId !== teacherId) {
      throw new BadRequestException('كود الخصم غير صالح لهذا الكورس.');
    }

    return coupon;
  }

  /** Pure pricing helper — the backend is the single source of truth for prices. */
  calculatePricing(coupon: { discountType: 'PERCENTAGE' | 'FIXED'; discountValue: unknown }, originalAmount: number) {
    const discountAmount = this.computeDiscount(coupon, originalAmount);
    const finalAmount = Math.round((originalAmount - discountAmount) * 100) / 100;
    return { originalAmount, discountAmount, finalAmount };
  }

  /**
   * Consume one use of the coupon inside an existing transaction:
   * records redemption + increments usedCount atomically.
   */
  async consumeInTx(tx: TxClient, couponId: string, studentId: string, paymentId: string) {
    await tx.couponRedemption.create({
      data: { couponId, studentId, paymentId },
    });
    await tx.coupon.update({
      where: { id: couponId },
      data: { usedCount: { increment: 1 } },
    });
  }

  /** Re-validate usage counters inside the transaction (race-safe). */
  async assertUsableInTx(tx: TxClient, couponId: string, studentId: string) {
    const coupon = await tx.coupon.findUnique({ where: { id: couponId } });
    if (!coupon || !coupon.isActive) {
      throw new BadRequestException('كود الخصم غير صالح أو منتهي الصلاحية.');
    }
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      throw new BadRequestException('تم استنفاد عدد استخدامات كود الخصم.');
    }
    const used = await tx.couponRedemption.count({ where: { couponId, studentId } });
    if (used >= coupon.maxUsesPerUser) {
      throw new BadRequestException('لقد استخدمت هذا الكود من قبل.');
    }
    return coupon;
  }

  // ─── Management endpoints ─────────────────────────────────────

  async validatePreview(userId: string, dto: { code: string; courseId?: string; bundleId?: string }) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    let originalAmount = 0;
    if (dto.bundleId) {
      const bundle = await this.prisma.bundle.findFirst({
        where: { id: dto.bundleId, isActive: true, isDeleted: false },
        select: { price: true },
      });
      if (!bundle) throw new NotFoundException('Bundle not found.');
      originalAmount = Number(bundle.price);
    } else if (dto.courseId) {
      const course = await this.prisma.course.findFirst({
        where: { id: dto.courseId, isDeleted: false },
        select: { price: true, isFree: true },
      });
      if (!course || course.isFree) throw new NotFoundException('Course not found.');
      originalAmount = Number(course.price);
    } else {
      throw new BadRequestException('courseId or bundleId is required.');
    }

    const coupon = await this.validate(dto.code, student.id, {
      courseId: dto.courseId,
      bundleId: dto.bundleId,
    });
    const pricing = this.calculatePricing(coupon, originalAmount);

    return {
      valid: true,
      couponCode: coupon.code,
      discountType: coupon.discountType,
      ...pricing,
    };
  }

  private async assertTeacherOwnsCourse(teacherUserId: string, courseId?: string | null) {
    if (!courseId) return null;
    const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId: teacherUserId } });
    if (!teacher) throw new ForbiddenException('Teacher profile not found.');
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, teacherId: teacher.id, isDeleted: false },
      select: { id: true },
    });
    if (!course) throw new ForbiddenException('You do not own this course.');
    return teacher.id;
  }

  async createCoupon(userId: string, dto: any) {
    let teacherId: string | null = null;

    const isAdmin = await this.isAdmin(userId);
    if (!isAdmin) {
      teacherId = await this.assertTeacherOwnsCourse(userId, dto.courseId);
      if (!dto.courseId && !teacherId) {
        throw new ForbiddenException('Global coupons can only be created by admins. Link a course or ask an admin.');
      }
    }

    if (dto.discountType === 'PERCENTAGE' && dto.discountValue > 100) {
      throw new BadRequestException('نسبة الخصم يجب أن تكون بين 1 و 100.');
    }

    const coupon = await this.prisma.coupon.create({
      data: {
        code: dto.code.trim().toUpperCase(),
        teacherId,
        courseId: dto.courseId ?? null,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxUses: dto.maxUses ?? null,
        maxUsesPerUser: dto.maxUsesPerUser ?? 1,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    return { message: 'Coupon created successfully.', coupon };
  }

  async listCoupons(userId: string, isAdmin: boolean) {
    let teacherId: string | undefined;
    if (!isAdmin) {
      const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId } });
      if (!teacher) throw new ForbiddenException('Teacher profile not found.');
      teacherId = teacher.id;
    }

    const coupons = await this.prisma.coupon.findMany({
      where: { ...(teacherId && { teacherId }) },
      include: { course: { select: { id: true, title: true } }, _count: { select: { redemptions: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { coupons };
  }

  async updateCoupon(couponId: string, userId: string, isAdmin: boolean, dto: any) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) throw new NotFoundException('Coupon not found.');

    if (!isAdmin) {
      const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId } });
      if (!teacher || coupon.teacherId !== teacher.id) {
        throw new ForbiddenException('You do not own this coupon.');
      }
    }

    const updated = await this.prisma.coupon.update({
      where: { id: couponId },
      data: {
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.maxUses !== undefined && { maxUses: dto.maxUses }),
        ...(dto.expiresAt !== undefined && {
          expiresAt: dto.expiresAt === null ? null : new Date(dto.expiresAt),
        }),
      },
    });

    return { message: 'Coupon updated successfully.', coupon: updated };
  }

  private async isAdmin(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    return user?.role === 'ADMIN';
  }
}
