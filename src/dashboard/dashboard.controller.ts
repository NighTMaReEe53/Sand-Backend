import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboards & Analytics')
@ApiBearerAuth('bearer')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Roles(Role.STUDENT)
  @Get('student')
  @ApiOperation({
    summary: 'Student Dashboard (Enrolled Courses, Progress, Recent Exams & Overall Stats)',
  })
  @ApiResponse({ status: 200, description: 'Student dashboard returned.' })
  getStudentDashboard(@CurrentUser('id') userId: string) {
    return this.dashboardService.getStudentDashboard(userId);
  }

  @Roles(Role.TEACHER)
  @Get('teacher')
  @ApiOperation({
    summary: 'Teacher Dashboard (Overview, Gross Revenue, Course Analytics & Recent Activity)',
  })
  @ApiResponse({ status: 200, description: 'Teacher dashboard returned.' })
  getTeacherDashboard(@CurrentUser('id') userId: string) {
    return this.dashboardService.getTeacherDashboard(userId);
  }

  @Roles(Role.ADMIN)
  @Get('admin')
  @ApiOperation({
    summary: 'Admin Dashboard (Platform-wide Users, Courses, Finances & Activity)',
  })
  @ApiResponse({ status: 200, description: 'Admin dashboard returned.' })
  getAdminDashboard() {
    return this.dashboardService.getAdminDashboard();
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('tasks')
  @ApiOperation({
    summary: 'Action center for teachers and administrators using live platform data',
  })
  @ApiResponse({ status: 200, description: 'Actionable dashboard tasks returned.' })
  getActionCenter(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboardService.getActionCenter(user.id, user.role as Role);
  }
}
