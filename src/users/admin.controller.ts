import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  Patch,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateTeacherDto } from './dtos/create-teacher.dto';
import { StudentQueryDto } from './dtos/student-query.dto';
import { UpdateStudentDto, UpdateTeacherDto } from './dtos/update-account.dto';
import { PaginationQueryDto } from '../common/dtos/pagination-query.dto';

@ApiTags('Admin')
@ApiBearerAuth('bearer')
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly usersService: UsersService) {}

  @Post('teachers')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new teacher account (Admin Only, verified immediately)' })
  @ApiResponse({ status: 201, description: 'Teacher created successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Requires ADMIN role.' })
  @ApiResponse({ status: 409, description: 'Email or phone already in use.' })
  async createTeacher(
    @CurrentUser('id') adminId: string,
    @Body() dto: CreateTeacherDto,
  ) {
    return this.usersService.createTeacher(adminId, dto);
  }

  @Post('teachers/upload-image')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { image: { type: 'string', format: 'binary' } } },
  })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      '[ADMIN only] Upload a photo for a teacher (before/after account creation) and get its URL.',
  })
  @ApiResponse({ status: 201, description: 'Image uploaded successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid or missing image file.' })
  async uploadTeacherImage(@UploadedFile() file: Express.Multer.File) {
    return this.usersService.uploadTeacherPhoto(file as Express.Multer.File);
  }

  @Get('teachers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List and search teachers with pagination (Admin Only)' })
  @ApiResponse({ status: 200, description: 'List of teachers returned.' })
  async getTeachers(@Query() query: PaginationQueryDto) {
    return this.usersService.getTeachers(query);
  }

  @Get('teachers/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Teacher detail: profile + their courses with enrollment/lesson stats (Admin Only)' })
  @ApiResponse({ status: 200, description: 'Teacher detail returned.' })
  @ApiResponse({ status: 404, description: 'Teacher not found.' })
  async getTeacherDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.getTeacherDetail(id);
  }

  @Get('students')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List and filter students with pagination and grade level (Admin Only)' })
  @ApiResponse({ status: 200, description: 'List of students returned.' })
  async getStudents(@Query() query: StudentQueryDto) {
    return this.usersService.getStudents(query);
  }

  @Patch('students/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '[ADMIN only] Update a student account: name, email, phone, guardian phone, grade or active state.',
  })
  @ApiResponse({ status: 200, description: 'Student updated successfully.' })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  @ApiResponse({ status: 409, description: 'Email or phone already in use.' })
  async updateStudent(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.usersService.updateStudentByAdmin(userId, dto, adminId);
  }

  @Delete('students/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '[ADMIN only] Permanently delete a student account with all their attempts and enrollments.',
  })
  @ApiResponse({ status: 200, description: 'Student deleted successfully.' })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  async deleteStudent(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.usersService.deleteStudentByAdmin(userId, adminId);
  }

  @Patch('teachers/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '[ADMIN only] Update a teacher account: name, email, phone, specialization, bio, photo or active state.',
  })
  @ApiResponse({ status: 200, description: 'Teacher updated successfully.' })
  @ApiResponse({ status: 404, description: 'Teacher not found.' })
  @ApiResponse({ status: 409, description: 'Email or phone already in use.' })
  async updateTeacher(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeacherDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.usersService.updateTeacherByAdmin(id, dto, adminId);
  }

  @Delete('teachers/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete a teacher and cascade soft-delete their courses (Admin Only)' })
  @ApiResponse({ status: 200, description: 'Teacher soft-deleted successfully.' })
  async deleteTeacher(@Param('id') id: string) {
    return this.usersService.deleteTeacher(id);
  }
}
