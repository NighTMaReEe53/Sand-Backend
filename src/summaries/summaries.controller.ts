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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SummariesService } from './summaries.service';
import { CreateSummaryDto, ModerateSummaryDto, CreateSummaryCommentDto } from './dto/summaries.dto';

class ListSummariesQueryDto {
  @IsOptional() @IsString() courseId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @IsString() sort?: string;
}

class ModerationQueryDto {
  @IsOptional() @IsString() courseId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

class MySummariesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

@ApiTags('Summaries')
@ApiBearerAuth('bearer')
@Controller()
export class SummariesController {
  constructor(private readonly summariesService: SummariesService) {}

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @Post('community/media')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Upload an image or video for community content.' })
  uploadCommunityMedia(@CurrentUser() user: { id: string; role: Role }, @UploadedFile() file?: Express.Multer.File) {
    return this.summariesService.uploadCommunityMedia(user, file);
  }

  @Roles(Role.STUDENT)
  @Post('summaries')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Student submits a summary for moderation.' })
  createSummary(
    @CurrentUser() user: { id: string; role: Role },
    @Body() dto: CreateSummaryDto,
  ) {
    return this.summariesService.createSummary(user, dto);
  }

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @Get('summaries')
  @ApiOperation({ summary: 'List approved summaries for a course.' })
  listSummaries(
    @CurrentUser() user: { id: string; role: Role },
    @Query() query: ListSummariesQueryDto,
  ) {
    return this.summariesService.listApprovedSummaries(user, query.courseId!, query);
  }

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @Get('summaries/:id')
  @ApiOperation({ summary: 'Get summary detail with comments.' })
  getSummary(
    @CurrentUser() user: { id: string; role: Role },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.summariesService.getSummaryDetail(user, id);
  }

  @Roles(Role.STUDENT)
  @Get('my-summaries')
  @ApiOperation({ summary: 'List own summaries with status.' })
  mySummaries(
    @CurrentUser() user: { id: string; role: Role },
    @Query() query: MySummariesQueryDto,
  ) {
    return this.summariesService.getMySummaries(user, query);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('teacher/summaries/moderation')
  @ApiOperation({ summary: 'Teacher moderation queue.' })
  moderationQueue(
    @CurrentUser() user: { id: string; role: Role },
    @Query() query: ModerationQueryDto,
  ) {
    return this.summariesService.getModerationQueue(user, query);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Patch('teacher/summaries/:id/moderate')
  @ApiOperation({ summary: 'Approve or reject a summary.' })
  moderateSummary(
    @CurrentUser() user: { id: string; role: Role },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateSummaryDto,
  ) {
    return this.summariesService.moderateSummary(user, id, dto);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Patch('teacher/summaries/:id')
  updateSummary(@CurrentUser() user: { id: string; role: Role }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: Partial<CreateSummaryDto>) {
    return this.summariesService.updateSummary(user, id, dto);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Delete('teacher/summaries/:id')
  deleteSummary(@CurrentUser() user: { id: string; role: Role }, @Param('id', ParseUUIDPipe) id: string) {
    return this.summariesService.deleteSummary(user, id);
  }

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @Post('summaries/:id/comments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a comment to a summary.' })
  addComment(
    @CurrentUser() user: { id: string; role: Role },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSummaryCommentDto,
  ) {
    return this.summariesService.addComment(user, id, dto);
  }

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @Get('summaries/leaderboard/:courseId')
  @ApiOperation({ summary: 'Leaderboard of top summaries for a course.' })
  leaderboard(
    @CurrentUser() user: { id: string; role: Role },
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.summariesService.getLeaderboard(user, courseId);
  }
}
