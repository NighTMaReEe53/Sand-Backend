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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StudyPlannerService } from './study-planner.service';
import {
  CreateStudyTaskDto,
  ListStudyTasksQueryDto,
  UpdateStudyTaskDto,
} from './dtos/study-planner.dtos';

@ApiTags('Study Planner')
@ApiBearerAuth('bearer')
@Controller()
export class StudyPlannerController {
  constructor(private readonly plannerService: StudyPlannerService) {}

  @Roles(Role.STUDENT)
  @Post('study-planner/tasks')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a study plan task (optionally linked to course/lesson/exam).' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateStudyTaskDto) {
    return this.plannerService.create(userId, dto);
  }

  @Roles(Role.STUDENT)
  @Get('study-planner')
  @ApiOperation({ summary: 'Grouped planner view: today, upcoming, overdue, completed.' })
  getPlanner(@CurrentUser('id') userId: string, @Query() query: ListStudyTasksQueryDto) {
    return this.plannerService.getPlanner(userId, query);
  }

  @Roles(Role.STUDENT)
  @Patch('study-planner/tasks/:id')
  @ApiOperation({ summary: 'Update own task (title, due date, completion state, links).' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudyTaskDto,
  ) {
    return this.plannerService.update(userId, id, dto);
  }

  @Roles(Role.STUDENT)
  @Delete('study-planner/tasks/:id')
  @ApiOperation({ summary: 'Delete own task.' })
  delete(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.plannerService.delete(userId, id);
  }
}
