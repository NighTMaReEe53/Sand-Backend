import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';

@ApiTags('Analytics')
@ApiBearerAuth('bearer')
@Controller()
// Analytics ثقيل على الداتابيز — heavy tier
@Throttle({ heavy: { limit: 15, ttl: 60_000 } })
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Roles(Role.STUDENT)
  @Get('analytics/student')
  @ApiOperation({
    summary:
      'Student performance analytics: exam/quiz scores, completion stats, weak & strong topics, recent activity.',
  })
  @ApiResponse({ status: 200, description: 'Performance report returned.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Students only.' })
  getStudentPerformance(@CurrentUser() user: { id: string; role: Role }) {
    return this.analyticsService.getStudentPerformance(user.id, user);
  }

  @Roles(Role.STUDENT)
  @Get('analytics/student/periodic-report')
  @ApiOperation({ summary: 'Student weekly, monthly, or overall comprehensive performance report.' })
  getMyPeriodicReport(
    @CurrentUser() user: { id: string; role: Role },
    @Query('period') period?: 'week' | 'month' | 'all',
    @Query('courseId') courseId?: string,
  ) {
    return this.analyticsService.getStudentPeriodicReportByUserId(user.id, period || 'all', courseId);
  }

  @Roles(Role.STUDENT)
  @Get('analytics/student/weekly-report')
  @ApiOperation({
    summary:
      'Student weekly performance report (snapshot refreshed every week). Optional courseId + weekStart filters. Falls back to live compute if no snapshot exists.',
  })
  getMyWeeklyReport(
    @CurrentUser() user: { id: string; role: Role },
    @Query('courseId') courseId?: string,
    @Query('weekStart') weekStart?: string,
  ) {
    return this.analyticsService.getStudentWeeklyReportByUser(user.id, courseId, weekStart);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('analytics/students/:studentId/periodic-report')
  @ApiOperation({ summary: 'Teacher/Admin inspect student weekly, monthly, or overall performance report.' })
  getStudentPeriodicReport(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query('period') period?: 'week' | 'month' | 'all',
    @Query('courseId') courseId?: string,
  ) {
    return this.analyticsService.getStudentPeriodicReport(studentId, period || 'all', courseId);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('analytics/teacher/students/:studentId/report-pdf')
  @ApiOperation({
    summary:
      'Download a verified, course-scoped Arabic performance report for one enrolled student (Teacher Owner/Admin).',
  })
  async getTeacherStudentPerformancePdf(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query('courseId', ParseUUIDPipe) courseId: string,
    @Query('note') note: string | undefined,
    @CurrentUser() user: { id: string; role: Role },
    @Res() res: Response,
  ) {
    const pdf = await this.analyticsService.getTeacherStudentPerformancePdf(
      courseId,
      studentId,
      user,
      note,
    );
    const safeName = `guardian-performance-${studentId.slice(0, 8)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent('تقرير متابعة الطالب.pdf')}`,
    );
    res.send(pdf);
  }

  @Roles(Role.STUDENT)
  @Get('analytics/student/report-pdf')
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({
    summary:
      'Download the requesting student\u2019s performance report as a PDF (scoped to caller only).',
  })
  async getStudentPerformancePdf(
    @CurrentUser() user: { id: string; role: Role },
    @Res() res: Response,
  ) {
    const pdf = await this.analyticsService.getStudentPerformancePdf(user.id, user);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="performance-report-${user.id}.pdf"; ` +
        `filename*=UTF-8''${encodeURIComponent('تقرير الأداء.pdf')}`,
    );
    res.send(pdf);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('analytics/teacher')
  @ApiOperation({
    summary:
      'Teacher course-level analytics: students, activity, completion, exam scores, revenue (DB-aggregated). ADMIN may pass ?teacherId= (User id) to scope to one teacher.',
  })
  getTeacherAnalytics(
    @Query('teacherId') teacherId?: string,
    @CurrentUser() user?: { id: string; role: Role },
  ) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return this.analyticsService.getTeacherAnalytics(
      user!.id,
      user!,
      teacherId && isUuid.test(teacherId) ? teacherId : undefined,
    );
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('analytics/teacher/courses/:courseId')
  @ApiOperation({
    summary: 'Lesson & exam level analytics for one course (most watched, drop-offs, pass rates).',
  })
  getTeacherCourseAnalytics(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.analyticsService.getTeacherCourseAnalytics(courseId, user.id, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('analytics/teacher/question-stats')
  @ApiOperation({
    summary:
      'Per-question wrong-answer statistics across exams, quizzes and homeworks — the hardest questions first.',
  })
  getTeacherQuestionStats(
    @Query('courseId') courseId?: string,
    @Query('limit') limitStr?: string,
    @Query('teacherId') teacherId?: string,
    @CurrentUser() user?: { id: string; role: Role },
  ) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const parsedLimit = Number.parseInt(limitStr ?? '', 10);
    return this.analyticsService.getTeacherQuestionStats(
      user!.id,
      user!,
      courseId && isUuid.test(courseId) ? courseId : undefined,
      Number.isFinite(parsedLimit) ? parsedLimit : 10,
      teacherId && isUuid.test(teacherId) ? teacherId : undefined,
    );
  }
}
