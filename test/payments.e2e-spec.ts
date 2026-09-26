import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { CourseStatus, GradeLevel, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

describe('Phase 3: Payments & Subscriptions (Vodafone Cash) E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let teacherToken: string;
  let otherTeacherToken: string;
  let studentToken: string;

  let teacherProfileId: string;
  let otherTeacherProfileId: string;
  let studentProfileId: string;

  let teacherUserId: string;
  let otherTeacherUserId: string;
  let studentUserId: string;

  let paidCourseId: string;
  let paymentId: string;
  let enrollmentId: string;

  const stamp = Date.now();
  const teacherEmail = `p3_teacher_${stamp}@test.com`;
  const otherTeacherEmail = `p3_other_${stamp}@test.com`;
  const studentEmail = `p3_student_${stamp}@test.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser('test_secret'));
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    const hash = await bcrypt.hash('Password@123', 10);

    // 1. Teacher 1
    const tUser = await prisma.user.create({
      data: {
        email: teacherEmail,
        phone: `010${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: hash,
        role: Role.TEACHER,
        isVerified: true,
      },
    });
    teacherUserId = tUser.id;

    const tProf = await prisma.teacherProfile.create({
      data: {
        userId: tUser.id,
        fullName: 'أستاذ الرياضيات (Phase 3)',
        specialization: 'تفاضل وتكامل',
        createdByAdminId: tUser.id,
      },
    });
    teacherProfileId = tProf.id;

    // 2. Teacher 2 (Other Teacher)
    const oUser = await prisma.user.create({
      data: {
        email: otherTeacherEmail,
        phone: `010${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: hash,
        role: Role.TEACHER,
        isVerified: true,
      },
    });
    otherTeacherUserId = oUser.id;

    const oProf = await prisma.teacherProfile.create({
      data: {
        userId: oUser.id,
        fullName: 'أستاذ آخر (Phase 3)',
        specialization: 'جيولوجيا',
        createdByAdminId: oUser.id,
      },
    });
    otherTeacherProfileId = oProf.id;

    // 3. Student
    const sUser = await prisma.user.create({
      data: {
        email: studentEmail,
        phone: `010${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: hash,
        role: Role.STUDENT,
        isVerified: true,
      },
    });
    studentUserId = sUser.id;

    const sProf = await prisma.studentProfile.create({
      data: {
        userId: sUser.id,
        fullName: 'طالب المدفوعات',
        guardianPhone: '01155667788',
        gradeLevel: GradeLevel.SEC_3_SCIENTIFIC,
      },
    });
    studentProfileId = sProf.id;

    // Logins
    const tLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: teacherEmail, password: 'Password@123' });
    teacherToken = tLogin.body.data.accessToken;

    const oLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: otherTeacherEmail, password: 'Password@123' });
    otherTeacherToken = oLogin.body.data.accessToken;

    const sLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: studentEmail, password: 'Password@123' });
    studentToken = sLogin.body.data.accessToken;

    // Create a paid course published by Teacher 1
    const courseRes = await request(app.getHttpServer())
      .post('/api/v1/courses')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        title: 'كورس التفاضل والتكامل المتقدم',
        description: 'شرح مكثف لمنهج التفاضل والتكامل للصف الثالث الثانوي.',
        price: 250,
        isFree: false,
        gradeLevel: GradeLevel.SEC_3_SCIENTIFIC,
        status: CourseStatus.PUBLISHED,
      });
    paidCourseId = courseRes.body.data.id;
  });

  afterAll(async () => {
    try {
      if (paidCourseId) {
        await prisma.paymentAuditLog.deleteMany({ where: { user: { id: { in: [studentUserId, teacherUserId, otherTeacherUserId] } } } });
        await prisma.payment.deleteMany({ where: { courseId: paidCourseId } });
        await prisma.enrollment.deleteMany({ where: { courseId: paidCourseId } });
        await prisma.course.deleteMany({ where: { id: paidCourseId } });
      }
      await prisma.studentProfile.deleteMany({ where: { id: studentProfileId } });
      await prisma.teacherProfile.deleteMany({ where: { id: { in: [teacherProfileId, otherTeacherProfileId] } } });
      await prisma.user.deleteMany({ where: { id: { in: [teacherUserId, otherTeacherUserId, studentUserId] } } });
    } catch {
      // ignore
    }
    await app.close();
  });

  it('1. POST /payments/checkout should initiate checkout with server-calculated amount', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments/checkout')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ courseId: paidCourseId })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.amount).toBe(250);
    expect(res.body.data.orderReference).toContain('ORD-');
    expect(res.body.data.vodafoneCashNumber).toBeDefined();

    paymentId = res.body.data.paymentId;
    enrollmentId = res.body.data.enrollmentId;
  });

  it('2. POST /payments/checkout should return 409 Conflict if duplicate checkout is attempted', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/payments/checkout')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ courseId: paidCourseId })
      .expect(409);
  });

  it('3. POST /payments/:id/submit-receipt should accept valid receipt upload and compute SHA-256 hash', async () => {
    const fakeImageBuffer = Buffer.from('TEST_RECEIPT_IMAGE_CONTENT_ABC_123');

    const res = await request(app.getHttpServer())
      .post(`/api/v1/payments/${paymentId}/submit-receipt`)
      .set('Authorization', `Bearer ${studentToken}`)
      .attach('receipt', fakeImageBuffer, 'receipt.jpg')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.payment.receiptImageUrl).toBeDefined();
    expect(res.body.data.payment.receiptImageHash).toBeDefined();
  });

  it('4. POST /payments/:id/accept should forbid unauthorized teacher (IDOR prevention)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/payments/${paymentId}/accept`)
      .set('Authorization', `Bearer ${otherTeacherToken}`) // OTHER TEACHER
      .expect(403);
  });

  it('5. PATCH /payments/:id/accept should allow course owner teacher and activate student enrollment', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/payments/${paymentId}/accept`)
      .set('Authorization', `Bearer ${teacherToken}`) // OWNER
      .expect(200);

    expect(res.body.success).toBe(true);

    // Verify Enrollment status is ACTIVE in DB
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
    });
    expect(enrollment?.status).toBe('ACTIVE');
    expect(enrollment?.activatedAt).toBeDefined();
  });

  it('6. Double-accept should return 409 Conflict (Optimistic Lock)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/payments/${paymentId}/accept`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(409);
  });
});
