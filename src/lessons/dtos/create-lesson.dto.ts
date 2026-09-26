import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLessonDto {
  @ApiProperty({ example: 'مقدمة في علم الوراثة', description: 'Lesson title' })
  @IsString({ message: 'Title must be a string' })
  @IsNotEmpty({ message: 'Title is required' })
  @Length(3, 150, { message: 'Title must be between 3 and 150 characters' })
  title: string;

  @ApiPropertyOptional({ example: 'شرح تفصيلي لقوانين مندل الأولى', description: 'Lesson description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/videos/lesson1.m3u8',
    description: 'Video URL or HLS master playlist URL (can also be updated via presigned direct upload)',
  })
  @IsOptional()
  @IsString()
  videoUrl?: string;

  @ApiPropertyOptional({ example: 3600, description: 'Duration in seconds', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Duration must be an integer (seconds)' })
  @Min(0)
  durationSeconds?: number = 0;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether this lesson is a free preview for non-enrolled students',
    default: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'isPreview must be a boolean' })
  isPreview?: boolean = false;

  @ApiPropertyOptional({
    example: 1,
    description: 'Lesson order index inside the course (auto-assigned if omitted)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderIndex?: number;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Section ID that this lesson belongs to (optional, defaults to first section)',
  })
  @IsOptional()
  @IsString()
  sectionId?: string;
}
