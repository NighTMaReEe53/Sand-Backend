import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ExamsService } from './exams.service';
import { LeaderboardService } from './leaderboard.service';
import { CreateExamDto } from './dtos/create-exam.dto';
import { UpdateExamDto } from './dtos/update-exam.dto';
import { CreateQuestionDto } from './dtos/create-question.dto';
import { UpdateQuestionDto } from './dtos/update-question.dto';
import { SubmitExamDto } from './dtos/submit-exam.dto';
import { RecordExamExitDto } from './dtos/record-exam-exit.dto';
import { GenerateMistakePracticeDto, SubmitMistakePracticeDto } from './dtos/mistake-practice.dto';

@ApiTags('Exams & Question Bank')
@ApiBearerAuth('bearer')
@Controller()
// Exams polling ثقيل وقت الامتحانات — heavy tier
@Throttle({ heavy: { limit: 20, ttl: 60_000 } })
export class ExamsController {
  constructor(
    private readonly examsService: ExamsService,
    private readonly leaderboardService: LeaderboardService,
  ) {}

  // ─── Phase 3: Student-facing per-exam leaderboard ──────────────


  @Get('exams/:id/leaderboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Phase 3 — Top-10 leaderboard for ONE exam with Gold/Silver/Bronze medals (score DESC, time ASC, submitted ASC)',
  })
  @ApiQuery({ name: 'limit', required: false })
  getExamLeaderboard(
    @Param('id', ParseUUIDPipe) examId: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: any,
  ) {
    return this.leaderboardService.getExamLeaderboard(
      examId,
      Number(limit) || 10,
      user?.id,
    );
  }

  // ─── Phase 3: My Achievements (medals scoped to student+exam) ──

  @Get('students/me/achievements')
  @Roles(Role.STUDENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Phase 3 — My medal achievements across all exams (🥇/🥈/🥉 counts + history). Never a flat field on User.",
  })
  getMyAchievements(@CurrentUser('id') userId: string) {
    return this.leaderboardService.getMyAchievements(userId);
  }

  // ─── TEACHER Endpoints ─────────────────────────────────────────

  @Post('courses/:courseId/exams')
  @Roles(Role.TEACHER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[TEACHER] Create a new exam for a course or lesson' })
  @ApiParam({ name: 'courseId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Exam created successfully.' })
  @ApiResponse({ status: 403, description: 'Access denied.' })
  @ApiResponse({ status: 404, description: 'Course or lesson not found.' })
  createExam(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: CreateExamDto,
    @CurrentUser() user: any,
  ) {
    return this.examsService.createExam(courseId, dto, user);
  }

  @Post('exams/attempts/:attemptId/submit')
  @Roles(Role.STUDENT)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 submissions per minute (anti-abuse)
  @ApiOperation({
    summary:
      '[STUDENT] Submit answers — auto-graded atomically in $transaction. Returns score and optionally model answers.',
  })
  @ApiParam({ name: 'attemptId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Exam submitted and graded.' })
  @ApiResponse({ status: 409, description: 'Already submitted.' })
  submitExam(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Headers('x-exam-session') sessionKey: string | undefined,
    @Body() dto: SubmitExamDto,
    @CurrentUser() user: any,
  ) {
    return this.examsService.submitExam(attemptId, dto, user, sessionKey);
  }

  @Post('exam-attempts/:attemptId/exit')
  @Roles(Role.STUDENT)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: '[STUDENT] Record one idempotent in-progress exam exit for private leaderboard eligibility.',
  })
  recordExamExit(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Headers('x-exam-session') sessionKey: string | undefined,
    @Body() dto: RecordExamExitDto,
    @CurrentUser() user: any,
  ) {
    return this.examsService.recordExamExit(attemptId, dto, user, sessionKey);
  }

  @Get('exams/attempts/:attemptId/result')
  @Roles(Role.STUDENT)
  @ApiOperation({
    summary:
      "[STUDENT] Get attempt result — shows score, pass/fail, and optionally model answers if teacher enabled",
  })
  @ApiParam({ name: 'attemptId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Result returned.' })
  getAttemptResult(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: any,
  ) {
    return this.examsService.getAttemptResult(attemptId, user);
  }

  @Get('exams/attempts/:attemptId/detail')
  @Roles(Role.TEACHER, Role.ADMIN)
  @ApiOperation({ summary: "[TEACHER/ADMIN] Get the full answer sheet of a student's attempt" })
  @ApiParam({ name: 'attemptId', type: 'string', format: 'uuid' })
  getAttemptDetail(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: any,
  ) {
    return this.examsService.getAttemptDetail(attemptId, user);
  }

  @Post('exams/:id/students/:studentId/reactivate')
  @Roles(Role.TEACHER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[TEACHER] Reactivate student exam attempts / reset lock' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'studentId', type: 'string', format: 'uuid' })
  reactivateStudentExam(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: any,
  ) {
    return this.examsService.reactivateStudentExamAttempt(id, studentId, user);
  }

  @Patch('exams/:id')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: '[TEACHER] Update exam details or publish exam' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Exam updated successfully.' })
  updateExam(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExamDto,
    @CurrentUser() user: any,
  ) {
    return this.examsService.updateExam(id, dto, user);
  }

  @Delete('exams/:id')
  @Roles(Role.TEACHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[TEACHER] Soft-delete an exam' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Exam deleted successfully.' })
  deleteExam(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.examsService.deleteExam(id, user);
  }

  @Post('exams/:id/questions')
  @Roles(Role.TEACHER, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[TEACHER/ADMIN] Add a multiple-choice question to an exam' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Question added successfully.' })
  addQuestion(
    @Param('id', ParseUUIDPipe) examId: string,
    @Body() dto: CreateQuestionDto,
    @CurrentUser() user: any,
  ) {
    return this.examsService.addQuestion(examId, dto, user);
  }

  @Patch('questions/:id')
  @Roles(Role.TEACHER, Role.ADMIN)
  @ApiOperation({ summary: '[TEACHER/ADMIN] Update a question' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  updateQuestion(
    @Param('id', ParseUUIDPipe) questionId: string,
    @Body() dto: UpdateQuestionDto,
    @CurrentUser() user: any,
  ) {
    return this.examsService.updateQuestion(questionId, dto, user);
  }

  @Get('exams/:id/questions')
  @Roles(Role.TEACHER, Role.ADMIN)
  @ApiOperation({ summary: '[TEACHER/ADMIN] Get all questions and details for an exam' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Exam details and questions returned.' })
  getExamQuestions(
    @Param('id', ParseUUIDPipe) examId: string,
    @CurrentUser() user: any,
  ) {
    return this.examsService.getExamQuestions(examId, user);
  }

  @Post('exams/:id/questions/upload-image')
  @Roles(Role.TEACHER, Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '[TEACHER/ADMIN] Upload an illustration image for a question (max 5MB)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Image uploaded successfully.' })
  uploadQuestionImage(
    @Param('id', ParseUUIDPipe) examId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    return this.examsService.uploadQuestionImage(examId, file, user);
  }

  @Delete('questions/:id')
  @Roles(Role.TEACHER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[TEACHER] Soft-delete a question' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  deleteQuestion(
    @Param('id', ParseUUIDPipe) questionId: string,
    @CurrentUser() user: any,
  ) {
    return this.examsService.deleteQuestion(questionId, user);
  }

  @Get('exams/:id/submissions')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: '[TEACHER] Get all student submissions and statistics for an exam' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Submissions and statistics.' })
  getExamSubmissions(
    @Param('id', ParseUUIDPipe) examId: string,
    @CurrentUser() user: any,
  ) {
    return this.examsService.getExamSubmissions(examId, user);
  }

  @Post('exams/:id/add-from-bank')
  @Roles(Role.TEACHER, Role.ADMIN)
  @ApiOperation({ summary: '[TEACHER] Copy questions from the question bank into an exam' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  addFromBank(
    @Param('id', ParseUUIDPipe) examId: string,
    @Body() dto: { bankQuestionIds: string[] },
    @CurrentUser() user: any,
  ) {
    return this.examsService.addQuestionsFromBank(examId, dto.bankQuestionIds, user);
  }

  @Get('exams/:id/rankings')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: '[TEACHER] Top or bottom scoring students for an exam' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'order', enum: ['top', 'bottom'], required: false })
  getExamRankings(
    @Param('id', ParseUUIDPipe) examId: string,
    @Query('order') order: 'top' | 'bottom',
    @CurrentUser() user: any,
  ) {
    return this.examsService.getExamRankings(examId, order === 'bottom' ? 'bottom' : 'top', user);
  }

  // ─── STUDENT Endpoints ─────────────────────────────────────────

  @Get('courses/:courseId/exams')
  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @ApiOperation({ summary: 'List exams in a course (Students see published; Teachers/Admins see all)' })
  @ApiParam({ name: 'courseId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'List of available exams.' })
  @ApiResponse({ status: 403, description: 'Not enrolled in this course or not the course owner.' })
  getCourseExams(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser() user: any,
  ) {
    return this.examsService.getCourseExams(courseId, user);
  }

  @Post('exams/:id/start')
  @Roles(Role.STUDENT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      '[STUDENT] Start an exam attempt — returns questions WITHOUT correct answers (anti-cheat)',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Exam started. Attempt info and questions returned.' })
  @ApiResponse({ status: 403, description: 'Not enrolled / max attempts reached / window closed.' })
  startExam(
    @Param('id', ParseUUIDPipe) examId: string,
    @Headers('x-exam-session') sessionKey: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.examsService.startExam(examId, user, sessionKey);
  }

  @Get('exams/:id/my-attempts')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: "[STUDENT] List my attempts for a specific exam" })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  getMyAttempts(
    @Param('id', ParseUUIDPipe) examId: string,
    @CurrentUser() user: any,
  ) {
    return this.examsService.getMyAttempts(examId, user);
  }

  @Get('exam-attempts/:attemptId/question/:index')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: '[STUDENT] Get question by index in the fixed randomized sequence' })
  @ApiParam({ name: 'attemptId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'index', type: 'number' })
  getAttemptQuestion(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Param('index') index: string,
    @Headers('x-exam-session') sessionKey: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.examsService.getAttemptQuestion(attemptId, parseInt(index, 10) || 0, user, sessionKey);
  }

  @Post('exam-attempts/:attemptId/answer')
  @Roles(Role.STUDENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[STUDENT] Submit answer for current question and proceed' })
  @ApiParam({ name: 'attemptId', type: 'string', format: 'uuid' })
  submitSingleAnswer(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Headers('x-exam-session') sessionKey: string | undefined,
    @Body() dto: { questionId: string; selectedOptionIndex: number; finish?: boolean },
    @CurrentUser() user: any,
  ) {
    return this.examsService.submitSingleAnswer(attemptId, dto, user, sessionKey);
  }

  @Get('exam-attempts/:attemptId/result/pdf')
  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN, Role.PARENT)
  @ApiOperation({ summary: '[STUDENT/TEACHER] Download PDF certificate / detailed result review' })
  @ApiParam({ name: 'attemptId', type: 'string', format: 'uuid' })
  async downloadResultPdf(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: any,
    @Res() res: any,
  ) {
    const { buffer, fileName } = await this.examsService.generateResultPdf(attemptId, user);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        `attachment; filename="exam-result-${attemptId.slice(0, 8)}.pdf"; ` +
        `filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('students/me/results')
  @Roles(Role.STUDENT)
  @ApiOperation({
    summary:
      '[STUDENT] All my graded attempts across every course — exam attempts + quiz attempts.',
  })
  getMyResults(@CurrentUser() user: any) {
    return this.examsService.getMyResults(user);
  }

  @Get('students/me/mistakes')
  @Roles(Role.STUDENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '[STUDENT] My mistakes notebook — every wrong answer from submitted exams & quizzes, grouped by section → source → date, with correct vs. chosen answers.',
  })
  getMyMistakes(@CurrentUser() user: any) {
    return this.examsService.getMyMistakes(user);
  }


  @Post('students/me/mistakes/practice-exam')
  @Roles(Role.STUDENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[STUDENT] Generate a timed practice exam from recorded mistakes (by group, course, or all)',
  })
  generateMistakePracticeExam(
    @CurrentUser() user: any,
    @Body() dto: GenerateMistakePracticeDto,
  ) {
    return this.examsService.generateMistakePracticeExam(user, dto);
  }

  @Post('students/me/mistakes/practice-exam/submit')
  @Roles(Role.STUDENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[STUDENT] Submit and evaluate a mistake practice exam',
  })
  submitMistakePracticeExam(
    @CurrentUser() user: any,
    @Body() dto: SubmitMistakePracticeDto,
  ) {
    return this.examsService.submitMistakePracticeExam(user, dto);
  }

}
