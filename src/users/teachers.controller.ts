import {
  Controller,
  Get,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

@ApiTags('Teachers')
@Controller('teachers')
export class TeachersController {
  constructor(private readonly usersService: UsersService) {}

  @Public()
  @Get(':id/profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get public profile for a teacher including published courses (or draft courses if owner/admin)',
  })
  @ApiResponse({ status: 200, description: 'Teacher profile returned.' })
  @ApiResponse({ status: 404, description: 'Teacher not found.' })
  async getTeacherProfile(
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.usersService.getTeacherProfile(id, user);
  }
}
