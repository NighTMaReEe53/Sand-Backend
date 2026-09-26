import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FramesService } from './frames.service';

@ApiTags('Frames')
@ApiBearerAuth('bearer')
@Controller()
export class FramesController {
  constructor(private readonly framesService: FramesService) {}

  // ─── Student endpoints ───

  @Get('frames/shop')
  @ApiOperation({ summary: 'Get all available frames for purchase.' })
  getShop() {
    return this.framesService.getShop();
  }

  @Roles(Role.STUDENT)
  @Post('frames/buy')
  @ApiOperation({ summary: 'Buy a frame with coins.' })
  @ApiBody({ schema: { properties: { frameId: { type: 'string', format: 'uuid' } }, required: ['frameId'] } })
  buyFrame(@CurrentUser('id') userId: string, @Body('frameId') frameId: string) {
    return this.framesService.buyFrame(userId, frameId);
  }

  @Roles(Role.STUDENT)
  @Get('frames/me')
  @ApiOperation({ summary: 'Get student owned frames.' })
  getOwned(@CurrentUser('id') userId: string) {
    return this.framesService.getOwnedFrames(userId);
  }

  @Roles(Role.STUDENT)
  @Put('frames/active')
  @ApiOperation({ summary: 'Set active frame.' })
  @ApiBody({ schema: { properties: { frameId: { type: 'string', format: 'uuid' } }, required: ['frameId'] } })
  setActive(@CurrentUser('id') userId: string, @Body('frameId') frameId: string) {
    return this.framesService.setActiveFrame(userId, frameId);
  }

  @Roles(Role.STUDENT)
  @Delete('frames/active')
  @ApiOperation({ summary: 'Remove active frame.' })
  removeActive(@CurrentUser('id') userId: string) {
    return this.framesService.removeActiveFrame(userId);
  }

  // ─── Admin endpoints ───

  @Roles(Role.ADMIN)
  @Get('admin/frames')
  @ApiOperation({ summary: 'Admin: get all frames.' })
  adminGetAll() {
    return this.framesService.getAllFrames();
  }

  @Roles(Role.ADMIN)
  @Post('admin/frames')
  @ApiOperation({ summary: 'Admin: create a new frame.' })
  @ApiBody({
    schema: {
      properties: {
        name: { type: 'string' },
        imageUrl: { type: 'string' },
        cssStyle: { type: 'string' },
        price: { type: 'number' },
        sortOrder: { type: 'number' },
      },
      required: ['name', 'price'],
    },
  })
  adminCreate(@Body() dto: { name: string; imageUrl?: string; cssStyle?: string; price: number; sortOrder?: number }) {
    return this.framesService.createFrame(dto);
  }

  @Roles(Role.ADMIN)
  @Put('admin/frames/:id')
  @ApiOperation({ summary: 'Admin: update a frame.' })
  @ApiParam({ name: 'id', type: String })
  adminUpdate(@Param('id') id: string, @Body() dto: Record<string, any>) {
    return this.framesService.updateFrame(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('admin/frames/:id')
  @ApiOperation({ summary: 'Admin: delete (unpublish) a frame.' })
  @ApiParam({ name: 'id', type: String })
  adminDelete(@Param('id') id: string) {
    return this.framesService.deleteFrame(id);
  }
}
