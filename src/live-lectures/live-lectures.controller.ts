import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { LiveLecturesService } from './live-lectures.service';
import { LiveLectureRoomService } from './live-lecture-room.service';
import { CreateLiveLectureDto } from './dto/create-live-lecture.dto';
import { UpdateLiveLectureDto } from './dto/update-live-lecture.dto';

@ApiTags('Live Lectures')
@ApiBearerAuth('bearer')
@Controller('live-lectures')
export class LiveLecturesController {
  constructor(
    private readonly lecturesService: LiveLecturesService,
    private readonly roomService: LiveLectureRoomService,
  ) {}

  // ─── Listings (static routes MUST come before :id) ────────────────

  @Roles(Role.STUDENT)
  @Get('student/upcoming')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upcoming/live lectures for the courses this student is enrolled in' })
  getStudentUpcoming(@CurrentUser() user: any) {
    return this.lecturesService.getStudentUpcoming(user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('teacher/upcoming')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Teacher's scheduled & live lectures" })
  getTeacherUpcoming(@CurrentUser() user: any) {
    return this.lecturesService.getTeacherUpcoming(user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('teacher/history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Teacher's ended & cancelled lectures" })
  getTeacherHistory(@CurrentUser() user: any) {
    return this.lecturesService.getTeacherHistory(user);
  }

  // ─── CRUD & Lifecycle ─────────────────────────────────────────────

  @Roles(Role.TEACHER)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Schedule a live lecture for an owned course (Teacher Only)' })
  create(@CurrentUser() user: any, @Body() dto: CreateLiveLectureDto) {
    return this.lecturesService.create(user, dto);
  }

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @Get(':id')
  @ApiOperation({ summary: 'Lecture detail (owner or actively-enrolled student only)' })
  getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.lecturesService.getById(id, user);
  }

  @Roles(Role.TEACHER)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edit a SCHEDULED lecture (Owner Only)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateLiveLectureDto,
  ) {
    return this.lecturesService.update(id, user, dto);
  }

  @Roles(Role.TEACHER)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a lecture (Owner Only). Blocked while LIVE.' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.lecturesService.remove(id, user);
  }

  @Roles(Role.TEACHER)
  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SCHEDULED → LIVE (Owner Only)' })
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.lecturesService.start(id, user);
  }

  @Roles(Role.TEACHER)
  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'LIVE → ENDED (Owner Only)' })
  end(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.lecturesService.end(id, user);
  }

  @Roles(Role.TEACHER)
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SCHEDULED → CANCELLED (Owner Only)' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.lecturesService.cancel(id, user);
  }

  // ─── Join & Token ─────────────────────────────────────────────────

  @Roles(Role.STUDENT, Role.TEACHER, Role.ADMIN)
  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Join a live lecture → { serverUrl, token, role }. Returns lobby:true while still SCHEDULED.',
  })
  join(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.lecturesService.join(id, user);
  }

  // ─── Attendance ───────────────────────────────────────────────────

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get(':id/attendance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Attendance rows for a lecture (Owner Only)' })
  getAttendance(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.roomService.getAttendance(id, user);
  }

  @Roles(Role.STUDENT)
  @Post(':id/attendance/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Open/reopen the student attendance row (upsert)' })
  attendanceJoin(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.roomService.markJoin(id, user.id);
  }

  @Roles(Role.STUDENT)
  @Post(':id/attendance/leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close the student attendance row and accumulate duration' })
  attendanceLeave(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.roomService.markLeave(id, user.id);
  }

  // ─── Teacher Room Controls ────────────────────────────────────────

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post(':id/participants/:participantId/mute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force-mute a participant (Owner Only)' })
  muteParticipant(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('participantId') participantId: string,
    @CurrentUser() user: any,
  ) {
    if (!participantId) throw new BadRequestException('participantId is required.');
    return this.roomService.muteParticipant(id, participantId, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post(':id/participants/:participantId/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a participant from the room (Owner Only)' })
  removeParticipant(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('participantId') participantId: string,
    @CurrentUser() user: any,
  ) {
    if (!participantId) throw new BadRequestException('participantId is required.');
    return this.roomService.removeParticipant(id, participantId, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post(':id/participants/:participantId/allow-speaking')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Grant publish permission to a student (Owner Only)' })
    allowSpeaking(
      @Param('id', ParseUUIDPipe) id: string,
      @Param('participantId') participantId: string,
      @CurrentUser() user: any,
    ) {
      if (!participantId) throw new BadRequestException('participantId is required.');
      return this.roomService.allowSpeaking(id, participantId, user);
    }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post(':id/participants/:participantId/publish-permission')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Grant/revoke a single publish source (microphone|camera|screen) for a participant' })
  setPublishPermission(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('participantId') participantId: string,
    @Body() body: { source?: string; granted?: boolean },
    @CurrentUser() user: any,
  ) {
    if (!participantId) throw new BadRequestException('participantId is required.');
    const source = body?.source;
    if (!source || !['microphone', 'camera', 'screen'].includes(source)) {
      throw new BadRequestException('source must be one of: microphone, camera, screen.');
    }
    return this.roomService.setPublishPermission(
      id,
      participantId,
      source as 'microphone' | 'camera' | 'screen',
      body?.granted !== false,
      user,
    );
  }


  @Roles(Role.TEACHER, Role.ADMIN)
  @Post(':id/mute-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mute every participant except the host (Owner Only)' })
  muteAll(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.roomService.muteAll(id, user);
  }
}
