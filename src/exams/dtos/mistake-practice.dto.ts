import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuestionAnswerItemDto } from './submit-exam.dto';

export class GenerateMistakePracticeDto {
  @ApiPropertyOptional({
    example: 'b1c2d3e4-f5a6-7890-abcd-ef1234567890',
    description: 'Filter mistakes by Course UUID',
  })
  @IsOptional()
  @IsUUID('4', { message: 'courseId must be a valid UUID' })
  courseId?: string;

  @ApiPropertyOptional({
    example: 'EXAM:b1c2d3e4-f5a6-7890-abcd-ef1234567890',
    description: 'Filter mistakes by group ID (e.g. EXAM:<id>, QUIZ:<id>, HOMEWORK:<id>)',
  })
  @IsOptional()
  @IsString({ message: 'groupId must be a string' })
  groupId?: string;

  @ApiPropertyOptional({
    example: 10,
    description: 'Maximum number of practice questions to generate (1 to 50)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'count must be an integer' })
  @Min(1, { message: 'count must be at least 1' })
  @Max(50, { message: 'count cannot exceed 50' })
  count?: number;
}

export class SubmitMistakePracticeDto {
  @ApiPropertyOptional({
    example: 'b1c2d3e4-f5a6-7890-abcd-ef1234567890',
    description: 'Practice Exam Session ID',
  })
  @IsOptional()
  @IsString()
  practiceId?: string;

  @ApiProperty({
    example: 120,
    description: 'Time spent in seconds solving the practice exam',
  })
  @IsInt({ message: 'timeSpentSeconds must be an integer' })
  @Min(0, { message: 'timeSpentSeconds must be at least 0' })
  @Type(() => Number)
  timeSpentSeconds: number;

  @ApiProperty({
    type: [QuestionAnswerItemDto],
    description: 'Array of answers for the practice exam questions',
  })
  @IsArray({ message: 'answers must be an array' })
  @ValidateNested({ each: true })
  @Type(() => QuestionAnswerItemDto)
  answers: QuestionAnswerItemDto[];
}
