import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { EnrollmentStatus } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

@Injectable()
export class EnrollmentGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;
    if (!user) throw new ForbiddenException('Not authenticated.');

    if (user.role === 'TEACHER' || user.role === 'ADMIN') return true;

    const courseId = request.body?.courseId || request.query?.courseId || request.params?.courseId;
    if (!courseId) throw new ForbiddenException('courseId is required.');

    const studentProfile = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!studentProfile) throw new ForbiddenException('Student profile not found.');

    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId: studentProfile.id,
        courseId,
        status: EnrollmentStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (!enrollment) {
      throw new ForbiddenException('You must be actively enrolled in this course.');
    }

    return true;
  }
}
