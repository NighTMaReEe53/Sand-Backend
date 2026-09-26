import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../shared/prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  phone: string;
  role: string;
  sessionId?: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET', 'fallback_jwt_access_secret_key_123'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        isVerified: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User account no longer exists.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User account has been deactivated.');
    }

    // Single-session enforcement: if the token carries a sessionId, that
    // session must still be active. Logging in from another browser revokes
    // it, so the old device is rejected on its very next request.
    if (payload.sessionId) {
      const session = await this.prisma.userSession.findUnique({
        where: { id: payload.sessionId },
        select: { isRevoked: true },
      });
      if (!session || session.isRevoked) {
        throw new UnauthorizedException(
          'تم تسجيل الدخول من جهاز آخر، وتم إنهاء هذه الجلسة.'
        );
      }
    }

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isVerified: user.isVerified,
      sessionId: payload.sessionId,
    };
  }
}
