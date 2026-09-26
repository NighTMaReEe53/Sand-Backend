import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { GamificationService } from './gamification.service';

@ApiTags('Gamification')
@ApiBearerAuth('bearer')
@Controller()
export class GamificationController {
  constructor(private readonly gamificationService: GamificationService) {}

  @Roles(Role.STUDENT)
  @Get('gamification/me')
  @ApiOperation({ summary: 'Student streaks + badges overview.' })
  getMe(@CurrentUser('id') userId: string) {
    return this.gamificationService.getStudentGamification(userId);
  }
}
