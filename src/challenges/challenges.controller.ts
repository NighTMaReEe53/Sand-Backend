import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChallengesService } from './challenges.service';

export class CreateChallengeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  courseId!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'مطلوب في الوضع العادي فقط — يُتجاهل عند vsBot = true' })
  @IsOptional()
  @IsUUID()
  opponentUserId?: string;

  @ApiPropertyOptional({ default: false, description: 'اللعب ضد البوت — يقبل التحدي فوراً' })
  @IsOptional()
  @IsBoolean()
  vsBot?: boolean;

  @ApiProperty({ minimum: 1, maximum: 50, default: 10 })
  @IsInt()
  @Min(1)
  @Max(50)
  questionCount!: number;

  @ApiProperty({ minimum: 30, maximum: 3600, default: 300 })
  @IsInt()
  @Min(30)
  @Max(3600)
  durationSeconds!: number;
}

@ApiTags('Challenges')
@ApiBearerAuth('bearer')
@Roles(Role.STUDENT)
@Controller()
// تحديد challenges بالـ heavy tier — 20 request/min بدل 60
@Throttle({ heavy: { limit: 20, ttl: 60_000 } })
export class ChallengesController {
  constructor(private readonly challengesService: ChallengesService) {}

  @Post('challenges')
  @ApiOperation({
    summary:
      'Phase 4 — Challenge a student from the same course (server-validated eligibility, limits & fair question selection)',
  })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateChallengeDto) {
    return this.challengesService.createChallenge(userId, dto);
  }

  @Get('challenges')
  @ApiOperation({ summary: 'Phase 4 — My challenges history' })
  list(@CurrentUser('id') userId: string) {
    return this.challengesService.listMyChallenges(userId);
  }

  @Get('challenges/availability')
  @ApiOperation({
    summary:
      'Phase 4 — Whether the student has enough challengeable questions (> minimum) collected from all enrolled courses (bank + exam questions)',
  })
  availability(@CurrentUser('id') userId: string) {
    return this.challengesService.getAvailability(userId);
  }

  @Get('challenges/:id')
  @ApiOperation({ summary: 'Phase 4 — Sanitized challenge detail (no correct answers)' })
  getDetail(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.challengesService.getMyQuestions(id, userId);
  }

  @Post('challenges/:id/accept')
  @ApiOperation({ summary: 'Phase 4 — Accept invitation (freezes question snapshot)' })
  accept(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.challengesService.acceptChallenge(id, userId);
  }

  @Post('challenges/:id/reject')
  @ApiOperation({ summary: 'Phase 4 — Reject invitation' })
  reject(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.challengesService.rejectChallenge(id, userId);
  }

  @Post('challenges/:id/start')
  @ApiOperation({ summary: 'Phase 4 — Start (server-authoritative timer begins)' })
  start(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.challengesService.startChallenge(id, userId);
  }

  @Post('challenges/:id/answers')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Phase 4 — Submit one answer (validates player, status, deadline, snapshot ownership, duplicates)',
  })
  submitAnswer(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { questionId: string; selectedOption: number },
  ) {
    return this.challengesService.submitAnswer(id, userId, dto);
  }

  @Post('challenges/:id/finish')
  @ApiOperation({ summary: 'Phase 4 — Finish my part; result stays hidden until both done/expiry' })
  finish(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.challengesService.finishMyPart(id, userId);
  }

  @Get('challenges/:id/result')
  @ApiOperation({ summary: 'Phase 4 — Result (revealed only after both finish or time expiry)' })
  result(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.challengesService.getResult(id, userId);
  }

  @Get('courses/:courseId/online-students')
  @ApiQuery({ name: 'courseId', required: false })
  @ApiOperation({ summary: 'Phase 4/5 — Server-computed online students in a course (excludes the requester)' })
  onlineStudents(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.challengesService.getOnlineStudents(courseId, userId);
  }

  @Post('students/me/heartbeat')
  @ApiOperation({ summary: 'Phase 5 — Presence heartbeat (lastSeenAt updated server-side)' })
  heartbeat(@CurrentUser('id') userId: string) {
    return this.challengesService.heartbeat(userId);
  }
}
