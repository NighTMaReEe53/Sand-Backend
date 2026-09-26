import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { Role } from '@prisma/client';
import { ParentService } from './parent.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

class ParentResultsQueryDto {
  @IsOptional()
  @Matches(/^[0-9a-fA-F-]{36}$/, { message: 'معرف الكورس غير صالح.' })
  courseId?: string;

  @IsOptional()
  @IsIn(['ALL', 'EXAM', 'QUIZ', 'HOMEWORK'])
  type?: 'ALL' | 'EXAM' | 'QUIZ' | 'HOMEWORK';

  @IsOptional()
  @IsIn(['ALL', 'PASSED', 'FAILED'])
  status?: 'ALL' | 'PASSED' | 'FAILED';
}

class ParentLessonsQueryDto {
  @IsOptional()
  @Matches(/^[0-9a-fA-F-]{36}$/, { message: 'معرف الكورس غير صالح.' })
  courseId?: string;
}

@ApiTags('Parent')
@ApiBearerAuth()
@Roles(Role.PARENT)
@Controller('parent')
export class ParentController {
  constructor(private readonly parentService: ParentService) {}

  @Get('me')
  @ApiOperation({ summary: '[PARENT] My account + linked children (students who registered my phone)' })
  getMe(@CurrentUser() user: any) {
    return this.parentService.getMyChildren({ id: user.id, phone: user.phone });
  }

  @Get('students/:studentId/profile')
  @ApiOperation({ summary: '[PARENT] Child profile + overall stats + courses (for filters)' })
  @ApiParam({ name: 'studentId', type: 'string', format: 'uuid' })
  getStudentProfile(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: any,
  ) {
    return this.parentService.getStudentProfile(user.phone, studentId);
  }

  @Get('students/:studentId/results')
  @ApiOperation({
    summary:
      '[PARENT] Child results: exam/quiz/homework attempts with grades + PDF paper links. Filters: courseId, type=ALL|EXAM|QUIZ|HOMEWORK, status=ALL|PASSED|FAILED.',
  })
  @ApiParam({ name: 'studentId', type: 'string', format: 'uuid' })
  getStudentResults(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: ParentResultsQueryDto,
    @CurrentUser() user: any,
  ) {
    return this.parentService.getStudentResults(user.phone, studentId, query);
  }

  @Get('students/:studentId/lessons')
  @ApiOperation({
    summary:
      '[PARENT] Child lessons per enrolled course: taken vs not-taken. Filter: courseId.',
  })
  @ApiParam({ name: 'studentId', type: 'string', format: 'uuid' })
  getStudentLessons(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: ParentLessonsQueryDto,
    @CurrentUser() user: any,
  ) {
    return this.parentService.getStudentLessons(user.phone, studentId, query.courseId);
  }

  @Get('students/:studentId/weekly-report')
  @ApiOperation({
    summary:
      '[PARENT] Child weekly performance report (snapshot refreshed every week). Filters: courseId, weekStart (ISO date).',
  })
  @ApiParam({ name: 'studentId', type: 'string', format: 'uuid' })
  getStudentWeeklyReport(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query('courseId') courseId: string,
    @Query('weekStart') weekStart: string,
    @CurrentUser() user: any,
  ) {
    return this.parentService.getStudentWeeklyReport(
      user.phone,
      studentId,
      courseId,
      weekStart,
    );
  }
}
