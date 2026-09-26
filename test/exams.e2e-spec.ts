import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { GradeLevel, Role, CourseStatus } from '@prisma/client';

describe('Exams E2E — نظام الامتحانات', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const ts = Date.now();

  const teacherEmail = `teacher_exams_${ts}@example.com`;
  const studentEmail = `student_exams_${ts}@example.com`;
  const password = 'Password@123';

  let teacherAccessToken: string;
  let studentAccessToken: string;
  let courseId: string;
  let examId: string;
  let questionId1: string;
  let questionId2: string;
  let attemptId: string;

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

    // 1. Teacher
    const tUser = await prisma.user.create({
      data: {
        email: teacherEmail,
        phone: `012${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: hash,
        role: Role.TEACHER,
        isVerified: true,
      },
    });

    await prisma.teacherProfile.create({
      data: {
        userId: tUser.id,
        fullName: 'مدرس الامتحانات E2E',
        specialization: 'فيزياء',
        createdByAdminId: tUser.id,
      },
    });

    // 2. Student
    const sUser = await prisma.user.create({
      data: {
        email: studentEmail,
        phone: `011${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: hash,
        role: Role.STUDENT,
        isVerified: true,
      },
    });

    await prisma.studentProfile.create({
      data: {
        userId: sUser.id,
        fullName: 'طالب امتحانات E2E',
        guardianPhone: '01033445566',
        gradeLevel: GradeLevel.SEC_2,
      },
    });

    // Logins
    const tLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: teacherEmail, password });
    teacherAccessToken = tLogin.body.data.accessToken;

    const sLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: studentEmail, password });
    studentAccessToken = sLogin.body.data.accessToken;

    // Teacher creates a published course
    const courseRes = await request(app.getHttpServer())
      .post('/api/v1/courses')
      .set('Authorization', `Bearer ${teacherAccessToken}`)
      .send({
        title: `كورس الامتحانات E2E ${ts}`,
        description: 'كورس لاختبار نظام الامتحانات',
        gradeLevel: GradeLevel.SEC_2,
        price: 0,
        isFree: true,
        status: CourseStatus.PUBLISHED,
      });
    courseId = courseRes.body.data.id;

    // Student enrolls (free course)
    await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/enroll-free`)
      .set('Authorization', `Bearer ${studentAccessToken}`)
      .expect(201);
  });

  afterAll(async () => {
    // Cleanup: remove test data
    if (examId) {
      await prisma.attemptAnswer.deleteMany({ where: { attempt: { examId } } });
      await prisma.examAttempt.deleteMany({ where: { examId } });
      await prisma.question.deleteMany({ where: { examId } });
      await prisma.exam.deleteMany({ where: { id: examId } });
    }
    if (courseId) {
      await prisma.enrollment.deleteMany({ where: { courseId } });
      await prisma.course.deleteMany({ where: { id: courseId } });
    }
    await prisma.teacherProfile.deleteMany({ where: { user: { email: teacherEmail } } });
    await prisma.studentProfile.deleteMany({ where: { user: { email: studentEmail } } });
    await prisma.user.deleteMany({ where: { email: { in: [teacherEmail, studentEmail] } } });
    await app.close();
  });

  // ─────────────────────────────────────────────────────────────
  describe('POST /courses/:courseId/exams — [TEACHER] Create Exam', () => {
    it('should create a published exam with 45 min duration', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/courses/${courseId}/exams`)
        .set('Authorization', `Bearer ${teacherAccessToken}`)
        .send({
          title: 'امتحان الفيزياء الكهربية',
          description: 'يغطي قانون أوم وكيرشوف',
          durationMinutes: 45,
          totalMarks: 20,
          passingMarks: 10,
          maxAttempts: 2,
          shuffleQuestions: false,
          showCorrectAnswersAfterSubmission: true,
          isPublished: true,
        })
        .expect(201);

      examId = res.body?.data?.exam?.id ?? res.body?.exam?.id;
      expect(examId).toBeDefined();
      expect(res.body?.data?.exam?.title ?? res.body?.exam?.title).toBe('امتحان الفيزياء الكهربية');
    });

    it('should return 403 if student tries to create exam', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/courses/${courseId}/exams`)
        .set('Authorization', `Bearer ${studentAccessToken}`)
        .send({ title: 'محاولة', durationMinutes: 30 })
        .expect(403);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('POST /exams/:id/questions — [TEACHER] Add Questions', () => {
    it('should add first question (q-1) with correct answer index 1', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/exams/${examId}/questions`)
        .set('Authorization', `Bearer ${teacherAccessToken}`)
        .send({
          text: 'ما هي وحدة قياس شدة التيار الكهربي؟',
          options: ['الفولت', 'الأمبير', 'الأوم', 'الوات'],
          correctOptionIndex: 1, // الأمبير
          explanation: 'الأمبير هو وحدة شدة التيار في النظام الدولي.',
          marks: 10,
        })
        .expect(201);

      questionId1 = res.body?.data?.question?.id ?? res.body?.question?.id;
      expect(questionId1).toBeDefined();
    });

    it('should add second question (q-2) with correct answer index 2', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/exams/${examId}/questions`)
        .set('Authorization', `Bearer ${teacherAccessToken}`)
        .send({
          text: 'ما هي وحدة قياس المقاومة الكهربية؟',
          options: ['الفولت', 'الأمبير', 'الأوم', 'الوات'],
          correctOptionIndex: 2, // الأوم
          explanation: 'الأوم هو وحدة قياس المقاومة الكهربية.',
          marks: 10,
        })
        .expect(201);

      questionId2 = res.body?.data?.question?.id ?? res.body?.question?.id;
      expect(questionId2).toBeDefined();
    });

    it('should return 400 if correctOptionIndex exceeds options count', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/exams/${examId}/questions`)
        .set('Authorization', `Bearer ${teacherAccessToken}`)
        .send({
          text: 'سؤال خاطئ',
          options: ['أ', 'ب'],
          correctOptionIndex: 5, // ❌ out of range
          marks: 5,
        })
        .expect(400);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('POST /exams/:id/start — [STUDENT] Start Exam (Anti-Cheat)', () => {
    it('should start exam and return questions WITHOUT correctOptionIndex', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/exams/${examId}/start`)
        .set('Authorization', `Bearer ${studentAccessToken}`)
        .expect(201);

      const body = res.body?.data ?? res.body;
      attemptId = body?.attempt?.id;
      expect(attemptId).toBeDefined();
      expect(body.questions).toBeDefined();
      expect(body.attempt.expiresAt).toBeDefined();

      // CRITICAL ANTI-CHEAT CHECK: correctOptionIndex must NOT appear in any question
      body.questions.forEach((q: any) => {
        expect(q.correctOptionIndex).toBeUndefined();
        expect(q.explanation).toBeUndefined();
      });
    });

    it('should return existing in-progress attempt if student calls start again', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/exams/${examId}/start`)
        .set('Authorization', `Bearer ${studentAccessToken}`)
        .expect(201);

      const body = res.body?.data ?? res.body;
      // Same attempt ID should be returned
      expect(body.attempt?.id).toBe(attemptId);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('POST /exams/attempts/:attemptId/submit — [STUDENT] Submit and Auto-Grade', () => {
    it('should submit answers and auto-grade — score=10 (only q-1 correct)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/exams/attempts/${attemptId}/submit`)
        .set('Authorization', `Bearer ${studentAccessToken}`)
        .send({
          answers: [
            { questionId: questionId1, selectedOptionIndex: 1 }, // ✅ correct (الأمبير)
            { questionId: questionId2, selectedOptionIndex: 0 }, // ❌ wrong (الفولت, correct is الأوم=2)
          ],
        })
        .expect(200);

      const body = res.body?.data ?? res.body;
      expect(body.score).toBe(10);
      expect(body.isPassed).toBe(true); // 10 >= passingMarks(10)
      expect(body.modelAnswers).toBeDefined(); // showCorrectAnswersAfterSubmission=true
      expect(body.modelAnswers).toHaveLength(2);
    });

    it('should return 409 ConflictException if attempt is submitted again', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/exams/attempts/${attemptId}/submit`)
        .set('Authorization', `Bearer ${studentAccessToken}`)
        .send({ answers: [] })
        .expect(409);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('GET /exams/:id/my-attempts — [STUDENT] List My Attempts', () => {
    it('should list student attempts with score', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/exams/${examId}/my-attempts`)
        .set('Authorization', `Bearer ${studentAccessToken}`)
        .expect(200);

      const body = res.body?.data ?? res.body;
      expect(body.attempts).toBeDefined();
      expect(body.attempts.length).toBe(1);
      expect(body.attempts[0].score).toBe(10);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('GET /exams/attempts/:attemptId/result — [STUDENT] Get Result', () => {
    it('should return result with model answers', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/exams/attempts/${attemptId}/result`)
        .set('Authorization', `Bearer ${studentAccessToken}`)
        .expect(200);

      const body = res.body?.data ?? res.body;
      expect(body.score).toBe(10);
      expect(body.answers).toBeDefined();
      expect(body.answers[0].correctAnswer).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('GET /exams/:id/submissions — [TEACHER] View Submissions', () => {
    it('should return stats and list of attempts for the exam', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/exams/${examId}/submissions`)
        .set('Authorization', `Bearer ${teacherAccessToken}`)
        .expect(200);

      const body = res.body?.data ?? res.body;
      expect(body.stats).toBeDefined();
      expect(body.stats.totalAttempts).toBe(1);
      expect(body.stats.submitted).toBe(1);
      expect(body.stats.averageScore).toBe(10);
      expect(body.attempts).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('maxAttempts enforcement — [STUDENT] Cannot exceed 2 attempts', () => {
    let attemptId2: string;

    it('should allow second attempt (maxAttempts=2)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/exams/${examId}/start`)
        .set('Authorization', `Bearer ${studentAccessToken}`)
        .expect(201);

      const body = res.body?.data ?? res.body;
      attemptId2 = body?.attempt?.id;
      expect(attemptId2).toBeDefined();
      expect(attemptId2).not.toBe(attemptId);
    });

    it('should auto-submit the second attempt if needed', async () => {
      if (!attemptId2) return;
      await request(app.getHttpServer())
        .post(`/api/v1/exams/attempts/${attemptId2}/submit`)
        .set('Authorization', `Bearer ${studentAccessToken}`)
        .send({
          answers: [
            { questionId: questionId1, selectedOptionIndex: 1 }, // ✅
            { questionId: questionId2, selectedOptionIndex: 2 }, // ✅
          ],
        })
        .expect(200);
    });

    it('should return 403 when student tries a 3rd attempt (maxAttempts=2 exceeded)', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/exams/${examId}/start`)
        .set('Authorization', `Bearer ${studentAccessToken}`)
        .expect(403);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('DELETE /exams/:id — [TEACHER] Soft Delete Exam', () => {
    it('should soft-delete the exam', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/exams/${examId}`)
        .set('Authorization', `Bearer ${teacherAccessToken}`)
        .expect(200);
    });

    it('should return 404 after deletion', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/exams/${examId}/start`)
        .set('Authorization', `Bearer ${studentAccessToken}`)
        .expect(404);
    });
  });
});
