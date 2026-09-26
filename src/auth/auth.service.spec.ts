import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConflictException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Role, GradeLevel } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuditLogService } from '../audit/audit-log.service';
import { AuthService } from './auth.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { StorageService } from '../shared/storage/storage.service';
import { RedisService } from '../shared/redis/redis.service';
import { SmsService } from '../shared/sms/sms.service';

describe('AuthService (Unit Tests)', () => {
  let authService: AuthService;
  let prisma: PrismaService;
  let redisService: RedisService;
  let smsService: SmsService;
  let jwtService: JwtService;

  const mockPrismaService = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    studentProfile: {
      create: jest.fn(),
    },
    userSession: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  const mockRedisService = {
    setOtp: jest.fn(),
    getOtp: jest.fn(),
    deleteOtp: jest.fn(),
    isOtpLocked: jest.fn().mockResolvedValue({ isLocked: false, remainingSeconds: 0 }),
    recordFailedOtpAttempt: jest.fn(),
    resetOtpAttempts: jest.fn(),
  };

  const mockSmsService = {
    sendOtp: jest.fn().mockResolvedValue(true),
    sendSms: jest.fn().mockResolvedValue(true),
  };

  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('mock_jwt_token'),
    verifyAsync: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultVal?: any) => {
      const config: Record<string, any> = {
        JWT_ACCESS_SECRET: 'test_access_secret_key_1234567890123456',
        JWT_REFRESH_SECRET: 'test_refresh_secret_key_1234567890123456',
        JWT_ACCESS_EXPIRATION: '15m',
        JWT_REFRESH_EXPIRATION: '7d',
      };
      return config[key] || defaultVal;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: { uploadFile: jest.fn().mockResolvedValue('url'), deleteFile: jest.fn().mockResolvedValue(undefined), getSignedUrl: jest.fn().mockResolvedValue('signed') } },
        { provide: RedisService, useValue: mockRedisService },
        { provide: SmsService, useValue: mockSmsService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    redisService = module.get<RedisService>(RedisService);
    smsService = module.get<SmsService>(SmsService);
    jwtService = module.get<JwtService>(JwtService);

    jest.clearAllMocks();
  });

  describe('registerStudent', () => {
    const registerDto = {
      fullName: 'أحمد محمود',
      email: 'student@test.com',
      phone: '01012345678',
      guardianPhone: '01198765432',
      password: 'Password@123',
      gradeLevel: GradeLevel.SEC_1,
    };

    it('should successfully register a student and send OTP', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        id: 'user-uuid-1',
        email: registerDto.email,
        phone: registerDto.phone,
        role: Role.STUDENT,
        isVerified: false,
        isActive: true,
      });

      const result = await authService.registerStudent(registerDto);

      expect(mockPrismaService.user.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ email: registerDto.email }, { phone: registerDto.phone }],
        },
      });
      expect(mockRedisService.setOtp).toHaveBeenCalledWith(registerDto.phone, expect.any(String), 120);
      expect(mockSmsService.sendOtp).toHaveBeenCalledWith(registerDto.phone, expect.any(String));
      expect(result.message).toContain('تم تسجيل الحساب بنجاح');
    });

    it('should throw ConflictException if email or phone already exists', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'existing-user-id',
        email: registerDto.email,
        phone: '01000000000',
      });

      await expect(authService.registerStudent(registerDto)).rejects.toThrow(ConflictException);
    });
  });

  describe('verifyOtp', () => {
    const verifyDto = {
      phone: '01012345678',
      otp: '123456',
    };

    it('should verify OTP, activate user and return tokens', async () => {
      mockRedisService.isOtpLocked.mockResolvedValue({ isLocked: false, remainingSeconds: 0 });
      mockRedisService.getOtp.mockResolvedValue('123456');
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'student@test.com',
        phone: verifyDto.phone,
        role: Role.STUDENT,
        isVerified: false,
        studentProfile: { fullName: 'أحمد محمود' },
      });
      mockPrismaService.user.update.mockResolvedValue({ isVerified: true });
      mockPrismaService.userSession.create.mockResolvedValue({});

      const result = await authService.verifyOtp(verifyDto);

      expect(mockRedisService.resetOtpAttempts).toHaveBeenCalledWith(verifyDto.phone);
      expect(mockRedisService.deleteOtp).toHaveBeenCalledWith(verifyDto.phone);
      expect(result.accessToken).toBe('mock_jwt_token');
      expect(result.user.isVerified).toBe(true);
    });

    it('should handle failed attempt and throw BadRequestException with remaining attempts', async () => {
      mockRedisService.isOtpLocked.mockResolvedValue({ isLocked: false, remainingSeconds: 0 });
      mockRedisService.getOtp.mockResolvedValue('654321'); // Mismatched OTP
      mockRedisService.recordFailedOtpAttempt.mockResolvedValue({
        attempts: 1,
        isLocked: false,
        remainingAttempts: 2,
      });

      await expect(authService.verifyOtp(verifyDto)).rejects.toThrow(BadRequestException);
      expect(mockRedisService.recordFailedOtpAttempt).toHaveBeenCalledWith(verifyDto.phone);
    });

    it('should lock account and throw ForbiddenException if 3 failed attempts are reached', async () => {
      mockRedisService.isOtpLocked.mockResolvedValue({ isLocked: false, remainingSeconds: 0 });
      mockRedisService.getOtp.mockResolvedValue('654321');
      mockRedisService.recordFailedOtpAttempt.mockResolvedValue({
        attempts: 3,
        isLocked: true,
        remainingAttempts: 0,
      });

      await expect(authService.verifyOtp(verifyDto)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('login', () => {
    const loginDto = {
      email: 'student@test.com',
      password: 'Password@123',
    };

    it('should login successfully and return access token', async () => {
      const passwordHash = await bcrypt.hash(loginDto.password, 10);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-uuid-1',
        email: loginDto.email,
        phone: '01012345678',
        passwordHash,
        role: Role.STUDENT,
        isVerified: true,
        isActive: true,
        studentProfile: { fullName: 'أحمد محمود' },
      });
      mockPrismaService.userSession.create.mockResolvedValue({});

      const result = await authService.login(loginDto);

      expect(result.accessToken).toBe('mock_jwt_token');
      expect(result.user.email).toBe(loginDto.email);
    });

    it('should throw UnauthorizedException on invalid password', async () => {
      const passwordHash = await bcrypt.hash('DifferentPassword@123', 10);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-uuid-1',
        email: loginDto.email,
        passwordHash,
        isVerified: true,
        isActive: true,
      });

      await expect(authService.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user is not verified yet', async () => {
      const passwordHash = await bcrypt.hash(loginDto.password, 10);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-uuid-1',
        email: loginDto.email,
        passwordHash,
        isVerified: false,
        isActive: true,
      });

      await expect(authService.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refreshToken (Reuse Detection & Soft-Revoke)', () => {
    it('should detect reused/revoked token, revoke ALL sessions and throw UnauthorizedException', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({ sub: 'user-uuid-1', sessionId: 'sess-1' });
      mockPrismaService.userSession.findFirst.mockResolvedValue({
        id: 'sess-1',
        userId: 'user-uuid-1',
        isRevoked: true, // ALREADY REVOKED! Token reused!
        expiresAt: new Date(Date.now() + 100000),
      });

      await expect(authService.refreshToken('reused_refresh_token')).rejects.toThrow(
        UnauthorizedException,
      );

      // Verify that all sessions for this user were revoked (Soft-Revoke)
      expect(mockPrismaService.userSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
        data: { isRevoked: true },
      });
    });

    it('should rotate token successfully and soft-revoke previous session (never delete)', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({ sub: 'user-uuid-1', sessionId: 'sess-1' });
      mockPrismaService.userSession.findFirst.mockResolvedValue({
        id: 'sess-1',
        userId: 'user-uuid-1',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 100000),
      });
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'student@test.com',
        phone: '01012345678',
        role: Role.STUDENT,
        isActive: true,
        isVerified: true,
      });
      mockPrismaService.userSession.update.mockResolvedValue({});
      mockPrismaService.userSession.create.mockResolvedValue({});

      const result = await authService.refreshToken('valid_refresh_token');

      // Soft-revoke the old session
      expect(mockPrismaService.userSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: { isRevoked: true },
      });
      expect(result.accessToken).toBe('mock_jwt_token');
    });
  });
});
