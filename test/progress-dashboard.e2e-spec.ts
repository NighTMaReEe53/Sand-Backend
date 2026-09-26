import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { CourseStatus, GradeLevel, PaymentStatus, Role } from '@prisma/client';

describe('Progress & Dashboards E2E (Phase 5)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const ts = Date.now();
  const adminEmail = `admin_dash_${ts}@example.com`;
  const teacherEmail = `teacher_dash_${ts}@example.com`;
  const studentEmail = `student_dash_${ts}@example.com`;
  const otherStudentEmail = `other_student_dash_${ts}@example.com`;
  const password = 'Password@123';

  let teacherToken: string;
  let studentToken: string;
  let otherStudentToken: string;
  let adminToken: string;

  let courseId: string;
  let lessonId1: string;
  let lessonId2: string;

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

    prisma = app.get<PrismaService>(PrismaService);
    const hash = await bcrypt.hash(password, 10);

    // 1. Admin
    await prisma.user.create({
      data: {
        email: adminEmail,
        phone: `015${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: hash,
        role: Role.ADMIN,
        isVerified: true,
      },
    });

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password });
    adminToken = adminLogin.body.data.accessToken;

    // 2. Teacher
    const tUser = await prisma.user.create({
      data: {
        email: teacherEmail,
        phone: `012${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: hash,
        role: Role.TEACHER,
        isVerified: true,
      },
    });

    const tProf = await prisma.teacherProfile.create({
      data: {
        userId: tUser.id,
        fullName: 'أستاذ الداشبورد',
        specialization: 'أحياء وجيولوجيا',
        createdByAdminId: tUser.id,
      },
    });

    // 3. Enrolled Student
    const sUser = await prisma.user.create({
      data: {
        email: studentEmail,
        phone: `011${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: hash,
        role: Role.STUDENT,
        isVerified: true,
      },
    });

    const sProf = await prisma.studentProfile.create({
      data: {
        userId: sUser.id,
        fullName: 'طالب التقدم',
        guardianPhone: '01011223344',
        gradeLevel: GradeLevel.SEC_3_SCIENTIFIC,
      },
    });

    // 4. Non-enrolled Student
    const oUser = await prisma.user.create({
      data: {
        email: otherStudentEmail,
        phone: `011${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: hash,
        role: Role.STUDENT,
        isVerified: true,
      },
    });

    await prisma.studentProfile.create({
      data: {
        userId: oUser.id,
        fullName: 'طالب غير مشترك',
        guardianPhone: '01099887766',
        gradeLevel: GradeLevel.SEC_3_SCIENTIFIC,
      },
    });

    // Logins
    const tLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: teacherEmail, password });
    teacherToken = tLogin.body.data.accessToken;

    const sLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: studentEmail, password });
    studentToken = sLogin.body.data.accessToken;

    const oLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: otherStudentEmail, password });
    otherStudentToken = oLogin.body.data.accessToken;

    // Create a course with 2 lessons
    const courseRes = await request(app.getHttpServer())
      .post('/api/v1/courses')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        title: `كورس الأحياء الشامل ${ts}`,
        description: 'شرح مادة الأحياء للصف الثالث الثانوي',
        gradeLevel: GradeLevel.SEC_3_SCIENTIFIC,
        price: 0,
        isFree: true,
        status: CourseStatus.PUBLISHED,
      });
    courseId = courseRes.body.data.id;

    const l1Res = await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/lessons`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        title: 'الدرس الأول: الدعامة في النبات',
        description: 'شرح الدعامة الفسيولوجية والتركيبية',
        durationSeconds: 1200,
        orderIndex: 1,
        videoUrl: 'lessons/lesson1/master.m3u8',
      });
    lessonId1 = l1Res.body.data.id;

    const l2Res = await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/lessons`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        title: 'الدرس الثاني: الحركة في النبات',
        description: 'أنواع الحركة في الكائنات الحية',
        durationSeconds: 1500,
        orderIndex: 2,
        videoUrl: 'lessons/lesson2/master.m3u8',
      });
    lessonId2 = l2Res.body.data.id;

    // Student enrolls
    await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/enroll-free`)
      .set('Authorization', `Bearer ${studentToken}`);
  });

  afterAll(async () => {
    if (courseId) {
      await prisma.progress.deleteMany({ where: { lesson: { courseId } } });
      await prisma.lesson.deleteMany({ where: { courseId } });
      await prisma.enrollment.deleteMany({ where: { courseId } });
      await prisma.section.deleteMany({ where: { courseId } });
      await prisma.course.deleteMany({ where: { id: courseId } });
    }
    await prisma.studentProfile.deleteMany({ where: { user: { email: { in: [studentEmail, otherStudentEmail] } } } });
    await prisma.teacherProfile.deleteMany({ where: { user: { email: teacherEmail } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, teacherEmail, studentEmail, otherStudentEmail] } } });
    await app.close();
  });

  // ─────────────────────────────────────────────────────────────
  describe('POST /lessons/:id/progress — [STUDENT] Progress Tracking', () => {
    it('should record partial progress (45%) without completion', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/lessons/${lessonId1}/progress`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ watchedPercentage: 45 })
        .expect(200);

      const progress = res.body.data.progress;
      expect(progress.watchedPercentage).toBe(45);
      expect(progress.isCompleted).toBe(false);
    });

    it('should auto-mark lesson as completed when watchedPercentage >= 90', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/lessons/${lessonId1}/progress`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ watchedPercentage: 92 })
        .expect(200);

      const progress = res.body.data.progress;
      expect(progress.watchedPercentage).toBe(92);
      expect(progress.isCompleted).toBe(true);
    });

    it('should prevent progress regression (never decrease from 92% to 30%)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/lessons/${lessonId1}/progress`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ watchedPercentage: 30 })
        .expect(200);

      const progress = res.body.data.progress;
      expect(progress.watchedPercentage).toBe(92); // Stays at highest
      expect(progress.isCompleted).toBe(true);
    });

    it('should reject non-enrolled student with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/lessons/${lessonId1}/progress`)
        .set('Authorization', `Bearer ${otherStudentToken}`)
        .send({ watchedPercentage: 50 })
        .expect(403);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('GET /courses/:id/progress — [STUDENT] Course Progress Breakdown', () => {
    it('should return 50% course progress (1 of 2 lessons completed)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/courses/${courseId}/progress`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const data = res.body.data;
      expect(data.totalLessons).toBe(2);
      expect(data.completedLessons).toBe(1);
      expect(data.courseProgressPercentage).toBe(50);
      expect(data.isCourseCompleted).toBe(false);
      expect(data.lessons).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('GET /dashboard/student — [STUDENT] Student Dashboard', () => {
    it('should return aggregated student stats and enrolled courses with progress', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/dashboard/student')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const data = res.body.data;
      expect(data.student).toBeDefined();
      expect(data.stats.totalEnrolledCourses).toBe(1);
      expect(data.enrolledCourses).toHaveLength(1);
      expect(data.enrolledCourses[0].progressPercentage).toBe(50);
      expect(data.enrolledCourses[0].lastWatchedLesson).toBeDefined();
      expect(data.enrolledCourses[0].lastWatchedLesson.title).toBe('الدرس الأول: الدعامة في النبات');
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('GET /dashboard/teacher — [TEACHER] Teacher Dashboard', () => {
    it('should return teacher overview, courses performance, and recent activity', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/dashboard/teacher')
        .set('Authorization', `Bearer ${teacherToken}`)
        .expect(200);

      const data = res.body.data;
      expect(data.overview).toBeDefined();
      expect(data.overview.totalCourses).toBeGreaterThanOrEqual(1);
      expect(data.overview.totalUniqueStudents).toBeGreaterThanOrEqual(1);
      expect(data.courses).toBeDefined();
      expect(data.recentActivity).toBeDefined();
    });

    it('should reject non-teacher with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/dashboard/teacher')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('GET /dashboard/admin — [ADMIN] Admin Dashboard', () => {
    it('should return platform-wide metrics and user breakdowns', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/dashboard/admin')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const data = res.body.data;
      expect(data.users).toBeDefined();
      expect(data.users.total).toBeGreaterThanOrEqual(3);
      expect(data.courses).toBeDefined();
      expect(data.financials).toBeDefined();
      expect(data.recentRegistrations).toBeDefined();
    });

    it('should reject student from accessing admin dashboard with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/dashboard/admin')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);
    });
  });
});
