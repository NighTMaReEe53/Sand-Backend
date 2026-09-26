import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CourseStatus, EnrollmentStatus, PaymentStatus } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GamificationService } from '../gamification/gamification.service';
import { CouponsService } from '../coupons/coupons.service';
import { AuditLogService } from '../audit/audit-log.service';
import { RedisService } from '../shared/redis/redis.service';
import { StorageService } from '../shared/storage/storage.service';

describe('PaymentsService (Unit Tests)', () => {
  let service: PaymentsService;
  let prisma: PrismaService;
  let redisService: RedisService;
  let storageService: StorageService;

  const mockPrismaService = {
    studentProfile: { findUnique: jest.fn() },
    teacherProfile: { findUnique: jest.fn() },
    course: { findUnique: jest.fn() },
    enrollment: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    payment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    paymentAuditLog: { create: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  const mockRedisService = {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(true),
  };

  const mockStorageService = {
    uploadFile: jest.fn().mockResolvedValue({
      fileUrl: 'https://cdn.example.com/receipts/receipt1.jpg',
      key: 'receipts/receipt1.jpg',
    }),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'VODAFONE_CASH_WALLET_NUMBER') return '01012345678';
      if (key === 'PAYMENT_TTL_HOURS') return 24;
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: GamificationService, useValue: { recordActivity: jest.fn().mockResolvedValue(undefined), awardBadge: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { validateForCheckout: jest.fn(), calculatePricing: jest.fn(), assertUsableInTx: jest.fn(), consumeInTx: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },

        { provide: RedisService, useValue: mockRedisService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    prisma = module.get<PrismaService>(PrismaService);
    redisService = module.get<RedisService>(RedisService);
    storageService = module.get<StorageService>(StorageService);
    jest.clearAllMocks();

    mockPrismaService.payment.update.mockResolvedValue({});
    mockPrismaService.payment.create.mockResolvedValue({});
    mockPrismaService.enrollment.update.mockResolvedValue({});
    mockPrismaService.enrollment.create.mockResolvedValue({});
    mockPrismaService.paymentAuditLog.create.mockResolvedValue({});
    mockRedisService.incr.mockResolvedValue(1);
    mockRedisService.expire.mockResolvedValue(true);
  });

  describe('checkout', () => {
    const studentUserId = 'user-student-1';
    const courseId = 'course-paid-1';

    it('should calculate amount strictly from course price in DB and create checkout', async () => {
      mockPrismaService.studentProfile.findUnique.mockResolvedValue({ id: 'student-prof-1' });
      mockPrismaService.course.findUnique.mockResolvedValue({
        id: courseId,
        title: 'Physics 101',
        price: '350.00',
        isFree: false,
        status: CourseStatus.PUBLISHED,
        isDeleted: false,
      });
      mockPrismaService.enrollment.findFirst.mockResolvedValue(null);
      mockPrismaService.enrollment.create.mockResolvedValue({ id: 'enrollment-1' });
      mockPrismaService.payment.create.mockResolvedValue({
        id: 'payment-1',
        orderReference: 'ORD-1234ABC',
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      });

      const result = await service.checkout(studentUserId, { courseId });

      expect(result.amount).toBe(350);
      expect(result.vodafoneCashNumber).toBe('01012345678');
      expect(mockPrismaService.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: 350,
          status: PaymentStatus.PENDING,
        }),
      });
    });

    it('should throw ConflictException if student already has a PENDING or ACTIVE enrollment', async () => {
      mockPrismaService.studentProfile.findUnique.mockResolvedValue({ id: 'student-prof-1' });
      mockPrismaService.course.findUnique.mockResolvedValue({
        id: courseId,
        price: '350.00',
        isFree: false,
        status: CourseStatus.PUBLISHED,
        isDeleted: false,
      });
      mockPrismaService.enrollment.findFirst.mockResolvedValue({ id: 'existing-pending' });

      await expect(service.checkout(studentUserId, { courseId })).rejects.toThrow(
        ConflictException,
      );
    });

    it('should reject checkout for an unpublished course', async () => {
      mockPrismaService.studentProfile.findUnique.mockResolvedValue({ id: 'student-prof-1' });
      mockPrismaService.course.findUnique.mockResolvedValue({
        id: courseId,
        price: '350.00',
        isFree: false,
        status: CourseStatus.DRAFT, // UNPUBLISHED
        isDeleted: false,
      });

      await expect(service.checkout(studentUserId, { courseId })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('submitReceipt (Anti-Fraud Hash & Verification)', () => {
    const paymentId = 'payment-1';
    const studentUserId = 'user-student-1';
    const mockFile: Express.Multer.File = {
      buffer: Buffer.from('fake receipt image contents'),
      mimetype: 'image/jpeg',
      size: 1024 * 50,
      fieldname: 'receipt',
      originalname: 'receipt.jpg',
      encoding: '7bit',
      stream: null as any,
      destination: '',
      filename: '',
      path: '',
    };

    it('should reject duplicate receipt image hash with 409 Conflict', async () => {
      mockPrismaService.payment.findUnique.mockResolvedValue({
        id: paymentId,
        enrollmentId: 'enrollment-1',
        status: PaymentStatus.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        orderReference: 'ORD-123',
        enrollment: {
          student: { userId: studentUserId },
        },
      });

      mockPrismaService.payment.update.mockRejectedValue({
        code: 'P2002',
        message: 'Unique constraint failed on receipt_image_hash',
      });

      await expect(
        service.submitReceipt(paymentId, studentUserId, mockFile),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject if payment has expired', async () => {
      mockPrismaService.payment.findUnique.mockResolvedValue({
        id: paymentId,
        enrollmentId: 'enrollment-1',
        status: PaymentStatus.PENDING,
        expiresAt: new Date(Date.now() - 100000), // EXPIRED
        orderReference: 'ORD-123',
        enrollment: {
          student: { userId: studentUserId },
        },
      });

      await expect(
        service.submitReceipt(paymentId, studentUserId, mockFile),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: PaymentStatus.EXPIRED } }),
      );
    });
  });

  describe('acceptPayment (Optimistic Atomic Lock)', () => {
    const paymentId = 'payment-1';
    const teacherUserId = 'teacher-user-1';

    it('should accept payment, activate enrollment and create audit log', async () => {
      mockPrismaService.teacherProfile.findUnique.mockResolvedValue({ id: 'teacher-prof-1' });
      mockPrismaService.payment.findUnique.mockResolvedValue({
        id: paymentId,
        enrollmentId: 'enrollment-1',
        course: { teacherId: 'teacher-prof-1' },
      });
      mockPrismaService.user.findUnique.mockResolvedValue({ role: 'TEACHER' });
      mockPrismaService.payment.updateMany.mockResolvedValue({ count: 1 }); // 1 updated

      const result = await service.acceptPayment(paymentId, teacherUserId);

      expect(result.data.status).toBe(PaymentStatus.ACCEPTED);
      expect(mockPrismaService.enrollment.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ status: EnrollmentStatus.PENDING }),
        data: expect.objectContaining({ status: EnrollmentStatus.ACTIVE }),
      });
      expect(mockPrismaService.paymentAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'ACCEPTED' }),
      });
    });

    it('should throw ConflictException if payment was already reviewed (count === 0)', async () => {
      mockPrismaService.teacherProfile.findUnique.mockResolvedValue({ id: 'teacher-prof-1' });
      mockPrismaService.payment.findUnique.mockResolvedValue({
        id: paymentId,
        enrollmentId: 'enrollment-1',
        course: { teacherId: 'teacher-prof-1' },
      });
      mockPrismaService.user.findUnique.mockResolvedValue({ role: 'TEACHER' });
      mockPrismaService.payment.updateMany.mockResolvedValue({ count: 0 }); // ALREADY REVIEWED

      await expect(service.acceptPayment(paymentId, teacherUserId)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('retryPayment', () => {
    it('should create a new Payment record with fresh orderReference for REJECTED enrollment', async () => {
      const studentUserId = 'user-student-1';
      const enrollmentId = 'enrollment-1';

      mockPrismaService.studentProfile.findUnique.mockResolvedValue({ id: 'student-prof-1' });
      mockPrismaService.enrollment.findUnique.mockResolvedValue({
        id: enrollmentId,
        studentId: 'student-prof-1',
        status: EnrollmentStatus.REJECTED, // REJECTED
        course: {
          id: 'course-1',
          price: '400.00',
          status: CourseStatus.PUBLISHED,
          isDeleted: false,
        },
      });
      mockPrismaService.payment.create.mockResolvedValue({
        id: 'new-payment-id',
        orderReference: 'ORD-NEW999',
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      });

      const result = await service.retryPayment(enrollmentId, studentUserId);

      expect(result.orderReference).toBe('ORD-NEW999');
      expect(mockPrismaService.enrollment.update).toHaveBeenCalledWith({
        where: { id: enrollmentId },
        data: { status: EnrollmentStatus.PENDING },
      });
      expect(mockPrismaService.payment.create).toHaveBeenCalled();
    });
  });
});
