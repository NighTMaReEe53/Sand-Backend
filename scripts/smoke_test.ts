import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { GradeLevel, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

async function runSmokeTest() {
  console.log('\n======================================================');
  console.log('🚀 RUNNING PHASE 2 SMOKE TEST');
  console.log('======================================================\n');

  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser('smoke_secret'));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  const server = app.getHttpServer();
  const prisma = app.get(PrismaService);

  const hash = await bcrypt.hash('Password@123', 10);
  const stamp = Date.now();

  // Create Smoke Teacher
  const teacherUser = await prisma.user.create({
    data: {
      email: `smoke_teacher_${stamp}@test.com`,
      phone: `010${Math.floor(10000000 + Math.random() * 90000000)}`,
      passwordHash: hash,
      role: Role.TEACHER,
      isVerified: true,
      isActive: true,
    },
  });

  await prisma.teacherProfile.create({
    data: {
      userId: teacherUser.id,
      fullName: 'أ. حسام الدين (Smoke Test)',
      specialization: 'لغة عربية',
      createdByAdminId: teacherUser.id,
    },
  });

  // Create Smoke Student
  const studentUser = await prisma.user.create({
    data: {
      email: `smoke_student_${stamp}@test.com`,
      phone: `010${Math.floor(10000000 + Math.random() * 90000000)}`,
      passwordHash: hash,
      role: Role.STUDENT,
      isVerified: true,
      isActive: true,
    },
  });

  await prisma.studentProfile.create({
    data: {
      userId: studentUser.id,
      fullName: 'طالب Smoke Test',
      guardianPhone: '01122334455',
      gradeLevel: GradeLevel.SEC_1,
    },
  });

  // Step 1: Teacher Login & Create Free Course
  console.log('--- Step 1: Teacher login & POST /api/v1/courses (Free Course) ---');
  const tLogin = await request(server)
    .post('/api/v1/auth/login')
    .send({ email: teacherUser.email, password: 'Password@123' });
  const teacherToken = tLogin.body.data.accessToken;

  const createCourseRes = await request(server)
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${teacherToken}`)
    .send({
      title: 'كورس النحو والصرف للثانوية العامة',
      description: 'شرح مبسط وتطبيقات عملية على كافة قواعد النحو.',
      price: 0,
      isFree: true,
      gradeLevel: GradeLevel.SEC_1,
    });
  console.log('Status:', createCourseRes.status);
  console.log('Response Body:', JSON.stringify(createCourseRes.body, null, 2));
  const courseId = createCourseRes.body.data.id;

  // Step 2: Teacher changes status to PUBLISHED
  console.log('\n--- Step 2: Teacher PATCH /api/v1/courses/:id (Change status to PUBLISHED) ---');
  const publishRes = await request(server)
    .patch(`/api/v1/courses/${courseId}`)
    .set('Authorization', `Bearer ${teacherToken}`)
    .send({ status: 'PUBLISHED' });
  console.log('Status:', publishRes.status);
  console.log('Response Body:', JSON.stringify(publishRes.body, null, 2));

  // Step 3: Teacher adds lesson
  console.log('\n--- Step 3: Teacher POST /api/v1/courses/:id/lessons ---');
  const addLessonRes = await request(server)
    .post(`/api/v1/courses/${courseId}/lessons`)
    .set('Authorization', `Bearer ${teacherToken}`)
    .send({
      title: 'الدرس الأول: كان وأخواتها',
      description: 'شرح معاني الأفعال الناسخة وحالات إعراب اسمها وخبرها.',
      videoUrl: 'http://localhost:3000/uploads/videos/sample.mp4',
      durationSeconds: 1800,
      isPreview: false,
    });
  console.log('Status:', addLessonRes.status);
  console.log('Response Body:', JSON.stringify(addLessonRes.body, null, 2));
  const lessonId = addLessonRes.body.data.id;

  // Step 4: Student login & Enroll Free
  console.log('\n--- Step 4: Student login & POST /api/v1/courses/:id/enroll-free ---');
  const sLogin = await request(server)
    .post('/api/v1/auth/login')
    .send({ email: studentUser.email, password: 'Password@123' });
  const studentToken = sLogin.body.data.accessToken;

  const enrollRes = await request(server)
    .post(`/api/v1/courses/${courseId}/enroll-free`)
    .set('Authorization', `Bearer ${studentToken}`);
  console.log('Status:', enrollRes.status);
  console.log('Response Body:', JSON.stringify(enrollRes.body, null, 2));

  // Step 5: Student requests GET /lessons/:id/stream-url
  console.log('\n--- Step 5: Student GET /api/v1/lessons/:id/stream-url ---');
  const streamRes = await request(server)
    .get(`/api/v1/lessons/${lessonId}/stream-url`)
    .set('Authorization', `Bearer ${studentToken}`);
  console.log('Status:', streamRes.status);
  console.log('Response Body:', JSON.stringify(streamRes.body, null, 2));

  // Cleanup
  await prisma.lesson.deleteMany({ where: { courseId } });
  await prisma.enrollment.deleteMany({ where: { courseId } });
  await prisma.course.deleteMany({ where: { id: courseId } });
  await prisma.studentProfile.deleteMany({ where: { userId: studentUser.id } });
  await prisma.teacherProfile.deleteMany({ where: { userId: teacherUser.id } });
  await prisma.user.deleteMany({ where: { id: { in: [teacherUser.id, studentUser.id] } } });

  await app.close();
  console.log('\n✅ SMOKE TEST COMPLETED SUCCESSFULLY!\n');
}

runSmokeTest().catch((e) => {
  console.error(e);
  process.exit(1);
});
