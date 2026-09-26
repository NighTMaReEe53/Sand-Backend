import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BacklogService } from './backlog.service';

@ApiTags('Backlog')
@ApiBearerAuth('bearer')
@Controller()
export class BacklogController {
  constructor(private readonly backlogService: BacklogService) {}

  @Roles(Role.STUDENT)
  @Get('students/me/backlog')
  @ApiOperation({
    summary: 'Phase 2 — My backlog across all enrolled courses (video/quiz items)',
  })
  getMyBacklog(@CurrentUser('id') userId: string) {
    return this.backlogService.getStudentBacklogByUser(userId);
  }

  @Roles(Role.STUDENT)
  @Get('courses/:courseId/backlog')
  @ApiOperation({ summary: 'Phase 2 — My backlog in one course' })
  getCourseBacklog(
    @CurrentUser('id') userId: string,
    @Param('courseId') courseId: string,
  ) {
    return this.backlogService.getCourseBacklogByUser(courseId, userId);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('courses/:courseId/learning-status')
  @ApiOperation({
    summary:
      'Phase 2 — Teacher/Admin learning-status analytics for one course (on-track / behind / severely-behind)',
  })
  getCourseLearningStatus(
    @CurrentUser() user: { id: string; role: Role },
    @Param('courseId') courseId: string,
  ) {
    return this.backlogService.getCourseLearningStatus(courseId, user);
  }
}
