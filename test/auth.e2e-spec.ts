import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { RedisService } from '../src/shared/redis/redis.service';
import { GradeLevel } from '@prisma/client';

describe('Auth & Profile E2E Flow', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;

  const testStudent = {
    fullName: 'طالب اختباري',
    email: `student_e2e_${Date.now()}@example.com`,
    phone: `010${Math.floor(10000000 + Math.random() * 90000000)}`,
    guardianPhone: '01155667788',
    password: 'Password@123',
    gradeLevel: GradeLevel.SEC_1,
  };

  let accessToken: string;
  let refreshTokenCookie: string;

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
    redis = moduleFixture.get<RedisService>(RedisService);
  });

  afterAll(async () => {
    // Clean up test student
    try {
      await prisma.user.deleteMany({
        where: { email: testStudent.email },
      });
    } catch {
      // ignore
    }
    await app.close();
  });

  it('1. GET /api/v1/health should return system status ok', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(response.body.data.status).toBe('ok');
  });

  it('2. POST /api/v1/auth/student/register should register a new student and generate OTP in Redis', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/student/register')
      .send(testStudent)
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('تم تسجيل الحساب بنجاح');

    // Verify OTP was stored in Redis
    const otp = await redis.getOtp(testStudent.phone);
    expect(otp).toBeDefined();
    expect(otp).toHaveLength(6);
  });

  it('3. POST /api/v1/auth/verify-otp with valid OTP should activate user and return access token + cookie', async () => {
    const otp = await redis.getOtp(testStudent.phone);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-otp')
      .send({
        phone: testStudent.phone,
        otp,
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.accessToken).toBeDefined();
    expect(response.body.data.user.email).toBe(testStudent.email);
    expect(response.body.data.user.isVerified).toBe(true);

    // Verify httpOnly cookie was set
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const refreshCookie = (cookies as unknown as string[]).find((c: string) => c.startsWith('refreshToken='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toContain('HttpOnly');

    accessToken = response.body.data.accessToken;
    refreshTokenCookie = refreshCookie!;
  });

  it('4. POST /api/v1/auth/login should authenticate student and set new refresh cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: testStudent.email,
        password: testStudent.password,
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.accessToken).toBeDefined();
    expect(response.body.data.user.email).toBe(testStudent.email);

    const cookies = response.headers['set-cookie'];
    refreshTokenCookie = (cookies as unknown as string[]).find((c: string) => c.startsWith('refreshToken='))!;
    accessToken = response.body.data.accessToken;
  });

  it('5. GET /api/v1/profile should return student profile with valid JWT Bearer token', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.email).toBe(testStudent.email);
    expect(response.body.data.studentProfile).toBeDefined();
    expect(response.body.data.studentProfile.fullName).toBe(testStudent.fullName);
  });

  it('6. POST /api/v1/auth/refresh should rotate tokens using refresh cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [refreshTokenCookie])
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.accessToken).toBeDefined();

    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const newRefreshCookie = (cookies as unknown as string[]).find((c: string) => c.startsWith('refreshToken='));
    expect(newRefreshCookie).toBeDefined();

    accessToken = response.body.data.accessToken;
    refreshTokenCookie = newRefreshCookie!;
  });

  it('7. POST /api/v1/auth/logout should clear cookie and soft-revoke session', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', [refreshTokenCookie])
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('Logged out successfully');

    // Cookie should be cleared (max-age=0 or expires in past)
    const cookies = response.headers['set-cookie'];
    const clearedCookie = (cookies as unknown as string[])?.find((c: string) => c.startsWith('refreshToken='));
    expect(clearedCookie).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);
  });
});
