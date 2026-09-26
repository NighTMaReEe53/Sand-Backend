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
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { QuizzesService } from './quizzes.service';
import {
  CreateQuizDto,
  SubmitQuizDto,
  UpdateQuizDto,
  UpdateQuizQuestionDto,
} from './dtos/quiz.dtos';

@ApiTags('Mini Quizzes')
@ApiBearerAuth('bearer')
@Controller()
export class QuizzesController {
  constructor(private readonly quizzesService: QuizzesService) {}

  // ─── TEACHER endpoints ────────────────────────────────────────

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post('lessons/:lessonId/quiz')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a mini quiz attached to a lesson (Teacher Owner).' })
  createQuiz(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: CreateQuizDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.quizzesService.createQuiz(lessonId, dto, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Patch('quizzes/:id')
  @ApiOperation({ summary: 'Update quiz settings (Teacher Owner).' })
  updateQuiz(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuizDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.quizzesService.updateQuiz(id, dto, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Delete('quizzes/:id')
  @ApiOperation({ summary: 'Soft-delete a quiz (Teacher Owner).' })
  deleteQuiz(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.quizzesService.deleteQuiz(id, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post('quizzes/:id/students/:studentId/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate/reset a student quiz attempt (Teacher Owner).' })
  reactivateStudentQuiz(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.quizzesService.reactivateStudentQuizAttempt(id, studentId, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post('quizzes/:id/questions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a question to a quiz (Teacher Owner).' })
  addQuestion(
    @Param('id', ParseUUIDPipe) quizId: string,
    @Body()
    dto: {
      text: string;
      options: string[];
      correctOptionIndex: number;
      explanation?: string;
      marks?: number;
      orderIndex?: number;
    },
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.quizzesService.addQuestion(quizId, dto, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Patch('quiz-questions/:id')
  @ApiOperation({ summary: 'Update a quiz question (Teacher Owner).' })
  updateQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuizQuestionDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.quizzesService.updateQuestion(id, dto, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Delete('quiz-questions/:id')
  @ApiOperation({ summary: 'Soft-delete a quiz question (Teacher Owner).' })
  deleteQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.quizzesService.deleteQuestion(id, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('lessons/:id/quizzes')
  @ApiOperation({ summary: 'List quizzes of a lesson with full questions (Teacher Owner).' })
  getLessonQuizzes(
    @Param('id', ParseUUIDPipe) lessonId: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.quizzesService.getLessonQuizzesForTeacher(lessonId, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('quiz-attempts/:id/detail')
  @ApiOperation({
    summary:
      'Full answer sheet of one quiz attempt: every question with options, correct answer and the student choice (Teacher Owner).',
  })
  getAttemptDetail(
    @Param('id', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.quizzesService.getTeacherAttemptDetail(attemptId, user);
  }

  // ─── STUDENT endpoints ────────────────────────────────────────

  @Roles(Role.STUDENT)
  @Get('lessons/:id/quiz')
  @ApiOperation({
    summary: 'Get the published quiz for a lesson with attempt status (Enrolled Student).',
  })
  getLessonQuiz(
    @Param('id', ParseUUIDPipe) lessonId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.quizzesService.getLessonQuiz(lessonId, userId);
  }

  @Roles(Role.STUDENT)
  @Post('quizzes/:id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start or resume a quiz attempt. Questions are returned without correct answers.',
  })
  startAttempt(
    @Param('id', ParseUUIDPipe) quizId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.quizzesService.startAttempt(quizId, userId);
  }

  @Roles(Role.STUDENT)
  @Post('quiz-attempts/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit a quiz attempt. The backend grades all answers — never trust the frontend score.',
  })
  submitAttempt(
    @Param('id', ParseUUIDPipe) attemptId: string,
    @Body() dto: SubmitQuizDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.quizzesService.submitAttempt(attemptId, dto, userId);
  }

  @Roles(Role.STUDENT)
  @Get('quiz-attempts/:id/result')
  @ApiOperation({ summary: 'Get the graded result of a quiz attempt.' })
  getAttemptResult(
    @Param('id', ParseUUIDPipe) attemptId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.quizzesService.getAttemptResult(attemptId, userId);
  }

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN, Role.PARENT)
  @Get('quiz-attempts/:id/result/pdf')
  @ApiOperation({ summary: '[STUDENT/TEACHER/PARENT] Download the quiz attempt result review as PDF.' })
  async downloadResultPdf(
    @Param('id', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: { id: string; role: Role },
    @Res() res: any,
  ) {
    const { buffer, fileName } = await this.quizzesService.generateResultPdf(attemptId, user);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        `attachment; filename="quiz-result-${attemptId.slice(0, 8)}.pdf"; ` +
        `filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
