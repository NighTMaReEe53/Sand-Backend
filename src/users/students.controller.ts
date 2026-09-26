import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateStudentDto, SetAccountStatusDto } from './dtos/create-student.dto';

@ApiTags('Students')
@ApiBearerAuth('bearer')
@Controller('students')
export class StudentsController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Phase 6 — Student Search Dashboard (Plan §Phase 6).
   * Teachers get results scoped to their own courses; admins see everyone.
   */
  @Get('search')
  @Roles(Role.TEACHER, Role.ADMIN)
  @ApiOperation({
    summary: 'Search students by name/email/phone with courses, exams and quizzes history.',
  })
  @ApiQuery({ name: 'q', description: 'Search term (name, email or phone)', required: true })
  @ApiQuery({ name: 'limit', required: false })
  search(
    @Query('q') q: string,
    @Query('limit') limit: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.searchStudentsForStaff(q ?? '', user, Number(limit) || 10);
  }

  @Get(':profileId/public-profile')
  @ApiOperation({
    summary: 'Get public profile of a student (achievements, courses, stats) — safe, no private data.',
  })
  getPublicProfile(
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ) {
    return this.usersService.getStudentPublicProfile(profileId);
  }

  @Post()
  @Roles(Role.TEACHER, Role.ADMIN)
  @ApiOperation({
    summary: '[TEACHER/ADMIN] Create a student account (optionally enroll into a course).',
  })
  createStudent(
    @Body() dto: CreateStudentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.createStudentByStaff(dto, user);
  }

  @Patch(':userId/status')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: '[ADMIN] Activate or deactivate an account.' })
  setStatus(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetAccountStatusDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.usersService.setAccountStatus(userId, dto.isActive, adminId);
  }
}
