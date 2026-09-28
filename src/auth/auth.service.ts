import {
  Injectable,
  ConflictException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Role, GradeLevel } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../shared/prisma/prisma.service';
import { RedisService } from '../shared/redis/redis.service';
import { SmsService } from '../shared/sms/sms.service';
import { RegisterStudentDto } from './dtos/register-student.dto';
import { VerifyOtpDto } from './dtos/verify-otp.dto';
import { ResendOtpDto } from './dtos/resend-otp.dto';
import { LoginDto } from './dtos/login.dto';
import { AuditLogService } from '../audit/audit-log.service';
import { Cron, CronExpression } from '@nestjs/schedule';

export interface TokenPair {
  accessToken: string;
  expiresIn: number; // in seconds
  refreshToken: string;
}

export interface AuthResponseData {
  accessToken: string;
  expiresIn: number;
  refreshToken: string; // for internal controller cookie setup
  user: {
    id: string;
    email: string;
    phone: string;
    role: Role;
    isVerified: boolean;
    profile?: any;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly saltRounds = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly smsService: SmsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Legacy GradeLevel enum derived from a taxonomy grade code (+ optional track).
   * Keeps the NOT NULL student_profiles.grade_level column in sync while the
   * normalized StudentEducationProfile is the real source of truth.
   */
  private deriveLegacyGradeLevel(gradeCode: string, trackCode: string | null): GradeLevel {
    // Direct 1:1 mappings
    if (['PREP_1', 'PREP_2', 'PREP_3', 'SEC_1', 'SEC_2'].includes(gradeCode)) {
      return gradeCode as GradeLevel;
    }
    // Third-secondary splits by track (also covers SG_SEC_* duplicates)
    if (gradeCode === 'SEC_3' || gradeCode === 'SG_SEC_3') {
      return trackCode?.endsWith(':LITERARY') ? GradeLevel.SEC_3_LITERARY : GradeLevel.SEC_3_SCIENTIFIC;
    }
    // Second-general duplicate system merges into GENERAL equivalents
    if (gradeCode === 'SG_SEC_1') return GradeLevel.SEC_1;
    if (gradeCode === 'SG_SEC_2') return GradeLevel.SEC_2;
    // Systems with no GENERAL equivalent → dedicated compatibility values
    if (gradeCode.startsWith('AZHAR_PREP')) return GradeLevel.AZHAR_PREP;
    if (gradeCode.startsWith('AZHAR_SEC')) return GradeLevel.AZHAR_SEC;
    if (gradeCode.startsWith('BAC')) return GradeLevel.BAC;
    throw new BadRequestException('تعذر تحديد الصف الدراسي — الصف المختار غير مدعوم.');
  }

  /**
   * التحقق من رقم ولي الأمر عند إنشاء/تعديل حساب الطالب:
   * - لا يطابق رقم هاتف الطالب نفسه
   * - غير مسجل كرقم ولي أمر لحساب طالب آخر (كل طالب له رقم ولي أمر مختلف)
   * - لا يطابق رقم أي حساب آخر (طالب/مدرس/أدمن) حتى يتمكن ولي الأمر من الدخول برقمه عبر OTP
   */
  async assertGuardianPhoneAvailable(
    guardianPhone: string,
    studentPhone?: string,
    options: { allowParentAccount?: boolean } = {},
  ): Promise<void> {
    const phone = guardianPhone.trim();

    if (studentPhone && phone === studentPhone.trim()) {
      throw new ConflictException(
        'لا يمكن أن يكون رقم ولي الأمر هو نفسه رقم هاتف الطالب.',
      );
    }

    const phoneUser = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true, role: true },
    });
    if (
      phoneUser &&
      !(options.allowParentAccount && phoneUser.role === Role.PARENT)
    ) {
      throw new ConflictException(
        'رقم ولي الأمر مستخدم بالفعل في حساب آخر مسجل. يجب إدخال رقم مختلف.',
      );
    }

    const usedByStudent = await this.prisma.studentProfile.findFirst({
      where: { guardianPhone: phone },
      select: { id: true },
    });
    if (usedByStudent) {
      throw new ConflictException(
        'رقم ولي الأمر هذا مستخدم بالفعل لحساب طالب آخر. كل حساب يحتاج رقم ولي أمر خاصًا به.',
      );
    }
  }

  /**
   * تسجيل طالب جديد وتوليد كود OTP
   */
  async registerStudent(dto: RegisterStudentDto): Promise<{ message: string }> {
    // 1. التحقق من عدم تكرار الإيميل أو رقم الهاتف
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email.toLowerCase() }, { phone: dto.phone }],
      },
    });

    if (existingUser) {
      if (existingUser.email.toLowerCase() === dto.email.toLowerCase()) {
        throw new ConflictException('يوجد حساب مسجل بالفعل بهذا البريد الإلكتروني.');
      }
      throw new ConflictException('يوجد حساب مسجل بالفعل برقم الهاتف هذا.');
    }

    // 1.ب التحقق من رقم ولي الأمر: فريد ولا يطابق رقم الطالب نفسه
    await this.assertGuardianPhoneAvailable(dto.guardianPhone.trim(), dto.phone.trim());

    // 2. Resolve education taxonomy selection (system → stage → grade → track)
    let resolved: {
      gradeId: string;
      stageId: string;
      educationSystemId: string;
      trackId: string | null;
      legacyGradeLevel: GradeLevel;
    } | null = null;
    let legacyGradeLevel = dto.gradeLevel;

    if (dto.gradeId) {
      const gradeRow = await this.prisma.grade.findUnique({
        where: { id: dto.gradeId },
        include: { stage: { select: { id: true, educationSystemId: true } } },
      });
      if (!gradeRow || !gradeRow.stage) {
        throw new BadRequestException('الصف الدراسي المختار غير موجود.');
      }

      // Track validation mirrors TaxonomyService.validateGradeTrackPair
      let track: { id: string; code: string; gradeId: string } | null = null;
      if (!gradeRow.hasTracks) {
        if (dto.trackId) {
          throw new BadRequestException('هذا الصف لا يقبل الشُعب — احذف الشعبة المحددة.');
        }
      } else if (!dto.trackId) {
        throw new BadRequestException('هذا الصف يتطلب اختيار شعبة إلزامية.');
      } else {
        const found = await this.prisma.track.findUnique({ where: { id: dto.trackId } });
        if (!found || found.gradeId !== gradeRow.id) {
          throw new BadRequestException('الشعبة المختارة لا تنتمي إلى الصف المختار.');
        }
        track = found;
      }

      const derivedLegacy = this.deriveLegacyGradeLevel(gradeRow.code, track?.code ?? null);

      resolved = {
        gradeId: gradeRow.id,
        stageId: gradeRow.stageId,
        educationSystemId: gradeRow.stage.educationSystemId,
        trackId: track?.id ?? null,
        legacyGradeLevel: derivedLegacy,
      };
      legacyGradeLevel = derivedLegacy;
    } else if (!dto.gradeLevel) {
      throw new BadRequestException('يجب تحديد الصف الدراسي.');
    }

    // 3. تشفير كلمة المرور بـ bcrypt
    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

    // 4. إنشاء سجل User وحساب StudentProfile بحالة is_verified = false
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email.toLowerCase().trim(),
          phone: dto.phone.trim(),
          passwordHash,
          role: Role.STUDENT,
          isVerified: false,
          isActive: true,
        },
      });

      const profile = await tx.studentProfile.create({
        data: {
          userId: user.id,
          fullName: dto.fullName.trim(),
          guardianPhone: dto.guardianPhone.trim(),
          gradeLevel: legacyGradeLevel as GradeLevel,
        },
      });

      if (resolved) {
        await tx.studentEducationProfile.create({
          data: {
            studentId: profile.id,
            educationSystemId: resolved.educationSystemId,
            stageId: resolved.stageId,
            gradeId: resolved.gradeId,
            trackId: resolved.trackId,
          },
        });
      }
    });

    // 4. توليد كود OTP آمن من 6 أرقام
    const otp = crypto.randomInt(100000, 999999).toString();

    // 5. تخزين OTP في Redis بصلاحية دقيقتين (120 ثانية)
    await this.redisService.setOtp(dto.phone.trim(), otp, 120);

    // 6. إرسال الكود عبر بوابة SMS (أو Mock Logger في بيئة التطوير)
    await this.smsService.sendOtp(dto.phone.trim(), otp);

    return {
      message: 'تم تسجيل الحساب بنجاح. يرجى تأكيد رقم هاتفك بإدخال رمز التحقق (OTP) المرسل إليك.',
    };
  }

  /**
   * التحقق من كود OTP وتفعيل الحساب وإصدار الـ Tokens
   */
  async verifyOtp(
    dto: VerifyOtpDto,
    reqInfo: { ip?: string; userAgent?: string } = {},
  ): Promise<AuthResponseData> {
    const phone = dto.phone.trim();
    const otp = dto.otp.trim();

    // 1. فحص هل الرقم محظور مؤقتاً بسبب 3 محاولات خاطئة
    const lockStatus = await this.redisService.isOtpLocked(phone);
    if (lockStatus.isLocked) {
      const remainingMinutes = Math.ceil(lockStatus.remainingSeconds / 60);
      throw new ForbiddenException(
        `تم قفل التحقق مؤقتاً بسبب 3 محاولات خاطئة. يرجى المحاولة بعد ${remainingMinutes} دقيقة.`,
      );
    }

    // 2. استرجاع OTP من Redis
    const storedOtp = await this.redisService.getOtp(phone);

    if (!storedOtp || storedOtp !== otp) {
      const { isLocked, remainingAttempts } = await this.redisService.recordFailedOtpAttempt(phone);
      if (isLocked) {
        throw new ForbiddenException(
          'لقد تجاوزت الحد الأقصى للمحاولات (3 محاولات). تم قفل التحقق لمدة 15 دقيقة.',
        );
      }
      throw new BadRequestException(
        `رمز التحقق غير صحيح أو انتهت صلاحيته. المحاولات المتبقية: ${remainingAttempts}.`,
      );
    }

    // 3. كود OTP صحيح: مسح الكود وإعادة ضبط المحاولات
    await this.redisService.resetOtpAttempts(phone);
    await this.redisService.deleteOtp(phone);

    // 4. تحديث حالة المستخدم إلى isVerified = true
    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: {
        studentProfile: true,
        teacherProfile: true,
      },
    });

    if (!user) {
      throw new BadRequestException('لم يتم العثور على حساب مرتبط برقم الهاتف هذا.');
    }

    if (!user.isVerified) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { isVerified: true },
      });
      user.isVerified = true;
    }

    // 5. إصدار التوكنز وتسجيل الجلسة
    const tokens = await this.generateTokensAndSession(user, reqInfo);

    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
        profile: user.studentProfile || user.teacherProfile || null,
      },
    };
  }

  /**
   * ولي الأمر: طلب كود OTP باستخدام رقم الهاتف الذي أدخله الطالب (guardianPhone)
   */
  async requestParentOtp(dto: ResendOtpDto): Promise<{ message: string }> {
    const phone = dto.phone.trim();

    // 1. التأكد من وجود طالب واحد على الأقل سجل رقم ولي الأمر هذا
    const childrenCount = await this.prisma.studentProfile.count({
      where: { guardianPhone: phone },
    });
    if (childrenCount === 0) {
      throw new BadRequestException(
        'لا يوجد طالب مسجل بهذا الرقم كرقم لولي الأمر. تأكد من الرقم المدخل.',
      );
    }

    // 2. فحص القفل المؤقت
    const lockStatus = await this.redisService.isOtpLocked(phone);
    if (lockStatus.isLocked) {
      const remainingMinutes = Math.ceil(lockStatus.remainingSeconds / 60);
      throw new ForbiddenException(
        `تم قفل التحقق مؤقتاً بسبب محاولات خاطئة. يرجى المحاولة بعد ${remainingMinutes} دقيقة.`,
      );
    }

    // 3. توليد وإرسال الكود
    const otp = crypto.randomInt(100000, 999999).toString();
    await this.redisService.setOtp(phone, otp, 120);
    await this.smsService.sendOtp(phone, otp);

    return {
      message: 'تم إرسال كود التحقق إلى رقم هاتفك.',
    };
  }

  /**
   * ولي الأمر: التحقق من كود OTP وتسجيل الدخول (إنشاء حساب ولي تلقائياً عند أول مرة)
   * لا يرى ولي الأمر إلا بيانات الطلاب الذين سجلوا رقمه في ملفاتهم.
   */
  async verifyParentOtp(
    dto: VerifyOtpDto,
    reqInfo: { ip?: string; userAgent?: string } = {},
  ): Promise<AuthResponseData> {
    const phone = dto.phone.trim();
    const otp = dto.otp.trim();

    // 1. التأكد من وجود طالب مرتبط برقم ولي الأمر هذا
    const children = await this.prisma.studentProfile.findMany({
      where: { guardianPhone: phone },
      select: { id: true, fullName: true },
    });
    if (children.length === 0) {
      throw new BadRequestException(
        'لا يوجد طالب مسجل بهذا الرقم كرقم لولي الأمر.',
      );
    }

    // 2. التحقق من الكود (نفس منطق verifyOtp)
    const lockStatus = await this.redisService.isOtpLocked(phone);
    if (lockStatus.isLocked) {
      const remainingMinutes = Math.ceil(lockStatus.remainingSeconds / 60);
      throw new ForbiddenException(
        `تم قفل التحقق مؤقتاً بسبب 3 محاولات خاطئة. يرجى المحاولة بعد ${remainingMinutes} دقيقة.`,
      );
    }

    const storedOtp = await this.redisService.getOtp(phone);
    if (!storedOtp || storedOtp !== otp) {
      const { isLocked, remainingAttempts } =
        await this.redisService.recordFailedOtpAttempt(phone);
      if (isLocked) {
        throw new ForbiddenException(
          'لقد تجاوزت الحد الأقصى للمحاولات (3 محاولات). تم قفل التحقق لمدة 15 دقيقة.',
        );
      }
      throw new BadRequestException(
        `رمز التحقق غير صحيح أو انتهت صلاحيته. المحاولات المتبقية: ${remainingAttempts}.`,
      );
    }

    await this.redisService.resetOtpAttempts(phone);
    await this.redisService.deleteOtp(phone);

    // 3. البحث عن حساب ولي الأمر أو إنشاؤه تلقائياً
    let parentUser = await this.prisma.user.findFirst({
      where: { phone, role: Role.PARENT },
    });

    if (!parentUser) {
      const existingPhoneUser = await this.prisma.user.findUnique({
        where: { phone },
      });
      if (existingPhoneUser) {
        throw new BadRequestException(
          'هذا الرقم مسجل كحساب طالب/مدرس/إدارة. يرجى تسجيل الدخول بالبريد الإلكتروني وكلمة المرور.',
        );
      }

      // حساب ولي الأمر بدون كلمة مرور قابلة للاستخدام — الدخول عبر OTP فقط
      const unusablePassword = await bcrypt.hash(
        crypto.randomBytes(32).toString('hex'),
        this.saltRounds,
      );

      parentUser = await this.prisma.user.create({
        data: {
          email: `parent.${phone}@parents.local`,
          phone,
          passwordHash: unusablePassword,
          role: Role.PARENT,
          isVerified: true,
          isActive: true,
        },
      });
    }

    if (!parentUser.isActive) {
      throw new ForbiddenException('تم تعطيل حسابك. يرجى التواصل مع الإدارة.');
    }

    // 4. إصدار التوكنز وتسجيل الجلسة
    const tokens = await this.generateTokensAndSession(parentUser, reqInfo);

    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      refreshToken: tokens.refreshToken,
      user: {
        id: parentUser.id,
        email: parentUser.email,
        phone: parentUser.phone,
        role: parentUser.role,
        isVerified: parentUser.isVerified,
        profile: null,
      },
    };
  }

  /**
   * إعادة إرسال كود OTP
   */
  async resendOtp(dto: ResendOtpDto): Promise<{ message: string }> {
    const phone = dto.phone.trim();

    const user = await this.prisma.user.findUnique({
      where: { phone },
    });

    if (!user) {
      throw new BadRequestException('لم يتم العثور على حساب مسجل برقم الهاتف هذا.');
    }

    if (user.isVerified) {
      throw new BadRequestException('تم تأكيد رقم الهاتف بالفعل. يمكنك تسجيل الدخول مباشرة.');
    }

    // فحص القفل
    const lockStatus = await this.redisService.isOtpLocked(phone);
    if (lockStatus.isLocked) {
      const remainingMinutes = Math.ceil(lockStatus.remainingSeconds / 60);
      throw new ForbiddenException(
        `تم قفل التحقق مؤقتاً. يرجى المحاولة بعد ${remainingMinutes} دقيقة.`,
      );
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    await this.redisService.setOtp(phone, otp, 120);
    await this.smsService.sendOtp(phone, otp);

    return {
      message: 'تم إرسال كود تحقق جديد إلى رقم هاتفك.',
    };
  }

  /**
   * تسجيل الدخول الموحد (طالب / مدرس / أدمن)
   */
  async login(
    dto: LoginDto,
    reqInfo: { ip?: string; userAgent?: string } = {},
  ): Promise<AuthResponseData> {
    const email = dto.email?.toLowerCase().trim();
    const phone = dto.phone?.trim();

    // 1. البحث عن المستخدم
    const user = await this.prisma.user.findUnique({
      where: email ? { email } : { phone: phone! },
      include: {
        studentProfile: true,
        teacherProfile: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    }

    // 2. التحقق من كلمة المرور
    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    }

    // 3. التحقق من تفعيل الحساب ونشاطه
    if (!user.isActive) {
      throw new ForbiddenException('تم تعطيل حسابك. يرجى التواصل مع الإدارة.');
    }

    if (!user.isVerified) {
      throw new UnauthorizedException(
        'لم يتم تفعيل حسابك بعد. يرجى تأكيد رقم الهاتف بكود OTP أولاً.',
      );
    }

    // 4. توليد التوكنز وحفظ الجلسة
    const tokens = await this.generateTokensAndSession(user, reqInfo);

    // Audit log: تسجيل دخول ناجح
    await this.auditLogService.log({
      userId: user.id,
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      ipAddress: reqInfo.ip,
      userAgent: reqInfo.userAgent,
    });

    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
        profile: user.studentProfile || user.teacherProfile || null,
      },
    };
  }

  /**
   * تجديد التوكن (Refresh Token Rotation) مع كشف محاولات إعادة الاستخدام (Reuse Detection)
   * 
   * قاعدة تصميمية صارمة:
   * يُمنع نهائياً عمل .delete() لأي سجل في UserSession.
   * أي إبطال لجلسة يتم عبر Soft-Revoke فقط (isRevoked = true) 
   * حتى نتمكن من كشف Token Reuse Detection وإبطال جميع جلسات المستخدم فوراً عند الاشتباه بالسرقة.
   */
  async refreshToken(
    rawRefreshToken: string,
    reqInfo: { ip?: string; userAgent?: string } = {},
  ): Promise<AuthResponseData> {
    if (!rawRefreshToken) {
      throw new UnauthorizedException('رمز التحديث مطلوب.');
    }

    // 1. فحص صحة توقيع الـ JWT الخاص بالـ Refresh Token
    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(rawRefreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET', 'fallback_jwt_refresh_secret_key_123'),
      });
    } catch {
      throw new UnauthorizedException('رمز التحديث غير صالح أو منتهي الصلاحية.');
    }

    const tokenHash = this.hashToken(rawRefreshToken);

    // 2. البحث عن سجل الجلسة
    const session = await this.prisma.userSession.findFirst({
      where: { tokenHash },
    });

    // 3. كشف محاولة إعادة الاستخدام (Reuse Detection)
    if (session && session.isRevoked) {
      this.logger.error(
        `🚨 [SECURITY ALERT] Refresh token reuse detected for User ID: ${payload.sub}! Revoking ALL active sessions.`,
      );
      // إبطال كل جلسات المستخدم فوراً لحمايته من سرقة الحساب
      // ملاحظة: soft-revoke فقط (isRevoked: true) وممنوع عمل delete
      await this.prisma.userSession.updateMany({
        where: { userId: payload.sub },
        data: { isRevoked: true },
      });

      throw new UnauthorizedException(
        'تنبيه أمني: تم اكتشاف محاولة إعادة استخدام غير مصرح بها للرمز. تم إنهاء كافة الجلسات النشطة لحماية حسابك. يرجى تسجيل الدخول مرة أخرى.',
      );
    }

    if (!session || new Date() > session.expiresAt) {
      throw new UnauthorizedException('انتهت صلاحية الجلسة أو أنها غير صالحة. يرجى تسجيل الدخول مجدداً.');
    }

    // 4. إبطال الجلسة القديمة (Soft-Revoke: ممنوع حذف السجل)
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { isRevoked: true },
    });

    // 5. استرجاع المستخدم وتوليد توكن جديد وجلسة جديدة
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        studentProfile: true,
        teacherProfile: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User account no longer active.');
    }

    const tokens = await this.generateTokensAndSession(user, reqInfo);

    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
        profile: user.studentProfile || user.teacherProfile || null,
      },
    };
  }

  /**
   * تسجيل الخروج وإبطال الجلسة (Soft-Revoke)
   * 
   * ملاحظة: يتم عمل soft-revoke فقط (isRevoked = true) وممنوع نهائياً عمل .delete()
   */
  async logout(userId: string, rawRefreshToken?: string): Promise<{ message: string }> {
    if (rawRefreshToken) {
      const tokenHash = this.hashToken(rawRefreshToken);
      await this.prisma.userSession.updateMany({
        where: {
          userId,
          tokenHash,
          isRevoked: false,
        },
        data: { isRevoked: true },
      });
    } else {
      // إبطال جميع جلسات المستخدم
      await this.prisma.userSession.updateMany({
        where: {
          userId,
          isRevoked: false,
        },
        data: { isRevoked: true },
      });
    }

    // Audit log: تسجيل خروج
    await this.auditLogService.log({
      userId,
      action: 'LOGOUT',
      entity: 'User',
      entityId: userId,
    });

    return { message: 'Logged out successfully.' };
  }

  /**
   * دالة مساعدة لتوليد Access Token و Refresh Token وتخزين الجلسة
   */
  private async generateTokensAndSession(
    user: { id: string; email: string; phone: string; role: Role },
    reqInfo: { ip?: string; userAgent?: string } = {},
  ): Promise<TokenPair> {
    const sessionId = crypto.randomUUID();

    // One active session per account: a new login (any device/browser)
    // revokes every previous session, so the same account cannot be used
    // from two browsers at the same time.
    await this.prisma.userSession.updateMany({
      where: { userId: user.id, isRevoked: false },
      data: { isRevoked: true },
    });

    const accessPayload = {
      sub: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      sessionId,
    };

    const refreshPayload = {
      sub: user.id,
      sessionId,
    };

    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET', 'fallback_jwt_access_secret_key_123'),
      expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRATION', '15m'),
    });

    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET', 'fallback_jwt_refresh_secret_key_123'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d'),
    });

    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // تخزين الجلسة الجديدة في UserSession (لا يتم حذف أي سجل قديم)
    await this.prisma.userSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash,
        ipAddress: reqInfo.ip || null,
        userAgent: reqInfo.userAgent || null,
        isRevoked: false,
        expiresAt,
      },
    });

    return {
      accessToken,
      expiresIn: 15 * 60, // 15 minutes (900 seconds)
      refreshToken,
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Phase 3.10: تنظيف دوري للجلسات المنتهية — Soft-Revoke فقط (بدون حذف)
   * يضمن أن الجلسات المنتهية لا تُستخدم مرة أخرى حتى لو لم يجرّبها أحد.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async revokeExpiredSessions() {
    const result = await this.prisma.userSession.updateMany({
      where: {
        isRevoked: false,
        expiresAt: { lt: new Date() },
      },
      data: { isRevoked: true },
    });
    if (result.count > 0) {
      this.logger.log(`Soft-revoked ${result.count} expired session(s).`);
    }
  }
}
