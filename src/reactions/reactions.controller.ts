import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReactionTargetType } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReactionsService } from './reactions.service';
import { ReactDto } from './dto/react.dto';

@ApiTags('Reactions')
@ApiBearerAuth('bearer')
@Controller('reactions')
export class ReactionsController {
  constructor(private readonly reactionsService: ReactionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add or update a reaction (Facebook-style upsert).' })
  react(
    @CurrentUser('id') userId: string,
    @Body() dto: ReactDto,
  ) {
    return this.reactionsService.react(userId, dto.targetType, dto.targetId, dto.type);
  }

  @Delete(':targetType/:targetId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove own reaction from an item.' })
  unreact(
    @CurrentUser('id') userId: string,
    @Param('targetType') targetType: ReactionTargetType,
    @Param('targetId') targetId: string,
  ) {
    return this.reactionsService.unreact(userId, targetType, targetId);
  }

  @Get('summary/:targetType/:targetId')
  @ApiOperation({ summary: 'Get reaction counts for an item + current user reaction.' })
  reactionSummary(
    @CurrentUser('id') userId: string,
    @Param('targetType') targetType: ReactionTargetType,
    @Param('targetId') targetId: string,
  ) {
    return this.reactionsService.getReactionSummary(targetType, targetId, userId);
  }
}
