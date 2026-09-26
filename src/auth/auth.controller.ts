import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiCookieAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { RegisterStudentDto } from './dtos/register-student.dto';
import { VerifyOtpDto } from './dtos/verify-otp.dto';
import { ResendOtpDto } from './dtos/resend-otp.dto';
import { LoginDto } from './dtos/login.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { COOKIE_NAME_REFRESH_TOKEN } from '../common/constants/security.constants';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly isProduction: boolean;
  private readonly cookieSameSite: 'strict' | 'lax' | 'none';

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    this.isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    this.cookieSameSite = (this.configService.get<string>('COOKIE_SAME_SITE', 'strict').toLowerCase() as any) || 'strict';
  }

  private setRefreshTokenCookie(res: Response, refreshToken: string) {
    const isSecure = this.configService.get<string>('COOKIE_SECURE', 'false') === 'true' || this.isProduction;

    res.cookie(COOKIE_NAME_REFRESH_TOKEN, refreshToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: this.cookieSameSite,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });
  }

  private clearRefreshTokenCookie(res: Response) {
    const isSecure = this.configService.get<string>('COOKIE_SECURE', 'false') === 'true' || this.isProduction;

    res.clearCookie(COOKIE_NAME_REFRESH_TOKEN, {
      httpOnly: true,
      secure: isSecure,
      sameSite: this.cookieSameSite,
      path: '/',
    });
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 3600000 } }) // 3 attempts per hour
  @Post('student/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new student account (Sends OTP via SMS)' })
  @ApiResponse({ status: 201, description: 'Student registered successfully, OTP sent.' })
  @ApiResponse({ status: 409, description: 'Email or phone already registered.' })
  async registerStudent(@Body() dto: RegisterStudentDto) {
    return this.authService.registerStudent(dto);
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP code and activate account (Sets Refresh Token Cookie)' })
  @ApiResponse({ status: 200, description: 'Account activated, returns access token.' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP code.' })
  @ApiResponse({ status: 403, description: 'Verification locked for 15 minutes due to 3 failed attempts.' })
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const reqInfo = {
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    };

    const result = await this.authService.verifyOtp(dto, reqInfo);

    // Refresh Token يتم تخزينه فقط في httpOnly Cookie ولا يُرجع في Response Body
    this.setRefreshTokenCookie(res, result.refreshToken);

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 3600000 } }) // 3 attempts per hour
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend a new OTP code to the registered phone number' })
  @ApiResponse({ status: 200, description: 'New OTP code sent.' })
  @ApiResponse({ status: 400, description: 'Phone number already verified or not found.' })
  @ApiResponse({ status: 403, description: 'Locked due to multiple failed attempts.' })
  async resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 3600000 } }) // 3 attempts per hour
  @Post('parent/request-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[PARENT] Request login OTP using the guardian phone number registered by the student' })
  @ApiResponse({ status: 200, description: 'OTP sent to the parent phone.' })
  @ApiResponse({ status: 400, description: 'No student is registered with this guardian phone.' })
  @ApiResponse({ status: 403, description: 'Locked due to multiple failed attempts.' })
  async requestParentOtp(@Body() dto: ResendOtpDto) {
    return this.authService.requestParentOtp(dto);
  }

  @Public()
  @Post('parent/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[PARENT] Verify OTP and login as parent (Sets Refresh Token Cookie)' })
  @ApiResponse({ status: 200, description: 'Parent logged in, returns access token.' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP code / no linked student.' })
  @ApiResponse({ status: 403, description: 'Verification locked for 15 minutes due to 3 failed attempts.' })
  async verifyParentOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const reqInfo = {
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    };

    const result = await this.authService.verifyParentOtp(dto, reqInfo);

    this.setRefreshTokenCookie(res, result.refreshToken);

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 900000 } }) // 5 attempts per 15 minutes
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login (Student, Teacher, Admin)' })
  @ApiResponse({ status: 200, description: 'Login successful, returns access token.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials or unverified account.' })
  @ApiResponse({ status: 403, description: 'Account deactivated.' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const reqInfo = {
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    };

    const result = await this.authService.login(dto, reqInfo);

    // Refresh Token يتم تخزينه فقط في httpOnly Cookie
    this.setRefreshTokenCookie(res, result.refreshToken);

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Rotate refresh token and issue a new access token via Cookie' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully.' })
  @ApiResponse({ status: 401, description: 'Invalid, expired, or reused refresh token.' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawRefreshToken = req.cookies?.[COOKIE_NAME_REFRESH_TOKEN];

    if (!rawRefreshToken) {
      throw new UnauthorizedException('Refresh token cookie is missing.');
    }

    const reqInfo = {
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    };

    const result = await this.authService.refreshToken(rawRefreshToken, reqInfo);

    // Rotate the cookie with the new Refresh Token
    this.setRefreshTokenCookie(res, result.refreshToken);

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke current refresh token session' })
  @ApiResponse({ status: 200, description: 'Logged out successfully.' })
  async logout(
    @CurrentUser('id') userId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawRefreshToken = req.cookies?.[COOKIE_NAME_REFRESH_TOKEN];

    const result = await this.authService.logout(userId, rawRefreshToken);
    this.clearRefreshTokenCookie(res);

    return result;
  }
}
