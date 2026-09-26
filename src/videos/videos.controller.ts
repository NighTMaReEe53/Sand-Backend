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
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { VideosService } from './videos.service';
import { UpsertCourseVideoDto } from './dtos/upsert-course-video.dto';

@ApiTags('Course Custom Video')
@ApiBearerAuth('bearer')
@Controller()
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post('courses/:courseId/video')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[TEACHER/ADMIN] Create or replace the custom video of a course' })
  @ApiParam({ name: 'courseId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Course video saved.' })
  @ApiResponse({ status: 403, description: 'You do not own this course.' })
  upsertVideo(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: UpsertCourseVideoDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.videosService.upsertVideo(courseId, dto, user);
  }

  @Public()
  @Get('courses/:courseId/video')
  @ApiOperation({
    summary:
      '[PUBLIC] Get the custom course video — free preview visible to everyone (null if not set)',
  })
  @ApiParam({ name: 'courseId', type: 'string', format: 'uuid' })
  getVideo(@Param('courseId', ParseUUIDPipe) courseId: string) {
    return this.videosService.getVideo(courseId);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Delete('courses/:courseId/video')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[TEACHER/ADMIN] Remove/reset the custom video of a course' })
  @ApiParam({ name: 'courseId', type: 'string', format: 'uuid' })
  deleteVideo(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.videosService.deleteVideo(courseId, user);
  }
}
