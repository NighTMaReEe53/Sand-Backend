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
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, Min, MinLength, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CouponsService } from './coupons.service';

export class CreateCouponDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(30)
  code!: string;

  @IsOptional()
  @IsUUID()
  courseId?: string | null;

  @IsEnum(['PERCENTAGE', 'FIXED'])
  discountType!: 'PERCENTAGE' | 'FIXED';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  discountValue!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUses?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUsesPerUser?: number;

  @IsOptional()
  expiresAt?: string;
}

export class UpdateCouponDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxUses?: number | null;
  @IsOptional() expiresAt?: string | null;
}

export class ValidateCouponDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsOptional() @IsUUID() courseId?: string;
  @IsOptional() @IsUUID() bundleId?: string;
}

@ApiTags('Coupons')
@ApiBearerAuth('bearer')
@Controller()
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  // Public validation endpoint used by checkout UI (students)
  @Roles(Role.STUDENT)
  @Post('coupons/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate a coupon code for a course/bundle and preview the discount.' })
  validate(@CurrentUser('id') userId: string, @Body() dto: ValidateCouponDto) {
    return this.couponsService.validatePreview(userId, dto);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post('coupons')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a coupon (teacher-owned or admin-global).' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateCouponDto) {
    return this.couponsService.createCoupon(userId, dto);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('coupons')
  @ApiOperation({ summary: 'List own (or all, for admin) coupons.' })
  list(@CurrentUser('id') userId: string, @CurrentUser() user: { role: string }) {
    return this.couponsService.listCoupons(userId, user.role === Role.ADMIN);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Patch('coupons/:id')
  @ApiOperation({ summary: 'Update coupon (activate/deactivate, limits, expiry).' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCouponDto,
    @CurrentUser('id') userId: string,
    @CurrentUser() user: { role: string },
  ) {
    return this.couponsService.updateCoupon(id, userId, user.role === Role.ADMIN, dto);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Delete('coupons/:id')
  @ApiOperation({ summary: 'Deactivate (soft-disable) a coupon.' })
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser() user: { role: string },
  ) {
    return this.couponsService.updateCoupon(id, userId, user.role === Role.ADMIN, { isActive: false });
  }
}
