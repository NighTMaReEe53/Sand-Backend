import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateExamDto {
  @ApiPropertyOptional({ example: 'العنوان المحدث للامتحان', description: 'Exam title' })
  @IsOptional()
  @IsString()
  @Length(3, 150)
  title?: string;

  @ApiPropertyOptional({ example: 'الوصف المحدث للامتحان', description: 'Exam description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Lesson UUID (nullable)' })
  @IsOptional()
  @IsUUID('4')
  lessonId?: string;

  @ApiPropertyOptional({ example: 60, description: 'Duration in minutes' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(300)
  durationMinutes?: number;

  @ApiPropertyOptional({ example: 100, description: 'Total marks' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalMarks?: number;

  @ApiPropertyOptional({ example: 50, description: 'Passing marks' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  passingMarks?: number;

  @ApiPropertyOptional({ description: 'Scheduled start' })
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @ApiPropertyOptional({ description: 'Scheduled end' })
  @IsOptional()
  @IsDateString()
  endAt?: string;

  @ApiPropertyOptional({ example: 2, description: 'Max attempts' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxAttempts?: number;

  @ApiPropertyOptional({ description: 'Shuffle questions' })
  @IsOptional()
  @IsBoolean()
  shuffleQuestions?: boolean;

  @ApiPropertyOptional({ description: 'Shuffle options per attempt' })
  @IsOptional()
  @IsBoolean()
  shuffleOptions?: boolean;

  @ApiPropertyOptional({ description: 'Select questions from the Question Bank' })
  @IsOptional()
  @IsBoolean()
  useQuestionBank?: boolean;

  @ApiPropertyOptional({ description: 'EASY bank question count' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bankEasyCount?: number;

  @ApiPropertyOptional({ description: 'MEDIUM bank question count' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bankMediumCount?: number;

  @ApiPropertyOptional({ description: 'HARD bank question count' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bankHardCount?: number;

  @ApiPropertyOptional({ description: 'Show correct answers after submission' })
  @IsOptional()
  @IsBoolean()
  showCorrectAnswersAfterSubmission?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Publishing status' })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
