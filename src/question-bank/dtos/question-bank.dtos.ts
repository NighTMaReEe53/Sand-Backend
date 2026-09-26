import { QuestionDifficulty, Role } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const DIFFICULTIES = Object.values(QuestionDifficulty) as string[];

export class CreateBankQuestionDto {
  @ApiProperty({ example: 'ما ناتج 2 + 2؟' })
  @IsString()
  @MinLength(1)
  text: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string | null;

  @ApiProperty({ example: ['3', '4', '5', '6'] })
  @IsArray()
  @IsString({ each: true })
  options: string[];

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  correctOptionIndex: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  explanation?: string | null;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  marks?: number;

  @ApiPropertyOptional({ enum: DIFFICULTIES, default: 'MEDIUM' })
  @IsOptional()
  @IsIn(DIFFICULTIES)
  difficulty?: QuestionDifficulty;

  @ApiPropertyOptional({ example: 'الجبر' })
  @IsOptional()
  @IsString()
  topic?: string | null;

  @ApiPropertyOptional({ example: ['صف أول', 'ترم أول'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ format: 'uuid', description: 'Link question to a course.' })
  @IsOptional()
  @IsUUID()
  courseId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sectionId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lessonId?: string | null;
}

export class UpdateBankQuestionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  text?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  imageUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  correctOptionIndex?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  explanation?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  marks?: number;

  @ApiPropertyOptional({ enum: DIFFICULTIES })
  @IsOptional()
  @IsIn(DIFFICULTIES)
  difficulty?: QuestionDifficulty;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  topic?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  courseId?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sectionId?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lessonId?: string | null;
}

export class ListBankQuestionsQueryDto {
  @ApiPropertyOptional({ example: 'معادلة' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: DIFFICULTIES })
  @IsOptional()
  @IsIn(DIFFICULTIES)
  difficulty?: QuestionDifficulty;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  topic?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lessonId?: string;

  @ApiPropertyOptional({ example: 'جمع' })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({ enum: ['createdAt', 'difficulty', 'marks'], default: 'createdAt' })
  @IsOptional()
  @IsIn(['createdAt', 'difficulty', 'marks'])
  sortBy?: 'createdAt' | 'difficulty' | 'marks';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class BulkDeleteBankQuestionsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID(undefined, { each: true })
  ids: string[];
}
