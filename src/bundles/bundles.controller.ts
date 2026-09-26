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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BundlesService } from './bundles.service';
import { CreateBundleDto, UpdateBundleDto } from './dtos/bundle.dtos';

@ApiTags('Bundles')
@Controller()
export class BundlesController {
  constructor(private readonly bundlesService: BundlesService) {}

  @Public()
  @Get('bundles')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Public list of active bundles with savings info.' })
  listPublic() {
    return this.bundlesService.listPublic();
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('bundles/manage')
  @ApiOperation({ summary: 'List own (or all for admin) bundles including inactive.' })
  listOwn(@CurrentUser() user: { id: string; role: Role }) {
    return this.bundlesService.listOwn(user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post('bundles')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a bundle of 2+ own courses (Teacher Owner).' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateBundleDto) {
    return this.bundlesService.create(userId, dto);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Patch('bundles/:id')
  @ApiOperation({ summary: 'Update bundle title/price/courses/active state.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBundleDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.bundlesService.update(id, userId, dto);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Delete('bundles/:id')
  @ApiOperation({ summary: 'Soft-delete a bundle (Teacher Owner / Admin).' })
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.bundlesService.delete(id, user.id, user);
  }
}
