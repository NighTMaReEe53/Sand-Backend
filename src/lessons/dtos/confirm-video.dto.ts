import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConfirmVideoDto {
  @ApiProperty({
    example: 'https://cdn.example.com/videos/lesson1.m3u8',
    description: 'The uploaded video URL or key',
  })
  @IsString({ message: 'videoUrl must be a string' })
  @IsNotEmpty({ message: 'videoUrl is required' })
  videoUrl: string;

  @ApiPropertyOptional({ example: 3600, description: 'Duration in seconds' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'durationSeconds must be an integer' })
  @Min(0)
  durationSeconds?: number;
}
