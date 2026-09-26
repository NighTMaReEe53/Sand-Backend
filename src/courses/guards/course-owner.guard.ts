import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class CourseOwnerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    if (!user) {
      throw new ForbiddenException('User authentication required.');
    }

    // Admins have override privileges
    if (user.role === Role.ADMIN) {
      return true;
    }

    if (user.role !== Role.TEACHER) {
      throw new ForbiddenException('Only teachers can manage courses.');
    }

    // Extract course ID from params or body
    const courseId =
      request.params?.id ||
      request.params?.courseId ||
      request.body?.courseId;

    if (!courseId) {
      return true; // if endpoint doesn't have courseId param, handled by controller
    }

    const teacherProfile = await this.prisma.teacherProfile.findUnique({
      where: { userId: user.id },
    });

    if (!teacherProfile) {
      throw new ForbiddenException('Teacher profile not found.');
    }

    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, teacherId: true, isDeleted: true },
    });

    if (!course || course.isDeleted) {
      throw new NotFoundException('Course not found.');
    }

    if (course.teacherId !== teacherProfile.id) {
      throw new ForbiddenException('You do not have permission to manage this course.');
    }

    request.teacherProfileId = teacherProfile.id;
    return true;
  }
}
