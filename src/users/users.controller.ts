import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
  HttpCode,
  HttpStatus,
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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dtos/update-profile.dto';
import { ChangePasswordDto } from './dtos/change-password.dto';

@ApiTags('Users / Profile')
@ApiBearerAuth('bearer')
@Controller('profile')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user profile (Student, Teacher, Admin)' })
  @ApiResponse({ status: 200, description: 'User profile returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getProfile(@CurrentUser('id') userId: string) {
    return this.usersService.getProfile(userId);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update current user profile data' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully.' })
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Patch('password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change current user account password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully.' })
  @ApiResponse({ status: 400, description: 'New password cannot be same as old password.' })
  @ApiResponse({ status: 401, description: 'Current password is incorrect.' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(userId, dto);
  }

  @Roles(Role.ADMIN)
  @Patch('teachers/:userId/title')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '[ADMIN only] Update a teacher title (specialization). Teachers cannot change it themselves.',
  })
  async updateTeacherTitle(
    @Param('userId', ParseUUIDPipe) teacherUserId: string,
    @Body() body: { specialization: string },
  ) {
    return this.usersService.updateTeacherTitleByAdmin(teacherUserId, body.specialization);
  }

  @Post('image')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '[TEACHER/ADMIN] Upload a local image file and set it as the profile photo instantly.',
  })
  async uploadProfileImage(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.usersService.uploadProfileImage(userId, file as Express.Multer.File);
  }
}
