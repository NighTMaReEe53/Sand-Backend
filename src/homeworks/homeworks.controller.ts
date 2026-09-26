import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { HomeworksService } from './homeworks.service';
import {
  CreateHomeworkDto,
  CreateHomeworkQuestionDto,
  GradeEssayAnswerDto,
  SubmitHomeworkDto,
  UpdateHomeworkDto,
  UpdateHomeworkQuestionDto,
} from './dtos/homework.dtos';

@ApiTags('Homeworks')
@ApiBearerAuth('bearer')
@Controller()
export class HomeworksController {
  constructor(private readonly homeworksService: HomeworksService) {}

  // ─── TEACHER ───────────────────────────────────────────────
  @Roles(Role.TEACHER, Role.ADMIN)
  @Post('lessons/:lessonId/homework')
  @ApiOperation({ summary: 'Create homework attached to a lesson (Teacher Owner).' })
  create(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: CreateHomeworkDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.homeworksService.createHomework(lessonId, dto, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Patch('homework/:id')
  @ApiOperation({ summary: 'Update homework settings (Teacher Owner).' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHomeworkDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.homeworksService.updateHomework(id, dto, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Delete('homework/:id')
  @ApiOperation({ summary: 'Soft-delete a homework (Teacher Owner).' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string; role: Role }) {
    return this.homeworksService.deleteHomework(id, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post('homework/:id/pdf')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  @ApiOperation({
    summary: 'Upload the homework sheet (PDF / DOC / DOCX / PPT / PPTX) — Teacher Owner.',
  })
  uploadPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.homeworksService.uploadSheet(id, file, user);
  }

  @Roles(Role.STUDENT)
  @Post('homework-attempts/:id/answers/:questionId/image')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Upload an image answer for one question during an active attempt (Student).',
  })
  uploadAnswerImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('id') userId: string,
  ) {
    return this.homeworksService.uploadAnswerImage(id, questionId, file, userId);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post('homework/:id/questions')
  @ApiOperation({ summary: 'Add a question to a homework (Teacher Owner).' })
  addQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateHomeworkQuestionDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.homeworksService.addQuestion(id, dto, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Patch('homework-questions/:id')
  @ApiOperation({ summary: 'Update a homework question (Teacher Owner).' })
  updateQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHomeworkQuestionDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.homeworksService.updateQuestion(id, dto, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Delete('homework-questions/:id')
  @ApiOperation({ summary: 'Soft-delete a homework question (Teacher Owner).' })
  deleteQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.homeworksService.deleteQuestion(id, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('lessons/:id/homeworks')
  @ApiOperation({ summary: 'List homeworks of a lesson with full questions (Teacher Owner).' })
  teacherList(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.homeworksService.getLessonHomeworksForTeacher(id, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN, Role.STUDENT)
  @Get('homework-attempts/:id/detail')
  @ApiOperation({ summary: 'Full answer sheet of one attempt. Students see their own; teachers see any they own.' })
  getAttemptDetail(
    @Param('id', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.homeworksService.getTeacherAttemptDetail(attemptId, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('homework/:id/submissions')
  @ApiOperation({
    summary: 'List all submitted attempts for a homework with essay pending count (Teacher Owner).',
  })
  listSubmissions(
    @Param('id', ParseUUIDPipe) homeworkId: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.homeworksService.listSubmissions(homeworkId, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Patch('homework-attempts/:id/answers/:questionId/grade')
  @ApiOperation({
    summary:
      'Teacher grades a single essay / image answer. Recalculates attempt total. Sends notification when all essay questions are graded (Teacher Owner).',
  })
  gradeEssayAnswer(
    @Param('id', ParseUUIDPipe) attemptId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() dto: GradeEssayAnswerDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.homeworksService.gradeEssayAnswer(attemptId, questionId, dto, user);
  }

  // ─── STUDENT ───────────────────────────────────────────────
  @Roles(Role.STUDENT)
  @Get('lessons/:id/homework')
  @ApiOperation({
    summary: 'Get the published homework for a lesson with attempt status (Enrolled Student).',
  })
  getForStudent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.homeworksService.getLessonHomework(id, userId);
  }

  @Roles(Role.STUDENT)
  @Get('student/homework-results')
  @ApiOperation({
    summary: 'All of the student homeworks with their results (counts + score).',
  })
  getStudentResults(@CurrentUser('id') userId: string) {
    return this.homeworksService.getStudentResults(userId);
  }

  @Roles(Role.STUDENT)
  @Post('homework/:id/start')
  @ApiOperation({
    summary:
      'Start or resume a homework attempt. Questions are returned in PDF order — never shuffled.',
  })
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return this.homeworksService.startAttempt(id, userId);
  }

  @Roles(Role.STUDENT)
  @Post('homework-attempts/:id/submit')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Submit a homework attempt. The backend grades all answers.',
  })
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitHomeworkDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.homeworksService.submitAttempt(id, dto, userId);
  }

  // ─── SHARED (PDF sheet access) ────────────────────────────
  @Roles()
  @Get('homework/:id/pdf')
  @ApiOperation({ summary: 'Get a short-lived signed URL for the homework PDF.' })
  getPdfUrl(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string; role: Role }) {
    return this.homeworksService.getPdfUrl(id, user.id, user.role);
  }

  // ─── TEACHER DASHBOARD OVERVIEW ───────────────────────────
  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('teacher/homeworks/overview')
  @ApiOperation({ summary: 'List all homeworks across courses for teacher dashboard.' })
  getTeacherOverview(@CurrentUser() user: any) {
    return this.homeworksService.getAllTeacherHomeworks(user);
  }
}

