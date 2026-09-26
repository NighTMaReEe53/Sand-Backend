import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { CourseStatus, GradeLevel, MaterialType, Role } from '@prisma/client';

describe('Phase 2 Rigorous Verification Suite', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let teacherToken: string;
  let studentToken: string;
  let nonEnrolledStudentToken: string;
  let teacherUserId: string;
  let studentUserId: string;
  let nonEnrolledUserId: string;

  let courseId: string;
  let lesson1Id: string; // isPreview = true
  let lesson2Id: string; // isPreview = false

  const timestamp = Date.now();
  const teacherEmail = `v_teacher_${timestamp}@test.com`;
  const studentEmail = `v_student_${timestamp}@test.com`;
  const nonEnrolledEmail = `v_other_${timestamp}@test.com`;

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

    // 1. Create Teacher
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

    await prisma.teacherProfile.create({
      data: {
        userId: tUser.id,
        fullName: 'أستاذ التحقق',
        specialization: 'فيزياء',
        createdByAdminId: tUser.id,
      },
    });

    // 2. Create Enrolled Student
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

    await prisma.studentProfile.create({
      data: {
        userId: sUser.id,
        fullName: 'طالب مشترك',
        guardianPhone: '01199887766',
        gradeLevel: GradeLevel.SEC_3_SCIENTIFIC,
      },
    });

    // 3. Create Non-Enrolled Student
    const oUser = await prisma.user.create({
      data: {
        email: nonEnrolledEmail,
        phone: `010${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: hash,
        role: Role.STUDENT,
        isVerified: true,
      },
    });
    nonEnrolledUserId = oUser.id;

    await prisma.studentProfile.create({
      data: {
        userId: oUser.id,
        fullName: 'طالب غير مشترك',
        guardianPhone: '01122334455',
        gradeLevel: GradeLevel.SEC_3_SCIENTIFIC,
      },
    });

    // Logins
    const tLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: teacherEmail, password: 'Password@123' });
    teacherToken = tLogin.body.data.accessToken;

    const sLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: studentEmail, password: 'Password@123' });
    studentToken = sLogin.body.data.accessToken;

    const oLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: nonEnrolledEmail, password: 'Password@123' });
    nonEnrolledStudentToken = oLogin.body.data.accessToken;
  });

  afterAll(async () => {
    try {
      if (courseId) {
        await prisma.courseMaterial.deleteMany({ where: { courseId } });
        await prisma.lesson.deleteMany({ where: { courseId } });
        await prisma.enrollment.deleteMany({ where: { courseId } });
        await prisma.course.deleteMany({ where: { id: courseId } });
      }
      await prisma.studentProfile.deleteMany({ where: { userId: { in: [studentUserId, nonEnrolledUserId] } } });
      await prisma.teacherProfile.deleteMany({ where: { userId: teacherUserId } });
      await prisma.user.deleteMany({ where: { email: { in: [teacherEmail, studentEmail, nonEnrolledEmail] } } });
    } catch {
      // ignore
    }
    await app.close();
  });

  describe('Point 3: XOR on Material Proof', () => {
    it('3a. Neither courseId nor lessonId -> 400 Bad Request', async () => {
      // Create draft course first
      const cRes = await request(app.getHttpServer())
        .post('/api/v1/courses')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({
          title: 'كورس التحقق من XOR',
          description: 'وصف كورس تجريبي لاختبارات التحقق.',
          gradeLevel: GradeLevel.SEC_3_SCIENTIFIC,
          isFree: true,
        });
      courseId = cRes.body.data.id;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/courses/${courseId}/materials`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({
          title: 'مذكرة بدون ربط',
          fileUrl: 'https://storage.example.com/file.pdf',
          fileType: MaterialType.PDF,
          // NEITHER courseId NOR lessonId
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('XOR Constraint Error');
    });

    it('3b. Both courseId and lessonId -> 400 Bad Request', async () => {
      // Create lesson
      const lRes = await request(app.getHttpServer())
        .post(`/api/v1/courses/${courseId}/lessons`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({
          title: 'الدرس الأول',
          videoUrl: 'https://storage.example.com/videos/v1.mp4',
          isPreview: true,
        });
      lesson1Id = lRes.body.data.id;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/courses/${courseId}/materials`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({
          title: 'مذكرة بربط مزدوج',
          fileUrl: 'https://storage.example.com/file.pdf',
          courseId,
          lessonId: lesson1Id, // BOTH
          fileType: MaterialType.PDF,
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('XOR Constraint Error');
    });
  });

  describe('Point 4: Presigned Direct Upload & Upload Proof', () => {
    it('4a. POST /lessons/:id/video-upload-url returns presigned URL and fields', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/lessons/${lesson1Id}/video-upload-url?fileName=physics_lesson.mp4&contentType=video/mp4`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .expect(200);

      expect(res.body.data.uploadUrl).toBeDefined();
      expect(res.body.data.expiresInSeconds).toBe(1800);
      expect(res.body.data.key).toContain('videos/');

      // Test direct upload to the generated uploadUrl
      const uploadUrl = res.body.data.uploadUrl;
      const urlObj = new URL(uploadUrl);
      const pathnameAndQuery = `${urlObj.pathname}${urlObj.search}`;

      const uploadRes = await request(app.getHttpServer())
        .put(pathnameAndQuery)
        .set('Content-Type', 'video/mp4')
        .send(Buffer.from('fake video binary content stream'))
        .expect(200);

      expect(uploadRes.body.success).toBe(true);
    });
  });

  describe('Point 5: enroll-free 3 Conditions Proof', () => {
    it('5a. Reject enrollment when course is in DRAFT -> 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/courses/${courseId}/enroll-free`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(400);

      expect(res.body.message).toContain('Cannot enroll in a course that is not published yet');
    });

    it('5b. Reject enrollment when course is PAID -> 400 Bad Request', async () => {
      // Publish as paid
      await request(app.getHttpServer())
        .patch(`/api/v1/courses/${courseId}`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ status: CourseStatus.PUBLISHED, isFree: false, price: 250 })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/courses/${courseId}/enroll-free`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(400);

      expect(res.body.message).toContain('This is a paid course');
    });

    it('5c. Double enrollment in published free course -> 409 Conflict', async () => {
      // Make free and published
      await request(app.getHttpServer())
        .patch(`/api/v1/courses/${courseId}`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ isFree: true, price: 0 })
        .expect(200);

      // First enrollment -> 201
      const res1 = await request(app.getHttpServer())
        .post(`/api/v1/courses/${courseId}/enroll-free`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(201);

      expect(res1.body.data.enrollment.status).toBe('ACTIVE');

      // Second enrollment -> 409 Conflict
      const res2 = await request(app.getHttpServer())
        .post(`/api/v1/courses/${courseId}/enroll-free`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(409);

      expect(res2.body.message).toContain('Already enrolled in this course');
    });
  });

  describe('Point 6: 4 stream-url Cases Proof', () => {
    it('6a. Course Owner -> 200 OK', async () => {
      // Add Lesson 2 (paid, isPreview = false)
      const l2 = await request(app.getHttpServer())
        .post(`/api/v1/courses/${courseId}/lessons`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({
          title: 'الدرس الثاني (مدفوع)',
          videoUrl: 'https://storage.example.com/videos/v2.mp4',
          isPreview: false,
        });
      lesson2Id = l2.body.data.id;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/lessons/${lesson2Id}/stream-url`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .expect(200);

      expect(res.body.data.streamUrl).toBeDefined();
    });

    it('6b. Non-enrolled student on isPreview: true -> 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/lessons/${lesson1Id}/stream-url`)
        .set('Authorization', `Bearer ${nonEnrolledStudentToken}`)
        .expect(200);

      expect(res.body.data.streamUrl).toBeDefined();
      expect(res.body.data.isPreview).toBe(true);
    });

    it('6c. Non-enrolled student on isPreview: false -> 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/lessons/${lesson2Id}/stream-url`)
        .set('Authorization', `Bearer ${nonEnrolledStudentToken}`)
        .expect(403);

      expect(res.body.message).toContain('Access denied. You must have an active enrollment');
    });

    it('6d. Enrolled student on isPreview: false -> 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/lessons/${lesson2Id}/stream-url`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect(res.body.data.streamUrl).toBeDefined();
      expect(res.body.data.expiresInSeconds).toBe(600);
    });
  });
});
