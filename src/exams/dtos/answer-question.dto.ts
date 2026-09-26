import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AnswerQuestionDto {
  @ApiProperty({ description: 'Question UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID('4')
  @IsNotEmpty()
  questionId: string;

  @ApiProperty({ description: 'Selected option index (0 to 3)', example: 1 })
  @IsInt()
  @Min(0)
  selectedOptionIndex: number;

  @ApiPropertyOptional({ description: 'Flag to finish exam after answering this question', example: false })
  @IsOptional()
  @IsBoolean()
  finish?: boolean;
}
