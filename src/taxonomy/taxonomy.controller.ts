import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TaxonomyService } from './taxonomy.service';
import {
  AddCourseTargetDto,
  CreateTaxonomyItemDto,
  SetCourseTargetsDto,
  SetEducationProfileDto,
  UpdateCourseTargetDto,
} from './dto/taxonomy.dto';

@ApiTags('Education Taxonomy')
@Controller()
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  // ─── Public cascading reads ──────────────────────────────────────

  @Public()
  @Get('education-systems')
  @ApiOperation({ summary: 'List active education systems with their stages' })
  systems() {
    return this.taxonomy.listSystems();
  }

  @Public()
  @Get('education-systems/:id/stages')
  @ApiOperation({ summary: 'Stages for a system' })
  stages(@Param('id', ParseUUIDPipe) id: string) {
    return this.taxonomy.listStages(id);
  }

  @Public()
  @Get('stages/:id/grades')
  @ApiOperation({ summary: 'Grades (with tracks) for a stage' })
  grades(@Param('id', ParseUUIDPipe) id: string) {
    return this.taxonomy.listGrades(id);
  }

  @Public()
  @Get('grades/:id/tracks')
  @ApiOperation({ summary: 'Tracks for a grade (empty if none)' })
  tracks(@Param('id', ParseUUIDPipe) id: string) {
    return this.taxonomy.listTracks(id);
  }

  @Public()
  @Get('subjects')
  @ApiOperation({ summary: 'All active subjects' })
  subjects() {
    return this.taxonomy.listAllSubjects();
  }

  @Public()
  @Get('grades/:id/subjects')
  @ApiOperation({ summary: 'Subjects valid for a grade — optionally narrowed by trackId' })
  @ApiQuery({ name: 'trackId', required: false })
  gradeSubjects(@Param('id', ParseUUIDPipe) id: string, @Query('trackId') trackId?: string) {
    return this.taxonomy.listSubjectsForGrade(id, trackId || null);
  }

  // ─── Course targets (teacher owner / admin) ──────────────────────

  @ApiBearerAuth('bearer')
  @Roles(Role.TEACHER)
  @Get('courses/:id/targets')
  @ApiOperation({ summary: "List a course's audience targets" })
  getTargets(@Param('id', ParseUUIDPipe) id: string) {
    return this.taxonomy.getCourseTargets(id);
  }

  @ApiBearerAuth('bearer')
  @Roles(Role.TEACHER)
  @Post('courses/:id/targets')
  @ApiOperation({ summary: 'Replace ALL of a course targets in one transaction (server re-validated)' })
  setTargets(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCourseTargetsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.taxonomy.setCourseTargets(id, dto.targets ?? [], user);
  }

  @ApiBearerAuth('bearer')
  @Roles(Role.TEACHER)
  @Post('courses/:id/targets/add')
  @ApiOperation({ summary: 'Add one target to a course' })
  addTarget(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCourseTargetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.taxonomy.addCourseTarget(id, dto, user);
  }

  @ApiBearerAuth('bearer')
  @Roles(Role.TEACHER)
  @Patch('courses/:id/targets/:targetId')
  @ApiOperation({ summary: 'Update a single target (grade/track) on a course' })
  updateTarget(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @Body() dto: UpdateCourseTargetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.taxonomy.updateCourseTarget(id, targetId, dto, user);
  }

  @ApiBearerAuth('bearer')
  @Roles(Role.TEACHER)
  @Delete('courses/:id/targets/:targetId')
  @ApiOperation({ summary: 'Remove a single target from a course' })
  removeTarget(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.taxonomy.removeCourseTarget(id, targetId, user);
  }

  // ─── Student education profile + personalized courses ────────────

  @ApiBearerAuth('bearer')
  @Roles(Role.STUDENT)
  @Get('student/courses')
  @ApiOperation({ summary: 'Courses matching MY profile — server-derived, ignores client filters' })
  myCourses(@CurrentUser() user: AuthenticatedUser) {
    return this.taxonomy.myCourses(user);
  }

  @ApiBearerAuth('bearer')
  @Roles(Role.STUDENT)
  @Get('student/education-profile')
  @ApiOperation({ summary: 'My education profile' })
  myProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.taxonomy.getMyEducationProfile(user);
  }

  @ApiBearerAuth('bearer')
  @Roles(Role.STUDENT)
  @Patch('student/education-profile')
  @ApiOperation({ summary: 'Set/update my education profile (full ownership-chain validation)' })
  setProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetEducationProfileDto) {
    return this.taxonomy.setMyEducationProfile(user, dto);
  }
}
