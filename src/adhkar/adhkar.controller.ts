import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdhkarService } from './adhkar.service';
import {
  DismissAdhkarDto,
  GetAdhkarQueryDto,
  GetRandomDuaQueryDto,
} from './adhkar.dtos';

@ApiTags('Adhkar & Duas')
@Controller()
export class AdhkarController {
  constructor(private readonly adhkarService: AdhkarService) {}

  @Public()
  @Get('adhkar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'جلب الأذكار والأدعية حسب التصنيف (صباح / مساء / دعاء)' })
  getContent(@Query() query: GetAdhkarQueryDto) {
    return this.adhkarService.getContent(query.category);
  }

  @Public()
  @Get('duas/random')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'دعاء عشوائي للـ Toast (عام / امتحان / بعد امتحان / بعد محاضرة)',
  })
  getRandomDua(@Query() query: GetRandomDuaQueryDto) {
    return this.adhkarService.getRandomDua(query.context ?? 'general', query.excludeCodes);
  }

  @ApiBearerAuth('bearer')
  @Get('adhkar/dismissals')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'جلب الأذكار المخفية للمستخدم الحالي (24 ساعة)' })
  getDismissals(@CurrentUser('id') userId: string) {
    return this.adhkarService.getActiveDismissals(userId);
  }

  @ApiBearerAuth('bearer')
  @Post('adhkar/dismiss')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'إخفاء ذكر معين لمدة 24 ساعة' })
  dismissItem(@CurrentUser('id') userId: string, @Body() dto: DismissAdhkarDto) {
    return this.adhkarService.dismiss(userId, dto.itemId);
  }
}
