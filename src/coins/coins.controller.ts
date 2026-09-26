import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CoinsService } from './coins.service';

@ApiTags('Coins')
@ApiBearerAuth('bearer')
@Controller()
export class CoinsController {
  constructor(private readonly coinsService: CoinsService) {}

  @Roles(Role.STUDENT)
  @Get('coins/me')
  @ApiOperation({ summary: 'Get student coin balance.' })
  getBalance(@CurrentUser('id') userId: string) {
    return this.coinsService.getBalance(userId);
  }

  @Roles(Role.STUDENT)
  @Get('coins/transactions')
  @ApiOperation({ summary: 'Get coin transaction history.' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getTransactions(
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.coinsService.getTransactions(
      userId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
