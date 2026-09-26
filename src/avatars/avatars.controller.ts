import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AvatarsService } from './avatars.service';

@ApiTags('Avatars')
@ApiBearerAuth('bearer')
@Controller()
export class AvatarsController {
  constructor(private readonly avatarsService: AvatarsService) {}

  // ─── Student endpoints ───

  @Get('avatars/shop')
  @ApiOperation({ summary: 'Get all available avatars for purchase.' })
  getShop() {
    return this.avatarsService.getShop();
  }

  @Roles(Role.STUDENT)
  @Post('avatars/buy')
  @ApiOperation({ summary: 'Buy an avatar with coins.' })
  @ApiBody({ schema: { properties: { avatarId: { type: 'string', format: 'uuid' } }, required: ['avatarId'] } })
  buyAvatar(@CurrentUser('id') userId: string, @Body('avatarId') avatarId: string) {
    // userId here is actually the studentProfile.id via @CurrentUser
    return this.avatarsService.buyAvatar(userId, avatarId);
  }

  @Roles(Role.STUDENT)
  @Get('avatars/me')
  @ApiOperation({ summary: 'Get student owned avatars.' })
  getOwned(@CurrentUser('id') userId: string) {
    return this.avatarsService.getOwnedAvatars(userId);
  }

  @Roles(Role.STUDENT)
  @Put('avatars/active')
  @ApiOperation({ summary: 'Set active avatar.' })
  @ApiBody({ schema: { properties: { avatarId: { type: 'string', format: 'uuid' } }, required: ['avatarId'] } })
  setActive(@CurrentUser('id') userId: string, @Body('avatarId') avatarId: string) {
    return this.avatarsService.setActiveAvatar(userId, avatarId);
  }

  @Roles(Role.STUDENT)
  @Delete('avatars/active')
  @ApiOperation({ summary: 'Remove active avatar.' })
  removeActive(@CurrentUser('id') userId: string) {
    return this.avatarsService.removeActiveAvatar(userId);
  }

  // ─── Admin endpoints ───

  @Roles(Role.ADMIN)
  @Get('admin/avatars')
  @ApiOperation({ summary: 'Admin: get all avatars.' })
  adminGetAll() {
    return this.avatarsService.getAllAvatars();
  }

  @Roles(Role.ADMIN)
  @Post('admin/avatars')
  @ApiOperation({ summary: 'Admin: create a new avatar.' })
  @ApiBody({
    schema: {
      properties: {
        name: { type: 'string' },
        imageUrl: { type: 'string' },
        imageKey: { type: 'string' },
        price: { type: 'number' },
        sortOrder: { type: 'number' },
      },
      required: ['name', 'price'],
    },
  })
  adminCreate(@Body() dto: { name: string; imageUrl?: string; imageKey?: string; price: number; sortOrder?: number }) {
    return this.avatarsService.createAvatar(dto);
  }

  @Roles(Role.ADMIN)
  @Put('admin/avatars/:id')
  @ApiOperation({ summary: 'Admin: update an avatar.' })
  @ApiParam({ name: 'id', type: String })
  adminUpdate(@Param('id') id: string, @Body() dto: Record<string, any>) {
    return this.avatarsService.updateAvatar(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('admin/avatars/:id')
  @ApiOperation({ summary: 'Admin: delete (unpublish) an avatar.' })
  @ApiParam({ name: 'id', type: String })
  adminDelete(@Param('id') id: string) {
    return this.avatarsService.deleteAvatar(id);
  }
}
