import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsString, IsOptional, IsBoolean, IsInt, Min, Max, MinLength, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { LessonQaService } from './lesson-qa.service';

class UpdateQuestionBodyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;
}

class AddAnswerBodyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  videoUrl?: string;
}

class ListQuestionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsBoolean()
  onlyUnanswered?: boolean;
}

@ApiTags('Lesson Q&A')
@ApiBearerAuth('bearer')
@Controller()
export class LessonQaController {
  constructor(private readonly qaService: LessonQaService) {}

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @Post('lessons/:lessonId/questions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ask a question on a lesson (enrolled students).' })
  createQuestion(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: UpdateQuestionBodyDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.qaService.createQuestion(lessonId, dto.content, user);
  }

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @Get('lessons/:lessonId/questions')
  @ApiOperation({ summary: 'List questions for a lesson (pinned first), with answers.' })
  listQuestions(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Query() query: ListQuestionsQueryDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.qaService.listQuestions(lessonId, user, query);
  }

  @Roles(Role.STUDENT)
  @Patch('questions/:id')
  @ApiOperation({ summary: 'Edit own unanswered question.' })
  updateQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuestionBodyDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.qaService.updateQuestion(id, dto.content, user);
  }

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @Delete('questions/:id')
  @ApiOperation({ summary: 'Delete own question (teachers/admins may delete any in their course).' })
  deleteQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.qaService.deleteQuestion(id, user);
  }

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @Post('questions/:id/answers')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Reply to a question. Teacher replies mark the question answered.' })
  addAnswer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddAnswerBodyDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.qaService.addAnswer(id, dto.content, user, dto.videoUrl);
  }

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @Patch('answers/:id')
  @ApiOperation({ summary: 'Edit own answer.' })
  updateAnswer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddAnswerBodyDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.qaService.updateAnswer(id, dto.content, user, dto.videoUrl);
  }

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @Delete('answers/:id')
  @ApiOperation({ summary: 'Delete answer (author or course teacher/admin).' })
  deleteAnswer(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.qaService.deleteAnswer(id, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post('questions/:id/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle pin state of a question (teacher owner).' })
  togglePin(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.qaService.togglePin(id, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post('questions/:id/mark-answered')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a question as answered (teacher owner).' })
  markAnswered(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.qaService.markAnswered(id, user);
  }
}
