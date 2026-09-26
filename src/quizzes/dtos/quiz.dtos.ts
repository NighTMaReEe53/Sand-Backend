import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QuizQuestionInputDto {
  @ApiProperty({ example: 'ما هي وحدة قياس القوة؟' })
  @IsString()
  @MinLength(1)
  text: string;

  @ApiProperty({ example: ['نيوتن', 'جول', 'واط', 'أمبير'] })
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  options: string[];

  @ApiProperty({ example: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  correctOptionIndex: number;

  @ApiPropertyOptional({ example: 'القوة تقاس بالنيوتن.' })
  @IsOptional()
  @IsString()
  explanation?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  marks?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderIndex?: number;
}

export class CreateQuizDto {
  @ApiProperty({ example: 'كويز الدرس الأول' })
  @IsString()
  @MinLength(1)
  title: string;

  @ApiPropertyOptional({ example: 50, default: 50, description: 'Passing percentage (0-100).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  passingPercentage?: number;

  @ApiPropertyOptional({ example: 10, description: 'Time limit in minutes (optional).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  timeLimitMinutes?: number | null;

  @ApiPropertyOptional({ example: 3, default: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxAttempts?: number;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({ type: [QuizQuestionInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuizQuestionInputDto)
  questions?: QuizQuestionInputDto[];
}

export class UpdateQuizDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  passingPercentage?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  timeLimitMinutes?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxAttempts?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdateQuizQuestionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  text?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  correctOptionIndex?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  explanation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  marks?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderIndex?: number;
}

export class SubmitQuizAnswerDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  questionId: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  selectedOptionIndex: number;
}

export class SubmitQuizDto {
  @ApiProperty({ type: [SubmitQuizAnswerDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitQuizAnswerDto)
  answers: SubmitQuizAnswerDto[];
}
