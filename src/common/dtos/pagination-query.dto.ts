import { IsOptional, IsInt, Min, Max, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, description: 'Page number (starts from 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be an integer' })
  @Min(1, { message: 'Page must be at least 1' })
  page: number = 1;

  @ApiPropertyOptional({ default: 10, description: 'Items per page (max 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Limit must be an integer' })
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(500, { message: 'Limit cannot exceed 500' })
  limit: number = 10;

  @ApiPropertyOptional({ description: 'Search term for name/email/phone' })
  @IsOptional()
  @IsString({ message: 'Search query must be a string' })
  search?: string;
}
