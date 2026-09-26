import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CourseStatus, EnrollmentStatus, PaymentStatus, Role } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../shared/prisma/prisma.service';
import { RedisService } from '../shared/redis/redis.service';
import { StorageService } from '../shared/storage/storage.service';
import { CheckoutDto } from './dtos/checkout.dto';
import { RejectPaymentDto } from './dtos/reject-payment.dto';
import { PaymentQueryDto } from './dtos/payment-query.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { GamificationService } from '../gamification/gamification.service';
import { CouponsService } from '../coupons/coupons.service';
import { AuditLogService } from '../audit/audit-log.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly gamificationService: GamificationService,
    private readonly couponsService: CouponsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * 1. بدء عملية الدفع والاشتراك (Checkout)
   * 
   * القواعد الإلزامية:
   * - السعر (amount) يُحسب حصرياً من قاعدة البيانات من سعر الكورس المخزن في الـ DB وقت الطلب.
   * - منع الاشتراك المكرر (PENDING أو ACTIVE).
   * - توليد رقم مرجعي فريد (orderReference) مع محاولات إعادة في حالة التصادم النادر.
   * - كل العمليات تتم داخل prisma.$transaction واحدة.
   */
  async checkout(studentUserId: string, dto: CheckoutDto) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: studentUserId },
    });

    if (!student) {
      throw new ForbiddenException('Student profile not found.');
    }

    const ttlHours = Number(this.configService.get<number>('PAYMENT_TTL_HOURS') || 24);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    const vodafoneWallet = this.configService.get<string>('VODAFONE_CASH_WALLET_NUMBER') || '01012345678';

    // ─── تحديد الهدف: كورس مفرد أو باقة ──────────────────────────
    let targetCourseIds: string[] = [];
    let primaryCourseId: string | null = null;
    let bundleId: string | null = null;
    let originalAmount = 0;
    let offerDiscountAmount = 0;

    if (dto.bundleId) {
      const { payableCourses } = await this.bundlesGetPurchasable(dto.bundleId);
      bundleId = dto.bundleId;
      targetCourseIds = payableCourses.map((c) => ({ id: c.id, price: c.price } as any)).map((c) => c.id);
      originalAmount = payableCourses.reduce((sum, c) => sum + Number(c.price), 0);
      primaryCourseId = targetCourseIds[0] ?? null;
    } else if (dto.courseId) {
      const course = await this.prisma.course.findUnique({
        where: { id: dto.courseId },
        include: { teacher: true },
      });

      if (!course || course.isDeleted) {
        throw new NotFoundException('Course not found.');
      }
      if (course.teacher?.userId === studentUserId) {
        throw new ForbiddenException('Teachers cannot purchase their own courses.');
      }
      if (course.status !== CourseStatus.PUBLISHED) {
        throw new BadRequestException('Cannot checkout for a course that is not published yet.');
      }
      if (course.isFree || Number(course.price) === 0) {
        throw new BadRequestException(
          'This is a free course. Please use the free enrollment endpoint (/courses/:id/enroll-free).',
        );
      }

      targetCourseIds = [course.id];
      primaryCourseId = course.id;
      originalAmount = Number(course.price);

      // ─── عرض الكورس (خصم المدرس) — يُطبق قبل أي كوبون ──────────
      const offerActive =
        course.discountPercent != null &&
        course.discountPercent > 0 &&
        course.discountEndsAt != null &&
        new Date(course.discountEndsAt).getTime() > Date.now();
      if (offerActive) {
        const rounded2 = (n: number) => Math.round(n * 100) / 100;
        offerDiscountAmount = rounded2(
          originalAmount * (Number(course.discountPercent) / 100)
        );
        originalAmount = rounded2(originalAmount - offerDiscountAmount);
      }
    } else {
      throw new BadRequestException('courseId or bundleId is required.');
    }

    // منع الاشتراك المكرر في أي من الكورسات المستهدفة
    const existingEnrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId: student.id,
        courseId: { in: targetCourseIds },
        status: { in: [EnrollmentStatus.PENDING, EnrollmentStatus.ACTIVE] },
      },
    });
    if (existingEnrollment) {
      throw new ConflictException('You already have an active or pending enrollment for one of these courses.');
    }

    // ─── حساب السعر النهائي على السيرفر (كوبونات) ────────────────
    let coupon: { id: string; code?: string } | null = null;
    let amount = originalAmount;
    // The course offer (if any) is already baked into originalAmount above —
    // coupons stack on top of the offered price.
    let discountAmount = offerDiscountAmount;

    if (dto.couponCode && dto.couponCode.trim()) {
      const validated = await this.couponsService.validateForCheckout(
        dto.couponCode,
        student.id,
        { courseId: primaryCourseId ?? undefined, bundleId: bundleId ?? undefined },
      );
      coupon = { id: validated.id };
      const pricing = this.couponsService.calculatePricing(validated as any, amount);
      amount = pricing.finalAmount;
      discountAmount += pricing.discountAmount;
    }

    if (amount <= 0) {
      throw new BadRequestException('المبلغ النهائي غير صالح بعد تطبيق الخصم.');
    }

    const orderReference = `ORD-${Date.now().toString().slice(-4)}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // استهلاك الكوبون داخل نفس المعاملة (آمن ضد السباقات)
        if (coupon) {
          await this.couponsService.assertUsableInTx(tx, coupon.id, student.id);
        }

        // إنشاء سجل دفع واحد PENDING
        const payment = await tx.payment.create({
          data: {
            courseId: primaryCourseId,
            bundleId,
            couponId: coupon?.id ?? null,
            amount,
            originalAmount,
            discountAmount,
            orderReference,
            expiresAt,
            status: PaymentStatus.PENDING,
          },
        });

        // إنشاء اشتراك لكل كورس مستهدف مربوط بالدفعة
        const firstEnrollment = await tx.enrollment.create({
          data: {
            studentId: student.id,
            courseId: targetCourseIds[0],
            status: EnrollmentStatus.PENDING,
            paymentId: payment.id,
          },
        });

        for (const courseId of targetCourseIds.slice(1)) {
          await tx.enrollment.create({
            data: {
              studentId: student.id,
              courseId,
              status: EnrollmentStatus.PENDING,
              paymentId: payment.id,
            },
          });
        }

        // ربط الدفعة بالاشتراك الأول للتوافق مع المسارات القديمة
        await tx.payment.update({
          where: { id: payment.id },
          data: { enrollmentId: firstEnrollment.id },
        });

        // استهلاك الكوبون
        if (coupon) {
          await this.couponsService.consumeInTx(tx, coupon.id, student.id, payment.id);
        }

        // تسجيل مسار التدقيق
        await tx.paymentAuditLog.create({
          data: {
            paymentId: payment.id,
            action: 'CHECKOUT_CREATED',
            performedBy: studentUserId,
            newStatus: PaymentStatus.PENDING,
            details: {
              amount,
              originalAmount,
              discountAmount,
              courseId: primaryCourseId,
              bundleId,
              orderReference,
            },
          },
        });

        return { payment, enrollmentId: firstEnrollment.id };
      });

      const payment = result.payment;

      this.logger.log(
        `Checkout created: [Order: ${payment.orderReference}, Courses: ${targetCourseIds.length}, Amount: ${amount} EGP${discountAmount > 0 ? `, Discount: ${discountAmount}` : ''}] by Student [${student.id}]`,
      );

      // Audit log: عملية شراء
      await this.auditLogService.log({
        userId: studentUserId,
        action: 'CHECKOUT_CREATED',
        entity: 'Payment',
        entityId: payment.id,
        metadata: { orderReference: payment.orderReference, amount, bundleId, couponCode: dto.couponCode ?? null },
      });

      return {
        message: 'Checkout created successfully. Please transfer the exact amount and submit your receipt.',
        paymentId: payment.id,
        enrollmentId: result.enrollmentId,
        orderReference: payment.orderReference,
        amount,
        originalAmount,
        discountAmount,
        vodafoneCashNumber: vodafoneWallet,
        expiresAt: payment.expiresAt,
        instructions: `يرجى تحويل مبلغ ${amount} جنيه مصري إلى محفظة فودافون كاش رقم (${vodafoneWallet}) مع الاحتفاظ بصورة الإيصال أو لقطة الشاشة ورفعها لتأكيد الاشتراك.`,
      };
    } catch (err: any) {
      // التحقق من تصادم الفهرس الفريد الجزئي (enrollment_active_unique)
      if (err.code === 'P2002' || err.message?.includes('enrollment_active_unique') || err.message?.includes('student_id')) {
        throw new ConflictException('You already have an active or pending enrollment for one of these courses.');
      }
      throw err;
    }
  }

  private async bundlesGetPurchasable(bundleId: string) {
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

    const payableCourses = bundle.items
      .map((i) => i.course)
      .filter((c) => c.status === CourseStatus.PUBLISHED && !c.isFree && Number(c.price) > 0);

    if (payableCourses.length === 0) {
      throw new BadRequestException('لا توجد كورسات مدفوعة متاحة في هذه الباقة.');
    }

    return { bundle, payableCourses };
  }

  /**
   * 2. رفع صورة إيصال الدفع (Submit Receipt)
   * 
   * القواعد الإلزامية:
   * - فحص نوع وحجم الصورة (JPEG/PNG/WebP ≤ 5MB).
   * - Rate Limiting مزدوج (3 محاولات / ساعة للاشتراك، و 10 / ساعة للطالب ككل).
   * - حساب بصمة SHA-256 للصورة والاعتماد على DB Unique Constraint لمنع تكرار الإيصال ذاته.
   */
  async submitReceipt(
    paymentId: string,
    studentUserId: string,
    file?: Express.Multer.File,
    receiptImageUrlFromBody?: string,
  ) {
    // 1. التحقق من وجود الصورة وصلاحيتها
    if (!file && !receiptImageUrlFromBody) {
      throw new BadRequestException('Receipt image file is required.');
    }

    if (file) {
      const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedMimes.includes(file.mimetype)) {
        throw new BadRequestException(
          'Invalid file type. Only JPEG, PNG, and WebP images are allowed for receipts.',
        );
      }

      const maxBytes = 5 * 1024 * 1024; // 5 MB
      if (file.size > maxBytes) {
        throw new BadRequestException('Receipt image size exceeds the 5MB limit.');
      }
    }

    // 2. التحقق من سجل الدفع وتبعيتها للطالب
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        enrollment: {
          include: {
            student: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment record not found.');
    }

    if (payment.enrollment.student.userId !== studentUserId) {
      throw new ForbiddenException('You do not have permission to submit a receipt for this payment.');
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(
        `Cannot submit receipt for payment with status "${payment.status}".`,
      );
    }

    // التحقق من انتهاء الصلاحية
    if (new Date() > new Date(payment.expiresAt)) {
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.EXPIRED },
        });
        await tx.enrollment.update({
          where: { id: payment.enrollmentId },
          data: { status: EnrollmentStatus.EXPIRED },
        });
        await tx.paymentAuditLog.create({
          data: {
            paymentId: payment.id,
            action: 'EXPIRED',
            performedBy: studentUserId,
            previousStatus: PaymentStatus.PENDING,
            newStatus: PaymentStatus.EXPIRED,
            details: { reason: 'Expired before receipt submission' },
          },
        });
      });
      throw new BadRequestException('This payment request has expired. Please initiate a new checkout.');
    }

    // 3. تطبيق Rate Limiting على مستويين
    await this.applyReceiptRateLimits(payment.enrollmentId, studentUserId);

    // 4. حساب بصمة SHA-256 للملف
    let receiptImageHash: string;
    let finalImageUrl: string;

    if (file) {
      receiptImageHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
      finalImageUrl = await this.storageService.uploadFile(
        file,
        'receipts',
      );
    } else {
      receiptImageHash = crypto.createHash('sha256').update(receiptImageUrlFromBody!).digest('hex');
      finalImageUrl = receiptImageUrlFromBody!;
    }

    // 5. التحديث داخل Transaction والاعتماد على DB Unique Constraint ضد التكرار والـ Race Conditions
    try {
      const updatedPayment = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.payment.update({
          where: { id: paymentId },
          data: {
            receiptImageUrl: finalImageUrl,
            receiptImageHash,
            updatedAt: new Date(),
          },
        });

        await tx.paymentAuditLog.create({
          data: {
            paymentId: payment.id,
            action: 'RECEIPT_SUBMITTED',
            performedBy: studentUserId,
            previousStatus: PaymentStatus.PENDING,
            newStatus: PaymentStatus.PENDING,
            details: {
              receiptImageUrl: finalImageUrl,
              receiptImageHash,
            },
          },
        });

        return updated;
      });

      this.logger.log(`Receipt submitted for Payment [${payment.id}, Order: ${payment.orderReference}]`);

      return {
        message: 'Receipt submitted successfully. Payment is under review by the teacher.',
        payment: updatedPayment,
      };
    } catch (error: any) {
      if (error.code === 'P2002' || error.message?.includes('receipt_image_hash')) {
        throw new ConflictException(
          'Duplicate receipt image detected! This exact receipt image was already used for another payment.',
        );
      }
      throw error;
    }
  }

  /**
   * 3. استعراض طلبات الدفع الخاصة بالمدرس مع حماية IDOR الصارمة
   */
  async getTeacherPayments(teacherUserId: string, query: PaymentQueryDto) {
    const { page = 1, limit = 10, status, courseId } = query;
    const skip = (page - 1) * limit;

    const isAdmin = await this.checkIsAdmin(teacherUserId);
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId: teacherUserId },
    });

    // ADMIN reviews payments across ALL courses — never lock them out
    if (!teacher && !isAdmin) {
      throw new ForbiddenException('Teacher profile not found.');
    }

    // حماية IDOR: إجبار الفلترة على كورسات هذا المدرس فقط (الأدمن يرى الجميع)
    const whereClause: any = {};
    if (!isAdmin && teacher) {
      whereClause.course = {
        teacherId: teacher.id,
        // No isDeleted filter: suspended payments must stay visible and
        // reviewable even after their course gets soft-deleted/archived.
      };
    }

    if (status) {
      whereClause.status = status;
    }

    if (courseId) {
      whereClause.courseId = courseId;
    }

    const [total, payments] = await Promise.all([
      this.prisma.payment.count({ where: whereClause }),
      this.prisma.payment.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          course: {
            select: {
              id: true,
              title: true,
              price: true,
            },
          },
          enrollment: {
            select: {
              id: true,
              status: true,
              student: {
                select: {
                  id: true,
                  fullName: true,
                  guardianPhone: true,
                  user: {
                    select: {
                      phone: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      payments,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 4. قبول طلب الدفع وتفعيل الاشتراك (Accept Payment)
   * 
   * القواعد الإلزامية:
   * - التحقق من أن المدرس هو المالك الفعلي للكورس.
   * - استخدام Optimistic Update (WHERE status = 'PENDING') لمنع القبول المزدوج اللحظي.
   * - تفعيل الـ Enrollment وتحديث Payment وتسجيل الـ AuditLog داخل Transaction واحدة.
   */
  async acceptPayment(paymentId: string, teacherUserId: string) {
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId: teacherUserId },
    });

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        course: { include: { teacher: { select: { userId: true } } } },
        enrollment: {
          include: {
            student: {
              select: { userId: true, fullName: true },
            },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found.');
    }

    // فحص الملكية
    const isAdmin = await this.checkIsAdmin(teacherUserId);
    if (!isAdmin && (!teacher || payment.course.teacherId !== teacher.id)) {
      throw new ForbiddenException('You do not have permission to accept payments for this course.');
    }

    // تنفيذ القبول الذري داخل Transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Optimistic Check: تحديث فقط إذا كانت الحالة الحالية PENDING
      const updateResult = await tx.payment.updateMany({
        where: {
          id: paymentId,
          status: PaymentStatus.PENDING,
        },
        data: {
          status: PaymentStatus.ACCEPTED,
          reviewedById: teacherUserId,
          reviewedAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictException('Payment has already been reviewed or is no longer pending.');
      }

      // تفعيل جميع الاشتراكات المرتبطة بالدفعة (يدعم الباقات)
      await tx.enrollment.updateMany({
        where: {
          OR: [{ paymentId }, { id: payment.enrollmentId ?? '' }],
          status: EnrollmentStatus.PENDING,
        },
        data: {
          status: EnrollmentStatus.ACTIVE,
          activatedAt: new Date(),
        },
      });

      // تسجيل مسار التدقيق
      await tx.paymentAuditLog.create({
        data: {
          paymentId: payment.id,
          action: 'ACCEPTED',
          performedBy: teacherUserId,
          previousStatus: PaymentStatus.PENDING,
          newStatus: PaymentStatus.ACCEPTED,
          details: {
            reviewedAt: new Date(),
          },
        },
      });

      return { paymentId, status: PaymentStatus.ACCEPTED };
    });

    this.logger.log(`Payment [${paymentId}] accepted by Teacher [${teacherUserId}]. Student enrollment(s) activated.`);

    // Audit log + إشعار الطالب بقبول الدفع
    await this.auditLogService.log({
      userId: teacherUserId,
      action: 'PAYMENT_ACCEPTED',
      entity: 'Payment',
      entityId: paymentId,
      metadata: { orderReference: payment.orderReference, amount: Number(payment.amount) },
    });

    // إشعار الطالب بقبول الدفع
    const studentUserId = payment.enrollment?.student?.userId;
    if (studentUserId) {
      await this.notificationsService
        .notify({
          userId: studentUserId,
          type: 'PAYMENT_APPROVED',
          title: 'تم قبول دفعتك',
          body: `مبروك! تم تفعيل اشتراكك في كورس "${payment.course.title}".`,
          linkUrl: `/courses/${payment.course.id}/learn`,
        })
        .catch((e) => this.logger.error(`Failed to notify student: ${e.message}`));
    }

    // إشعار المدرس صاحب الكورس بالاشتراك الجديد
    const courseTeacherUserId = (payment.course as { teacher?: { userId?: string } }).teacher?.userId;
    if (courseTeacherUserId) {
      await this.notificationsService
        .notify({
          userId: courseTeacherUserId,
          type: 'ENROLLMENT',
          title: 'اشتراك جديد في كورسك',
          body: payment.enrollment?.student?.fullName
            ? `الطالب "${payment.enrollment.student.fullName}" اشترك الآن في كورس "${payment.course.title}".`
            : `تم تسجيل اشتراك جديد في كورس "${payment.course.title}".`,
          linkUrl: `/dashboard/payments`,
        })
        .catch((e) => this.logger.error(`Failed to notify teacher of new enrollment: ${e.message}`));
    }

    // Gamification: first enrollment badge
    if (payment.enrollment?.studentId) {
      await this.gamificationService.awardBadge(
        payment.enrollment.studentId,
        'FIRST_COURSE_ENROLLED',
      );
    }

    return {
      message: 'Payment accepted successfully and student enrollment activated.',
      data: result,
    };
  }

  /**
   * 5. رفض طلب الدفع (Reject Payment)
   * 
   * القواعد الإلزامية:
   * - سبب الرفض (rejectionReason) إلزامي لا يقل عن 5 أحرف.
   * - استخدام Optimistic Update (WHERE status = 'PENDING').
   * - تحديث الـ Enrollment إلى REJECTED وتسجيل الـ Audit Log.
   */
  async rejectPayment(paymentId: string, teacherUserId: string, dto: RejectPaymentDto) {
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId: teacherUserId },
    });

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        course: true,
        enrollment: { include: { student: { select: { userId: true } } } },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found.');
    }

    const isAdmin = await this.checkIsAdmin(teacherUserId);
    if (!isAdmin && (!teacher || payment.course.teacherId !== teacher.id)) {
      throw new ForbiddenException('You do not have permission to reject payments for this course.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Optimistic Check
      const updateResult = await tx.payment.updateMany({
        where: {
          id: paymentId,
          status: PaymentStatus.PENDING,
        },
        data: {
          status: PaymentStatus.REJECTED,
          rejectionReason: dto.rejectionReason.trim(),
          reviewedById: teacherUserId,
          reviewedAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictException('Payment has already been reviewed or is no longer pending.');
      }

      // تحديث حالة جميع اشتراكات الدفعة إلى REJECTED (يدعم الباقات)
      await tx.enrollment.updateMany({
        where: {
          OR: [{ paymentId }, { id: payment.enrollmentId ?? '' }],
          status: EnrollmentStatus.PENDING,
        },
        data: {
          status: EnrollmentStatus.REJECTED,
        },
      });

      // تسجيل مسار التدقيق
      await tx.paymentAuditLog.create({
        data: {
          paymentId: payment.id,
          action: 'REJECTED',
          performedBy: teacherUserId,
          previousStatus: PaymentStatus.PENDING,
          newStatus: PaymentStatus.REJECTED,
          details: {
            rejectionReason: dto.rejectionReason.trim(),
            reviewedAt: new Date(),
          },
        },
      });

      return { paymentId, status: PaymentStatus.REJECTED, rejectionReason: dto.rejectionReason.trim() };
    });

    this.logger.log(`Payment [${paymentId}] rejected by Teacher [${teacherUserId}]. Reason: "${dto.rejectionReason}"`);

    // Audit log + إشعار الطالب برفض الدفع
    await this.auditLogService.log({
      userId: teacherUserId,
      action: 'PAYMENT_REJECTED',
      entity: 'Payment',
      entityId: paymentId,
      metadata: { orderReference: payment.orderReference, reason: dto.rejectionReason.trim() },
    });

    // إشعار الطالب برفض الدفع
    const rejectedStudentUserId = payment.enrollment?.student?.userId;
    if (rejectedStudentUserId) {
      await this.notificationsService
        .notify({
          userId: rejectedStudentUserId,
          type: 'PAYMENT_REJECTED',
          title: 'تم رفض إيصال الدفع',
          body: `تم رفض دفعتك لكورس "${payment.course.title}". السبب: ${dto.rejectionReason.trim()}`,
          linkUrl: '/my-courses',
        })
        .catch((e) => this.logger.error(`Failed to notify student: ${e.message}`));
    }

    return {
      message: 'Payment rejected successfully.',
      data: result,
    };
  }

  /**
   * 6. إعادة المحاولة بعد الرفض (Retry Payment)
   * 
   * القواعد الإلزامية:
   * - يُسمح بها فقط إذا كان الـ Enrollment الحالي بحالة REJECTED.
   * - إنشاء سجل Payment جديد بالكامل برقم مرجعي جديد وسعر محسوب من الـ DB وصلاحية جديدة.
   * - ممنوع تعديل أو إعادة تدوير سجل Payment المرفوض القديم.
   */
  async retryPayment(enrollmentId: string, studentUserId: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: studentUserId },
    });

    if (!student) {
      throw new ForbiddenException('Student profile not found.');
    }

    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: { course: true },
    });

    if (!enrollment || enrollment.studentId !== student.id) {
      throw new NotFoundException('Enrollment not found.');
    }

    if (enrollment.status !== EnrollmentStatus.REJECTED) {
      throw new BadRequestException(
        `Only rejected enrollments can be retried. Current status is "${enrollment.status}".`,
      );
    }

    const course = enrollment.course;
    if (course.status !== CourseStatus.PUBLISHED || course.isDeleted) {
      throw new BadRequestException('Course is no longer available for enrollment.');
    }

    const amount = course.price;
    const ttlHours = Number(this.configService.get<number>('PAYMENT_TTL_HOURS') || 24);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    const vodafoneWallet = this.configService.get<string>('VODAFONE_CASH_WALLET_NUMBER') || '01012345678';
    const orderReference = `ORD-${Date.now().toString().slice(-4)}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const newPayment = await this.prisma.$transaction(async (tx) => {
      // 1. إعادة حالة الـ Enrollment إلى PENDING
      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: { status: EnrollmentStatus.PENDING },
      });

      // 2. إنشاء سجل Payment جديد بالكامل
      const created = await tx.payment.create({
        data: {
          enrollmentId: enrollment.id,
          courseId: course.id,
          amount,
          orderReference,
          expiresAt,
          status: PaymentStatus.PENDING,
        },
      });

      // 3. تسجيل مسار التدقيق
      await tx.paymentAuditLog.create({
        data: {
          paymentId: created.id,
          action: 'CHECKOUT_CREATED',
          performedBy: studentUserId,
          newStatus: PaymentStatus.PENDING,
          details: {
            retryForEnrollment: enrollment.id,
            newOrderReference: orderReference,
            amount: Number(amount),
          },
        },
      });

      return created;
    });

    this.logger.log(`Payment retried: [New Payment: ${newPayment.id}, Order: ${orderReference}] for Enrollment [${enrollment.id}]`);

    return {
      message: 'New payment request created for retry.',
      paymentId: newPayment.id,
      enrollmentId: enrollment.id,
      orderReference: newPayment.orderReference,
      amount: Number(amount),
      vodafoneCashNumber: vodafoneWallet,
      expiresAt: newPayment.expiresAt,
    };
  }

  /**
   * 7. إلغاء طلب الدفع بواسطة الطالب (Cancel Payment)
   * 
   * يُسمح فقط إذا كان الطلب PENDING ولم يتم رفع إيصال بعد.
   */
  async cancelPayment(paymentId: string, studentUserId: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: studentUserId },
    });

    if (!student) {
      throw new ForbiddenException('Student profile not found.');
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { enrollment: true },
    });

    if (!payment || payment.enrollment.studentId !== student.id) {
      throw new NotFoundException('Payment not found.');
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(`Cannot cancel a payment with status "${payment.status}".`);
    }

    if (payment.receiptImageUrl) {
      throw new BadRequestException('Cannot cancel payment after a receipt has already been submitted.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.CANCELLED },
      });

      await tx.enrollment.update({
        where: { id: payment.enrollmentId },
        data: { status: EnrollmentStatus.CANCELLED },
      });

      await tx.paymentAuditLog.create({
        data: {
          paymentId: payment.id,
          action: 'CANCELLED',
          performedBy: studentUserId,
          previousStatus: PaymentStatus.PENDING,
          newStatus: PaymentStatus.CANCELLED,
        },
      });
    });

    return { message: 'Payment cancelled successfully.' };
  }

  /**
   * 8. استعراض سجل مدفوعات الطالب الحالي
   */
  async getMyPayments(studentUserId: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: studentUserId },
    });

    if (!student) {
      throw new ForbiddenException('Student profile not found.');
    }

    const payments = await this.prisma.payment.findMany({
      where: {
        enrollment: {
          studentId: student.id,
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            thumbnailUrl: true,
            price: true,
          },
        },
        enrollment: {
          select: {
            id: true,
            status: true,
            activatedAt: true,
          },
        },
      },
    });

    return payments;
  }

  /**
   * 9. وظيفة مجدولة لإلغاء طلبات الدفع المعلقة المنتهية صلاحيتها (TTL Cleanup Cron Job)
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expirePendingPayments() {
    this.logger.log('Running TTL check for expired pending payments...');

    const expiredPayments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        expiresAt: { lt: new Date() },
      },
      select: { id: true, enrollmentId: true },
    });

    if (expiredPayments.length === 0) {
      return;
    }

    this.logger.log(`Found ${expiredPayments.length} expired payments to process.`);

    for (const item of expiredPayments) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.payment.update({
            where: { id: item.id },
            data: { status: PaymentStatus.EXPIRED },
          });

          await tx.enrollment.update({
            where: { id: item.enrollmentId },
            data: { status: EnrollmentStatus.EXPIRED },
          });

          await tx.paymentAuditLog.create({
            data: {
              paymentId: item.id,
              action: 'EXPIRED',
              // A cron job has no user identity. Keeping this nullable avoids
              // a fake UUID that violates the foreign-key constraint.
              performedBy: null,
              previousStatus: PaymentStatus.PENDING,
              newStatus: PaymentStatus.EXPIRED,
              details: { reason: 'Automatic TTL expiration after timeout' },
            },
          });
        });
      } catch (err: any) {
        this.logger.error(`Error expiring payment [${item.id}]: ${err.message}`);
      }
    }
  }

  private async applyReceiptRateLimits(enrollmentId: string, studentUserId: string) {
    // 1. Enrollment-level limit: max 3 attempts / hour
    const enrollmentKey = `ratelimit:receipt:enrollment:${enrollmentId}`;
    const enrollmentCount = await this.redisService.incr(enrollmentKey);
    if (enrollmentCount === 1) {
      await this.redisService.expire(enrollmentKey, 3600);
    }
    if (enrollmentCount > 3) {
      throw new HttpException(
        'Too many receipt submissions for this enrollment. Maximum 3 attempts per hour allowed.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2. Student-level limit: max 10 attempts / hour across all enrollments
    const studentKey = `ratelimit:receipt:student:${studentUserId}`;
    const studentCount = await this.redisService.incr(studentKey);
    if (studentCount === 1) {
      await this.redisService.expire(studentKey, 3600);
    }
    if (studentCount > 10) {
      throw new HttpException(
        'Too many receipt submissions across your account. Maximum 10 attempts per hour allowed.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async checkIsAdmin(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return user?.role === Role.ADMIN;
  }
}
