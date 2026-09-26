import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsISO8601,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLiveLectureDto {
  @ApiProperty({ description: 'Course this lecture belongs to (must be owned by the caller)' })
  @IsUUID('4', { message: 'Course id must be a valid UUID' })
  courseId: string;

  @ApiProperty({ example: 'مراجعة الفصل الأول', description: 'Lecture title' })
  @IsString()
  @IsNotEmpty()
  @Length(3, 150)
  title: string;

  @ApiPropertyOptional({ description: 'Optional lecture description / agenda' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @ApiProperty({ example: '2026-08-30T16:00:00.000Z', description: 'Scheduled start time (ISO 8601)' })
  @IsISO8601({}, { message: 'scheduledAt must be a valid ISO 8601 date' })
  scheduledAt: string;
}
