import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { GradeLevel } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dtos/pagination-query.dto';

export class StudentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: GradeLevel,
    description: 'Filter students by grade level',
  })
  @IsOptional()
  @IsEnum(GradeLevel, {
    message: `Grade level must be one of: ${Object.values(GradeLevel).join(', ')}`,
  })
  gradeLevel?: GradeLevel;
}
