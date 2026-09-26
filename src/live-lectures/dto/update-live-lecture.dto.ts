import { IsISO8601, IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateLiveLectureDto {
  @ApiPropertyOptional({ description: 'Lecture title' })
  @IsOptional()
  @IsString()
  @Length(3, 150)
  title?: string;

  @ApiPropertyOptional({ description: 'Lecture description / agenda' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Scheduled start time (ISO 8601)' })
  @IsOptional()
  @IsISO8601({}, { message: 'scheduledAt must be a valid ISO 8601 date' })
  scheduledAt?: string;
}
