import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { GradeLevel, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

describe('All 5 Issues Resolution & Access Control (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: any;

  let teacher1User: any;
  let teacher1Profile: any;
  let teacher2User: any;
  let teacher2Profile: any;
  let studentUser: any;
  let studentProfile: any;

  let tokenT1: string;
  let tokenT2: string;
  let tokenStudent: string;

  let courseAId: string; // Published
  let courseBId: string; // Draft
  let lesson1Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser('verify_secret'));
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const hash = await bcrypt.hash('Password@123', 10);
    const stamp = Date.now();

    // 1. Create Teacher 1 (Owner)
    teacher1User = await prisma.user.create({
      data: {
        email: `t1_${stamp}@test.com`,
        phone: `010${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: hash,
        role: Role.TEACHER,
        isVerified: true,
        isActive: true,
      },
    });

    teacher1Profile = await prisma.teacherProfile.create({
      data: {
        userId: teacher1User.id,
        fullName: 'أ. أحمد السيد (مدرس لغة عربية)',
        specialization: 'لغة عربية - ثانوية عامة',
        bio: 'خبرة 15 عاماً في تدريس النحو والبلاغة للثانوية العامة',
        createdByAdminId: teacher1User.id,
      },
    });

    // 2. Create Teacher 2 (Different Teacher)
    teacher2User = await prisma.user.create({
      data: {
        email: `t2_${stamp}@test.com`,
        phone: `010${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: hash,
        role: Role.TEACHER,
        isVerified: true,
        isActive: true,
      },
    });

    teacher2Profile = await prisma.teacherProfile.create({
      data: {
        userId: teacher2User.id,
        fullName: 'أ. محمود فؤاد (مدرس فيزياء)',
        specialization: 'فيزياء - ثانوية عامة',
        createdByAdminId: teacher2User.id,
      },
    });

    // 3. Create Student
    studentUser = await prisma.user.create({
      data: {
        email: `stu_${stamp}@test.com`,
        phone: `010${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: hash,
        role: Role.STUDENT,
        isVerified: true,
        isActive: true,
      },
    });

    studentProfile = await prisma.studentProfile.create({
      data: {
        userId: studentUser.id,
        fullName: 'محمد علي (طالب)',
        guardianPhone: '01199887766',
        gradeLevel: GradeLevel.SEC_1,
      },
    });

    // Logins
    const t1Login = await request(server).post('/api/v1/auth/login').send({ email: teacher1User.email, password: 'Password@123' });
    tokenT1 = t1Login.body.data.accessToken;

    const t2Login = await request(server).post('/api/v1/auth/login').send({ email: teacher2User.email, password: 'Password@123' });
    tokenT2 = t2Login.body.data.accessToken;

    const sLogin = await request(server).post('/api/v1/auth/login').send({ email: studentUser.email, password: 'Password@123' });
    tokenStudent = sLogin.body.data.accessToken;

    // Create Course A (Published)
    const c1Res = await request(server)
      .post('/api/v1/courses')
      .set('Authorization', `Bearer ${tokenT1}`)
      .send({
        title: 'كورس النحو الشامل',
        description: 'شرح تفصيلي لمنهج النحو للثانوية العامة',
        price: 0,
        isFree: true,
        gradeLevel: GradeLevel.SEC_1,
      });
    courseAId = c1Res.body.data.id;

    await request(server)
      .patch(`/api/v1/courses/${courseAId}`)
      .set('Authorization', `Bearer ${tokenT1}`)
      .send({ status: 'PUBLISHED' });

    // Create Course B (DRAFT)
    const c2Res = await request(server)
      .post('/api/v1/courses')
      .set('Authorization', `Bearer ${tokenT1}`)
      .send({
        title: 'كورس البلاغة والأدب (مسودة)',
        description: 'كورس تحت الإعداد',
        price: 150,
        isFree: false,
        gradeLevel: GradeLevel.SEC_1,
      });
    courseBId = c2Res.body.data.id;

    // Add Lesson 1 to Course A (Non-preview video)
    const l1Res = await request(server)
      .post(`/api/v1/courses/${courseAId}/lessons`)
      .set('Authorization', `Bearer ${tokenT1}`)
      .send({
        title: 'الحصة الأولى: كان وأخواتها بالتفصيل',
        description: 'شرح الأفعال الناسخة وحالاتها',
        videoUrl: 'http://localhost:3000/uploads/videos/grammar_lesson1.mp4',
        durationSeconds: 2400,
        isPreview: false,
      });
    lesson1Id = l1Res.body.data.id;
  }, 60000);

  afterAll(async () => {
    if (courseAId && courseBId) {
      await prisma.attemptAnswer.deleteMany({ where: { question: { exam: { courseId: { in: [courseAId, courseBId] } } } } });
      await prisma.examAttempt.deleteMany({ where: { exam: { courseId: { in: [courseAId, courseBId] } } } });
      await prisma.question.deleteMany({ where: { exam: { courseId: { in: [courseAId, courseBId] } } } });
      await prisma.exam.deleteMany({ where: { courseId: { in: [courseAId, courseBId] } } });
      await prisma.progress.deleteMany({ where: { lesson: { courseId: { in: [courseAId, courseBId] } } } });
      await prisma.lesson.deleteMany({ where: { courseId: { in: [courseAId, courseBId] } } });
      await prisma.courseMaterial.deleteMany({ where: { courseId: { in: [courseAId, courseBId] } } });
      await prisma.paymentAuditLog.deleteMany({ where: { payment: { courseId: { in: [courseAId, courseBId] } } } });
      await prisma.payment.deleteMany({ where: { courseId: { in: [courseAId, courseBId] } } });
      await prisma.enrollment.deleteMany({ where: { courseId: { in: [courseAId, courseBId] } } });
      await prisma.section.deleteMany({ where: { courseId: { in: [courseAId, courseBId] } } });
      await prisma.course.deleteMany({ where: { id: { in: [courseAId, courseBId] } } });
    }
    if (studentUser) await prisma.studentProfile.deleteMany({ where: { userId: studentUser.id } });
    if (teacher1User || teacher2User) {
      await prisma.teacherProfile.deleteMany({ where: { userId: { in: [teacher1User.id, teacher2User.id] } } });
      await prisma.userSession.deleteMany({ where: { userId: { in: [teacher1User.id, teacher2User.id, studentUser.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [teacher1User.id, teacher2User.id, studentUser.id] } } });
    }
    await app.close();
  });

  describe('Issue 1: Teacher Viewing Own Lesson Video', () => {
    it('should allow teacher owner to get signed stream url for non-preview video in their own course', async () => {
      const res = await request(server)
        .get(`/api/v1/lessons/${lesson1Id}/stream-url`)
        .set('Authorization', `Bearer ${tokenT1}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.lessonId).toBe(lesson1Id);
      expect(res.body.data.streamUrl).toBeDefined();
      expect(res.body.data.streamUrl).toContain('http');
    });

    it('should forbid a different teacher from streaming non-preview video of another teacher course', async () => {
      const res = await request(server)
        .get(`/api/v1/lessons/${lesson1Id}/stream-url`)
        .set('Authorization', `Bearer ${tokenT2}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Issue 2: Course List isOwner & isEnrolled Flags', () => {
    it('should return isOwner: true for teacher on their own course in GET /courses', async () => {
      const res = await request(server)
        .get('/api/v1/courses')
        .set('Authorization', `Bearer ${tokenT1}`);

      expect(res.status).toBe(200);
      const course = res.body.data.courses.find((c: any) => c.id === courseAId);
      expect(course).toBeDefined();
      expect(course.isOwner).toBe(true);
      expect(course.isEnrolled).toBe(false);
    });

    it('should return isEnrolled: false before student enrolls and isEnrolled: true after enrollment', async () => {
      // Before enrollment
      const resPre = await request(server)
        .get('/api/v1/courses')
        .set('Authorization', `Bearer ${tokenStudent}`);
      const coursePre = resPre.body.data.courses.find((c: any) => c.id === courseAId);
      expect(coursePre.isOwner).toBe(false);
      expect(coursePre.isEnrolled).toBe(false);

      // Enroll
      await request(server)
        .post(`/api/v1/courses/${courseAId}/enroll-free`)
        .set('Authorization', `Bearer ${tokenStudent}`);

      // After enrollment
      const resPost = await request(server)
        .get('/api/v1/courses')
        .set('Authorization', `Bearer ${tokenStudent}`);
      const coursePost = resPost.body.data.courses.find((c: any) => c.id === courseAId);
      expect(coursePost.isOwner).toBe(false);
      expect(coursePost.isEnrolled).toBe(true);
    });
  });

  describe('Issue 3: Teacher Dashboard Counters & Stats', () => {
    it('should return exact course count matching database for teacher dashboard', async () => {
      const res = await request(server)
        .get('/api/v1/dashboard/teacher')
        .set('Authorization', `Bearer ${tokenT1}`);

      expect(res.status).toBe(200);
      expect(res.body.data.overview.totalCourses).toBe(2);
      expect(res.body.data.overview.publishedCourses).toBe(1);
      expect(res.body.data.overview.draftCourses).toBe(1);

      const dbCount = await prisma.course.count({
        where: { teacherId: teacher1Profile.id, isDeleted: false },
      });
      expect(res.body.data.overview.totalCourses).toBe(dbCount);
    });
  });

  describe('Issue 4: Unified Course Access & Management Security', () => {
    it('should block unauthorized teacher from modifying another teacher course contents', async () => {
      // Attempt to create lesson
      const lessonRes = await request(server)
        .post(`/api/v1/courses/${courseAId}/lessons`)
        .set('Authorization', `Bearer ${tokenT2}`)
        .send({ title: 'Unauthorized' });
      expect(lessonRes.status).toBe(403);

      // Attempt to update course
      const updateRes = await request(server)
        .patch(`/api/v1/courses/${courseAId}`)
        .set('Authorization', `Bearer ${tokenT2}`)
        .send({ title: 'Hacked' });
      expect(updateRes.status).toBe(403);

      // Attempt to create exam
      const examRes = await request(server)
        .post(`/api/v1/courses/${courseAId}/exams`)
        .set('Authorization', `Bearer ${tokenT2}`)
        .send({ title: 'Unauthorized Exam', durationMinutes: 30 });
      // Non-owner gets 404 (does not leak course existence) or 403
      expect([403, 404]).toContain(examRes.status);
    });
  });

  describe('Issue 5: Public Teacher Profile Endpoint', () => {
    it('should return teacher profile with published courses and precalculated statistics for public guest', async () => {
      const res = await request(server)
        .get(`/api/v1/teachers/${teacher1Profile.id}/profile`);

      expect(res.status).toBe(200);
      expect(res.body.data.fullName).toBe('أ. أحمد السيد (مدرس لغة عربية)');
      expect(res.body.data.specialization).toBe('لغة عربية - ثانوية عامة');
      expect(res.body.data.totalCourses).toBe(1); // Only published for public
      expect(res.body.data.courses[0].id).toBe(courseAId);
    });

    it('should return all courses including DRAFT when teacher requests their own profile', async () => {
      const res = await request(server)
        .get(`/api/v1/teachers/${teacher1Profile.id}/profile`)
        .set('Authorization', `Bearer ${tokenT1}`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalCourses).toBe(2); // Both published and draft
    });

    it('should support querying profile by user.id as well', async () => {
      const res = await request(server)
        .get(`/api/v1/teachers/${teacher1User.id}/profile`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(teacher1Profile.id);
    });
  });
});
