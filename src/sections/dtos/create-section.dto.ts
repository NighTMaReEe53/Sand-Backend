import { IsString, IsOptional, IsInt, Min, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSectionDto {
  @ApiProperty({ description: 'عنوان الفصل/السكشن', example: 'الفصل الأول' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ description: 'ترتيب السكشن', example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
