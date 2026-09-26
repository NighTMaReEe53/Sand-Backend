import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpsertCourseVideoDto {
  @ApiProperty({ example: 'https://www.youtube.com/watch?v=abc123' })
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  videoUrl: string;

  @ApiPropertyOptional({ example: 'شرح منهج الوحدة الأولى' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
