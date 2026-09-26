import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProgressService } from './progress.service';
import { UpdateProgressDto } from './dtos/update-progress.dto';

class TeacherStudentsQueryDto {
  @ApiPropertyOptional({
    enum: ['most_active', 'least_active', 'not_started', 'completion_desc', 'completion_asc'],
    description: 'Sort/filter students by engagement or completion.',
  })
  @IsOptional()
  @IsIn(['most_active', 'least_active', 'not_started', 'completion_desc', 'completion_asc'])
  sort?: string;
}

@ApiTags('Progress Tracking')
@ApiBearerAuth('bearer')
@Controller()
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Roles(Role.STUDENT)
  @Post('lessons/:id/progress')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update video watched percentage for a lesson (Student Enrolled Only)',
    description: 'Auto-marks lesson as completed when watchedPercentage reaches 90% or higher.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid', description: 'Lesson UUID' })
  @ApiResponse({ status: 200, description: 'Progress updated successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Must have an active enrollment.' })
  @ApiResponse({ status: 404, description: 'Lesson not found.' })
  updateLessonProgress(
    @Param('id', ParseUUIDPipe) lessonId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProgressDto,
  ) {
    return this.progressService.updateLessonProgress(lessonId, userId, dto);
  }

  @Roles(Role.STUDENT)
  @Get('courses/:id/progress')
  @ApiOperation({
    summary: 'Get detailed lesson-by-lesson progress in a course (Student Enrolled Only)',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid', description: 'Course UUID' })
  @ApiResponse({ status: 200, description: 'Course progress returned.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Must have an active enrollment.' })
  @ApiResponse({ status: 404, description: 'Course not found.' })
  getCourseProgress(
    @Param('id', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.progressService.getCourseProgress(courseId, userId);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('teacher/courses/:id/students')
  @ApiOperation({
    summary:
      'Per-student progress overview for a course (Teacher Owner / Admin): completion %, last lesson, last activity, latest quiz score.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid', description: 'Course UUID' })
  @ApiResponse({ status: 200, description: 'Students progress list returned.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Not the course owner.' })
  getTeacherCourseStudents(
    @Param('id', ParseUUIDPipe) courseId: string,
    @CurrentUser() user: { id: string; role: Role },
    @Query() query: TeacherStudentsQueryDto,
  ) {
    return this.progressService.getTeacherCourseStudents(courseId, query.sort, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('teacher/courses/:id/students/:studentId')
  @ApiOperation({
    summary:
      'Detailed progress for one student in a course (Teacher Owner / Admin): every lesson status + quiz scores.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid', description: 'Course UUID' })
  @ApiParam({ name: 'studentId', type: 'string', format: 'uuid', description: 'StudentProfile UUID' })
  @ApiResponse({ status: 200, description: 'Student detailed progress returned.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Not the course owner or student not enrolled.' })
  getTeacherStudentDetail(
    @Param('id', ParseUUIDPipe) courseId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.progressService.getTeacherStudentDetail(courseId, studentId, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Delete('teacher/courses/:id/students/:studentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '[TEACHER/ADMIN] Remove a student from a course (cancels their enrollment).',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid', description: 'Course UUID' })
  @ApiParam({ name: 'studentId', type: 'string', format: 'uuid', description: 'StudentProfile UUID' })
  @ApiResponse({ status: 200, description: 'Student removed from the course.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Not the course owner.' })
  @ApiResponse({ status: 404, description: 'Enrollment not found.' })
  removeStudentFromCourse(
    @Param('id', ParseUUIDPipe) courseId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.progressService.removeStudentFromCourse(courseId, studentId, user);
  }
}
