import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { LessonsService } from './lessons.service';
import { CreateLessonDto } from './dtos/create-lesson.dto';
import { UpdateLessonDto } from './dtos/update-lesson.dto';
import { ReorderLessonsDto } from './dtos/reorder-lessons.dto';
import { ConfirmVideoDto } from './dtos/confirm-video.dto';

@ApiTags('Lessons')
@ApiBearerAuth('bearer')
@Controller()
export class LessonsController {
  constructor(private readonly lessonsService: LessonsService) {}

  @Public()
  @Get('courses/:id/lessons')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all lessons for a course (Teacher Owner, Admin, Enrolled Student, or Guest Outline)' })
  @ApiResponse({ status: 200, description: 'Lessons list returned.' })
  @ApiResponse({ status: 404, description: 'Course not found.' })
  async getCourseLessons(
    @Param('id') courseId: string,
    @CurrentUser() user?: any,
  ) {
    return this.lessonsService.getCourseLessons(courseId, user);
  }

  @Roles(Role.TEACHER)
  @Post('courses/:id/lessons')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a new lesson to a course (Teacher Owner Only)' })
  @ApiResponse({ status: 201, description: 'Lesson created successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Not course owner.' })
  async createLesson(
    @Param('id') courseId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateLessonDto,
  ) {
    return this.lessonsService.createLesson(courseId, userId, dto);
  }

  @Roles(Role.TEACHER)
  @Patch('lessons/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update lesson details (Teacher Owner Only)' })
  @ApiResponse({ status: 200, description: 'Lesson updated successfully.' })
  async updateLesson(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateLessonDto,
  ) {
    return this.lessonsService.updateLesson(id, userId, dto);
  }

  @Roles(Role.TEACHER)
  @Delete('lessons/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete a lesson (Teacher Owner Only)' })
  @ApiResponse({ status: 200, description: 'Lesson deleted successfully.' })
  async deleteLesson(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.lessonsService.deleteLesson(id, userId);
  }

  @Roles(Role.TEACHER)
  @Post('lessons/reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reorder lessons within a course (Teacher Owner Only)' })
  @ApiResponse({ status: 200, description: 'Lessons reordered successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid lessons or mismatch with courseId.' })
  async reorderLessons(
    @CurrentUser('id') userId: string,
    @Body() dto: ReorderLessonsDto,
  ) {
    return this.lessonsService.reorderLessons(userId, dto);
  }

  @Roles(Role.TEACHER)
  @Post('lessons/:id/video-upload-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate Presigned PUT URL for direct client-to-storage video upload (Bypasses Backend)',
  })
  @ApiQuery({ name: 'fileName', required: false, example: 'lesson_video.mp4' })
  @ApiQuery({ name: 'contentType', required: false, example: 'video/mp4' })
  @ApiResponse({ status: 200, description: 'Presigned upload URL returned.' })
  async getVideoUploadUrl(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Query('fileName') fileName?: string,
    @Query('contentType') contentType?: string,
  ) {
    return this.lessonsService.getVideoUploadUrl(
      id,
      userId,
      fileName || 'lesson_video.mp4',
      contentType || 'video/mp4',
    );
  }

  @Roles(Role.TEACHER)
  @Post('lessons/:id/video')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 200 * 1024 * 1024, // 200MB Max Video Size
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a local video file directly to a lesson (multipart/form-data)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Video file (video/* <= 200MB)',
        },
        durationSeconds: {
          type: 'integer',
          description: 'Optional video duration in seconds',
          example: 4200,
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Video uploaded and lesson updated.' })
  @ApiResponse({ status: 400, description: 'Invalid or missing video file.' })
  async uploadLessonVideo(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('durationSeconds') durationSeconds?: string,
  ) {
    return this.lessonsService.uploadLessonVideoFile(
      id,
      userId,
      file,
      durationSeconds !== undefined && durationSeconds !== '' ? Number(durationSeconds) : undefined,
    );
  }

  @Roles(Role.TEACHER)
  @Patch('lessons/:id/confirm-video')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm video upload and update video URL on lesson' })
  @ApiResponse({ status: 200, description: 'Video confirmed and updated.' })
  async confirmVideoUpload(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ConfirmVideoDto,
  ) {
    return this.lessonsService.confirmVideoUpload(id, userId, dto);
  }

  @Get('lessons/:id/access')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Phase 1 — Lightweight per-student lesson access state (AVAILABLE / IN_PROGRESS / COMPLETED / LOCKED + reason)',
  })
  @ApiResponse({ status: 200, description: 'Lesson access state returned.' })
  async getLessonAccess(@Param('id') id: string, @CurrentUser() user?: any) {
    return this.lessonsService.getLessonAccess(id, user);
  }

  @Public()
  @Get('lessons/:id/stream-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get temporary Signed streaming URL for video (Owner, Free Preview, or Enrolled Student)',
  })
  @ApiResponse({ status: 200, description: 'Temporary Signed streaming URL returned (Valid 10 mins).' })
  @ApiResponse({ status: 403, description: 'Forbidden. Not enrolled in course.' })
  async getLessonStreamUrl(
    @Param('id') id: string,
    @CurrentUser() user?: any,
  ) {
    return this.lessonsService.getLessonStreamUrl(id, user);
  }
}
