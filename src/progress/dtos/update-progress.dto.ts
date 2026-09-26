import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProgressDto {
  @ApiProperty({
    example: 85,
    description: 'Watched percentage of the lesson video (0 to 100). If >= 90, lesson is automatically marked completed.',
    minimum: 0,
    maximum: 100,
  })
  @Type(() => Number)
  @IsInt({ message: 'watchedPercentage must be an integer' })
  @Min(0, { message: 'watchedPercentage must be between 0 and 100' })
  @Max(100, { message: 'watchedPercentage must be between 0 and 100' })
  watchedPercentage: number;

  @ApiPropertyOptional({
    example: 342,
    description: 'Current playback position in seconds (used for resuming later).',
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'positionSeconds must be an integer' })
  @Min(0, { message: 'positionSeconds must be a non-negative integer' })
  positionSeconds?: number;

  @ApiPropertyOptional({
    example: 1200,
    description: 'Total video duration in seconds as reported by the player (stored for reference).',
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'durationSeconds must be an integer' })
  @Min(0, { message: 'durationSeconds must be a non-negative integer' })
  durationSeconds?: number;
}
