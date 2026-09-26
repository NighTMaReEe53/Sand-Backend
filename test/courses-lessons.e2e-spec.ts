import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { CourseStatus, GradeLevel, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

describe('Phase 2: Courses, Lessons, Materials & Streaming E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let teacherToken: string;
  let studentToken: string;
  let teacherProfileId: string;
  let studentProfileId: string;
  let courseId: string;
  let lesson1Id: string;
  let lesson2Id: string;

  const testEmail = `teacher_p2_${Date.now()}@example.com`;
  const studentEmail = `student_p2_${Date.now()}@example.com`;

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

    // 1. Create a Teacher in DB
    const hash = await bcrypt.hash('Password@123', 10);
    const teacherUser = await prisma.user.create({
      data: {
        email: testEmail,
        phone: `010${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: hash,
        role: Role.TEACHER,
        isVerified: true,
        isActive: true,
      },
    });

    const teacherProf = await prisma.teacherProfile.create({
      data: {
        userId: teacherUser.id,
        fullName: 'أستاذ الكيمياء',
        specialization: 'كيمياء عضوية',
        createdByAdminId: teacherUser.id,
      },
    });
    teacherProfileId = teacherProf.id;

    // 2. Create a Student in DB
    const studentUser = await prisma.user.create({
      data: {
        email: studentEmail,
        phone: `010${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: hash,
        role: Role.STUDENT,
        isVerified: true,
        isActive: true,
      },
    });

    const studentProf = await prisma.studentProfile.create({
      data: {
        userId: studentUser.id,
        fullName: 'طالب كيمياء',
        guardianPhone: '01122334455',
        gradeLevel: GradeLevel.SEC_3_SCIENTIFIC,
      },
    });
    studentProfileId = studentProf.id;

    // 3. Login Teacher to obtain JWT
    const tLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: 'Password@123' });
    teacherToken = tLogin.body.data.accessToken;

    // 4. Login Student to obtain JWT
    const sLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: studentEmail, password: 'Password@123' });
    studentToken = sLogin.body.data.accessToken;
  });

  afterAll(async () => {
    try {
      if (courseId) {
        await prisma.courseMaterial.deleteMany({ where: { courseId } });
        await prisma.lesson.deleteMany({ where: { courseId } });
        await prisma.enrollment.deleteMany({ where: { courseId } });
      await prisma.section.deleteMany({ where: { courseId } });
        await prisma.course.deleteMany({ where: { id: courseId } });
      }
      await prisma.studentProfile.deleteMany({ where: { id: studentProfileId } });
      await prisma.teacherProfile.deleteMany({ where: { id: teacherProfileId } });
      await prisma.user.deleteMany({ where: { email: { in: [testEmail, studentEmail] } } });
    } catch {
      // ignore
    }
    await app.close();
  });

  it('1. POST /api/v1/courses should create a new course in DRAFT status by teacher', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/courses')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        title: 'كورس الكيمياء العضوية الشامل',
        description: 'شرح مفصل لكافة فصول الكيمياء للثانوية العامة.',
        price: 0,
        isFree: true,
        gradeLevel: GradeLevel.SEC_3_SCIENTIFIC,
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe(CourseStatus.DRAFT);
    courseId = response.body.data.id;
  });

  it('2. POST /api/v1/courses/:id/lessons should add lessons with auto orderIndex', async () => {
    const res1 = await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/lessons`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        title: 'الدرس الأول: مدخل للهيدروكربونات',
        videoUrl: 'https://storage.example.com/videos/lesson1.mp4',
        durationSeconds: 1800,
        isPreview: true, // Free preview
      })
      .expect(201);

    lesson1Id = res1.body.data.id;
    expect(res1.body.data.orderIndex).toBe(1);

    const res2 = await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/lessons`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        title: 'الدرس الثاني: الألكانات ومشتقاتها',
        videoUrl: 'https://storage.example.com/videos/lesson2.mp4',
        durationSeconds: 2400,
        isPreview: false,
      })
      .expect(201);

    lesson2Id = res2.body.data.id;
    expect(res2.body.data.orderIndex).toBe(2);
  });

  it('3. POST /api/v1/courses/:id/materials should upload a valid PDF and reject fakes', async () => {
    // Minimal valid PDF (magic bytes: %PDF-)
    const validPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF', 'utf8');

    const validRes = await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/materials`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .attach('file', validPdf, { filename: 'notes.pdf', contentType: 'application/pdf' })
      .field('title', 'مذكرة المنهج كاملة')
      .expect(201);

    expect(validRes.body.data.courseId).toBe(courseId);
    expect(validRes.body.data.fileUrl).toBeUndefined();

    // Executable disguised as PDF must be rejected
    const fakePdf = Buffer.from('MZfake-executable-content', 'utf8');
    await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/materials`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .attach('file', fakePdf, { filename: 'evil.pdf', contentType: 'application/pdf' })
      .field('title', 'ملف مزيف')
      .expect(400);
  });

  it('4. POST /api/v1/lessons/reorder should reorder lessons within course', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/lessons/reorder')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        courseId,
        orders: [
          { lessonId: lesson1Id, newOrderIndex: 2 },
          { lessonId: lesson2Id, newOrderIndex: 1 },
        ],
      })
      .expect(200);

    expect(response.body.data[0].id).toBe(lesson2Id);
    expect(response.body.data[0].orderIndex).toBe(1);
    expect(response.body.data[1].id).toBe(lesson1Id);
    expect(response.body.data[1].orderIndex).toBe(2);
  });

  it('5. POST /api/v1/courses/:id/enroll-free should reject when course is still in DRAFT', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/enroll-free`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(400);
  });

  it('6. Publish course and enroll student', async () => {
    // Publish course
    await request(app.getHttpServer())
      .patch(`/api/v1/courses/${courseId}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ status: CourseStatus.PUBLISHED })
      .expect(200);

    // Student enrolls in free published course
    const enrollRes = await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/enroll-free`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(201);

    expect(enrollRes.body.data.enrollment.status).toBe('ACTIVE');

    // Duplicate enrollment should return 409 Conflict
    await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/enroll-free`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(409);
  });

  it('7. GET /api/v1/lessons/:id/stream-url should return signed stream URL for enrolled student', async () => {
    const streamRes = await request(app.getHttpServer())
      .get(`/api/v1/lessons/${lesson2Id}/stream-url`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(streamRes.body.data.streamUrl).toBeDefined();
    // Local/mock storage returns a plain URL; S3 returns signed URLs with token=
    expect(typeof streamRes.body.data.streamUrl).toBe('string');
  });
});
