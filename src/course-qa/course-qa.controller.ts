import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QuestionStatus, Role } from '@prisma/client';
import { IsOptional, IsString, IsEnum, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CourseQaService } from './course-qa.service';
import { CreateCourseQuestionDto, CreateCourseReplyDto, UpdateQuestionStatusDto } from './dto/course-qa.dto';

class ListQuestionsQueryDto {
  @IsOptional() @IsString() courseId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @IsEnum(QuestionStatus) status?: QuestionStatus;
  @IsOptional() @Type(() => Boolean) @IsBoolean() mine?: boolean;
}

class TeacherInboxQueryDto {
  @IsOptional() @IsString() courseId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

@ApiTags('Course Q&A')
@ApiBearerAuth('bearer')
@Controller()
export class CourseQaController {
  constructor(private readonly qaService: CourseQaService) {}

  @Roles(Role.STUDENT)
  @Post('course-qa/questions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Student asks a course-scoped question.' })
  createQuestion(
    @CurrentUser() user: { id: string; role: Role },
    @Body() dto: CreateCourseQuestionDto,
  ) {
    return this.qaService.createQuestion(user, dto);
  }

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @Get('course-qa/questions')
  @ApiOperation({ summary: 'List questions for a course.' })
  listQuestions(
    @CurrentUser() user: { id: string; role: Role },
    @Query() query: ListQuestionsQueryDto,
  ) {
    return this.qaService.listQuestions(user, query.courseId!, query);
  }

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @Get('course-qa/questions/:id')
  @ApiOperation({ summary: 'Get a full question thread with nested replies.' })
  getQuestion(
    @CurrentUser() user: { id: string; role: Role },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.qaService.getQuestion(user, id);
  }

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @Post('course-qa/questions/:id/replies')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a reply to a question (threaded).' })
  addReply(
    @CurrentUser() user: { id: string; role: Role },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCourseReplyDto,
  ) {
    return this.qaService.addReply(user, id, dto);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Patch('course-qa/questions/:id/status')
  @ApiOperation({ summary: 'Mark question as ANSWERED or CLOSED.' })
  updateStatus(
    @CurrentUser() user: { id: string; role: Role },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuestionStatusDto,
  ) {
    return this.qaService.updateQuestionStatus(user, id, dto);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('teacher/course-qa/inbox')
  @ApiOperation({ summary: 'Teacher inbox: all questions across their courses.' })
  teacherInbox(
    @CurrentUser() user: { id: string; role: Role },
    @Query() query: TeacherInboxQueryDto,
  ) {
    return this.qaService.getTeacherInbox(user, query);
  }
}
