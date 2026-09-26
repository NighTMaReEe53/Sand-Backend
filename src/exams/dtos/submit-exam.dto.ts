import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QuestionAnswerItemDto {
  @ApiProperty({ example: 'b1c2d3e4-f5a6-7890-abcd-ef1234567890', description: 'Question UUID' })
  @IsUUID('4', { message: 'questionId must be a valid UUID' })
  @IsNotEmpty({ message: 'questionId is required' })
  questionId: string;

  @ApiPropertyOptional({
    example: 1,
    description: '0-based index of chosen option (omit or pass -1 if left unanswered)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'selectedOptionIndex must be an integer' })
  selectedOptionIndex?: number;
}

export class SubmitExamDto {
  @ApiProperty({
    type: [QuestionAnswerItemDto],
    description: 'Array of answers for the exam questions',
  })
  @IsArray({ message: 'answers must be an array' })
  @ValidateNested({ each: true })
  @Type(() => QuestionAnswerItemDto)
  answers: QuestionAnswerItemDto[];
}
