import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dtos/pagination-query.dto';

export class PaymentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: PaymentStatus,
    description: 'Filter payments by status (PENDING, ACCEPTED, REJECTED, EXPIRED, CANCELLED)',
  })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({
    description: 'Filter payments by specific Course UUID',
  })
  @IsOptional()
  @IsUUID('4')
  courseId?: string;
}
