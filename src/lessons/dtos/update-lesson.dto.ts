import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateLessonDto {
  @ApiPropertyOptional({ example: 'العنوان المحدث للدرس', description: 'Lesson title' })
  @IsOptional()
  @IsString()
  @Length(3, 150)
  title?: string;

  @ApiPropertyOptional({ example: 'الوصف المحدث للدرس', description: 'Lesson description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/videos/updated.m3u8', description: 'Video URL' })
  @IsOptional()
  @IsString()
  videoUrl?: string;

  @ApiPropertyOptional({ example: 4200, description: 'Duration in seconds' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @ApiPropertyOptional({ example: true, description: 'Is free preview' })
  @IsOptional()
  @IsBoolean()
  isPreview?: boolean;

  @ApiPropertyOptional({ example: 2, description: 'Order index' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderIndex?: number;

  @ApiPropertyOptional({ example: '550e8400-e29b-41d4-a716-446655440000', description: 'Move to section ID' })
  @IsOptional()
  @IsString()
  sectionId?: string;
}
