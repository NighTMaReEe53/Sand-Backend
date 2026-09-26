import { IsString, IsOptional, IsInt, Min, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSectionDto {
  @ApiPropertyOptional({ description: 'عنوان الفصل/السكشن', example: 'الفصل الأول المعدّل' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'ترتيب السكشن', example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
