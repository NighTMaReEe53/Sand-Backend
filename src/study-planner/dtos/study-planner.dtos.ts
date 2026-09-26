import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUUID, MaxLength, MinLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStudyTaskDto {
  @ApiProperty({ example: 'مراجعة باب الكهربية' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ example: '2026-09-01T18:00:00.000Z' })
  @IsDateString({}, { message: 'dueDate must be a valid ISO-8601 date' })
  dueDate: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Link to a course.' })
  @IsOptional()
  @IsUUID()
  courseId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'Link to a lesson.' })
  @IsOptional()
  @IsUUID()
  lessonId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'Link to an exam.' })
  @IsOptional()
  @IsUUID()
  examId?: string | null;
}

export class UpdateStudyTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Toggle completion state.' })
  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  courseId?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lessonId?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  examId?: string | null;
}

export class ListStudyTasksQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  daysAhead?: number;
}
