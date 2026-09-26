import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dtos/create-course.dto';
import { UpdateCourseDto } from './dtos/update-course.dto';
import { CourseQueryDto } from './dtos/course-query.dto';
import { CourseOwnerGuard } from './guards/course-owner.guard';

@ApiTags('Courses')
@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Public()
  @Get('search/global')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Smart global search — returns courses, lessons and exams matching a keyword' })
  async globalSearch(
    @Query('q') q: string,
    @CurrentUser() user?: any,
  ) {
    return this.coursesService.globalSearch(q ?? '', user);
  }

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Browse published courses with search, filtering and pagination' })
  @ApiResponse({ status: 200, description: 'Courses list returned.' })
  async getCourses(
    @Query() query: CourseQueryDto,
    @CurrentUser() user?: any,
  ) {
    return this.coursesService.getCourses(query, user);
  }

  // Student's actually-subscribed (enrolled) courses — used by the exam-rankings filter.
  @Get('enrolled-courses')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List courses the current student is enrolled in (ACTIVE or PENDING).' })
  async getStudentEnrolledCourses(@CurrentUser('id') userId: string) {
    return this.coursesService.getStudentEnrolledCourses(userId);
  }

  @Public()
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get course details with lessons outline and preview tags' })
  @ApiResponse({ status: 200, description: 'Course details returned.' })
  @ApiResponse({ status: 404, description: 'Course not found.' })
  async getCourseById(
    @Param('id') id: string,
    @CurrentUser() user?: any,
  ) {
    return this.coursesService.getCourseById(id, user);
  }

  @ApiBearerAuth('bearer')
  @Roles(Role.TEACHER)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new course in DRAFT status (Teacher Only)' })
  @ApiResponse({ status: 201, description: 'Course created successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Requires TEACHER role.' })
  async createCourse(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCourseDto,
  ) {
    return this.coursesService.createCourse(userId, dto);
  }

  @ApiBearerAuth('bearer')
  @Roles(Role.TEACHER)
  @UseGuards(CourseOwnerGuard)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update course details (Teacher Owner Only)' })
  @ApiResponse({ status: 200, description: 'Course updated successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Must be the course owner.' })
  async updateCourse(
    @Param('id') id: string,
    @Body() dto: UpdateCourseDto,
  ) {
    return this.coursesService.updateCourse(id, dto);
  }

  @ApiBearerAuth('bearer')
  @Roles(Role.TEACHER)
  @UseGuards(CourseOwnerGuard)
  @Patch(':id/thumbnail')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload or replace a course cover image (JPG, PNG, WEBP; max 5MB)' })
  async uploadThumbnail(
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.coursesService.uploadThumbnail(id, file);
  }

  @ApiBearerAuth('bearer')
  @Roles(Role.TEACHER)
  @UseGuards(CourseOwnerGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete a course and its contents (Teacher Owner Only)' })
  @ApiResponse({ status: 200, description: 'Course soft-deleted successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Must be the course owner.' })
  async deleteCourse(@Param('id') id: string) {
    return this.coursesService.deleteCourse(id);
  }

  @ApiBearerAuth('bearer')
  @Roles(Role.STUDENT)
  @Post(':id/enroll-free')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Direct enrollment in free published course (Student Only)' })
  @ApiResponse({ status: 201, description: 'Enrolled in free course successfully.' })
  @ApiResponse({ status: 400, description: 'Course is not published or is not free.' })
  @ApiResponse({ status: 409, description: 'Already enrolled in this course.' })
  async enrollFreeCourse(
    @Param('id') courseId: string,
    @CurrentUser('id') studentUserId: string,
  ) {
    return this.coursesService.enrollFreeCourse(courseId, studentUserId);
  }

  @Public()
  @Get(':id/curriculum')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get course curriculum as sections > lessons + materials hierarchy (one query)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Curriculum returned.' })
  @ApiResponse({ status: 404, description: 'Course not found.' })
  async getCurriculum(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: any,
  ) {
    return this.coursesService.getCurriculum(id, user);
  }

  @ApiBearerAuth('bearer')
  @Roles(Role.TEACHER, Role.ADMIN)
  @Get(':id/students')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List enrolled students in course with progress and stats (Teacher/Admin)' })
  async getCourseStudents(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.coursesService.getCourseStudents(id, user, {
      search,
      status,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @ApiBearerAuth('bearer')
  @Roles(Role.TEACHER, Role.ADMIN)
  @Patch(':id/students/:studentId/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate or suspend student enrollment in course (Teacher/Admin)' })
  async updateCourseStudentStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body('status') status: any,
    @CurrentUser() user: any,
  ) {
    return this.coursesService.updateCourseStudentStatus(id, studentId, status, user);
  }

  @ApiBearerAuth('bearer')
  @Roles(Role.TEACHER, Role.ADMIN)
  @Delete(':id/students/:studentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Safely remove/un-enroll student from course (Teacher/Admin)' })
  async removeCourseStudent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: any,
  ) {
    return this.coursesService.removeCourseStudent(id, studentId, user);
  }
}
