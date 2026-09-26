import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

@Injectable()
export class CourseTeacherGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;
    if (!user) throw new ForbiddenException('Not authenticated.');

    if (user.role === 'ADMIN') return true;
    if (user.role !== 'TEACHER') throw new ForbiddenException('Only teachers can access this resource.');

    const courseId = request.params?.courseId || request.body?.courseId || request.query?.courseId;
    if (!courseId) throw new ForbiddenException('courseId is required.');

    const teacherProfile = await this.prisma.teacherProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!teacherProfile) throw new ForbiddenException('Teacher profile not found.');

    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!course) throw new ForbiddenException('Course not found.');
    if (course.teacherId !== teacherProfile.id) {
      throw new ForbiddenException('You do not teach this course.');
    }

    return true;
  }
}
