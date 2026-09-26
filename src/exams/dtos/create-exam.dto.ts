import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateQuestionDto } from './create-question.dto';

export class CreateExamDto {
  @ApiProperty({ example: 'امتحان الباب الأول - فيزياء كهربية', description: 'Exam title' })
  @IsString({ message: 'title must be a string' })
  @IsNotEmpty({ message: 'title is required' })
  @Length(3, 150, { message: 'title must be between 3 and 150 characters' })
  title: string;

  @ApiPropertyOptional({ example: 'امتحان شامل على قانون كيرشوف وقانون أوم للدائرة المغلقة', description: 'Exam description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'Attach to a specific lesson (optional)' })
  @IsOptional()
  @IsUUID('4', { message: 'lessonId must be a valid UUID' })
  lessonId?: string;

  @ApiProperty({ example: 45, description: 'Exam duration in minutes', minimum: 1, maximum: 300 })
  @Type(() => Number)
  @IsInt({ message: 'durationMinutes must be an integer' })
  @Min(1, { message: 'durationMinutes must be at least 1 minute' })
  @Max(300, { message: 'durationMinutes cannot exceed 300 minutes' })
  durationMinutes: number;

  @ApiPropertyOptional({ example: 100, description: 'Total marks of the exam', default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalMarks?: number = 100;

  @ApiPropertyOptional({ example: 50, description: 'Passing marks required to pass', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  passingMarks?: number = 50;

  @ApiPropertyOptional({ example: '2026-09-01T10:00:00.000Z', description: 'Scheduled exam start window' })
  @IsOptional()
  @IsDateString({}, { message: 'startAt must be a valid ISO-8601 date string' })
  startAt?: string;

  @ApiPropertyOptional({ example: '2026-09-01T22:00:00.000Z', description: 'Scheduled exam end window' })
  @IsOptional()
  @IsDateString({}, { message: 'endAt must be a valid ISO-8601 date string' })
  endAt?: string;

  @ApiPropertyOptional({ example: 1, description: 'Maximum allowed attempts per student', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxAttempts?: number = 1;

  @ApiPropertyOptional({ example: true, description: 'Shuffle question order for each attempt', default: true })
  @IsOptional()
  @IsBoolean()
  shuffleQuestions?: boolean = true;

  @ApiPropertyOptional({ example: false, description: 'Shuffle option order per attempt (anti-memorization)', default: false })
  @IsOptional()
  @IsBoolean()
  shuffleOptions?: boolean = false;

  @ApiPropertyOptional({ example: false, description: 'Randomly select questions from the course Question Bank at attempt start', default: false })
  @IsOptional()
  @IsBoolean()
  useQuestionBank?: boolean = false;

  @ApiPropertyOptional({ example: 5, description: 'Number of EASY bank questions to select (when useQuestionBank)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bankEasyCount?: number = 0;

  @ApiPropertyOptional({ example: 10, description: 'Number of MEDIUM bank questions to select (when useQuestionBank)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bankMediumCount?: number = 0;

  @ApiPropertyOptional({ example: 5, description: 'Number of HARD bank questions to select (when useQuestionBank)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bankHardCount?: number = 0;

  @ApiPropertyOptional({ example: true, description: 'Show correct answers and model answers after submission', default: true })
  @IsOptional()
  @IsBoolean()
  showCorrectAnswersAfterSubmission?: boolean = true;

  @ApiPropertyOptional({ example: false, description: 'Publish exam immediately', default: false })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean = false;

  @ApiPropertyOptional({ type: [CreateQuestionDto], description: 'Optional initial list of questions' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionDto)
  questions?: CreateQuestionDto[];
}

