import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class HomeworkQuestionDto {
  @IsString()
  @MinLength(1)
  text!: string;

  @IsArray()
  @IsString({ each: true })
  options!: string[];

  @IsInt()
  @Min(0)
  correctOptionIndex!: number;

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  marks?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  orderIndex?: number;

  /** الطالب يرفع صورة الحل بدلاً من اختيار خيار */
  @IsOptional()
  @IsBoolean()
  requiresImageAnswer?: boolean;
}

export class CreateHomeworkDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** موعد فتح الواجب للطلاب — مغلق قبله */
  @IsOptional()
  @IsString()
  availableFrom?: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(100)
  passingPercentage?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxAttempts?: number;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HomeworkQuestionDto)
  questions?: HomeworkQuestionDto[];
}

export class UpdateHomeworkDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  availableFrom?: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(100)
  passingPercentage?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxAttempts?: number;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class CreateHomeworkQuestionDto {
  @IsString()
  @MinLength(1)
  text!: string;

  @IsArray()
  @IsString({ each: true })
  options!: string[];

  @IsInt()
  @Min(0)
  correctOptionIndex!: number;

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  marks?: number;

  @IsOptional()
  @IsBoolean()
  requiresImageAnswer?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  orderIndex?: number;
}

export class UpdateHomeworkQuestionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  text?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  correctOptionIndex?: number;

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  marks?: number;

  @IsOptional()
  @IsBoolean()
  requiresImageAnswer?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  orderIndex?: number;
}

export class SubmitHomeworkDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitHomeworkAnswerDto)
  answers!: SubmitHomeworkAnswerDto[];
}

class SubmitHomeworkAnswerDto {
  @IsString()
  questionId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  selectedOptionIndex?: number;
}

/** TEACHER: grade a single essay / image answer */
export class GradeEssayAnswerDto {
  /** الدرجة الممنوحة — 0 معناها غلط / لم ينجز */
  @IsInt()
  @Min(0)
  awardedMarks!: number;

  /** ملاحظة اختيارية من الأستاذ */
  @IsOptional()
  @IsString()
  teacherNote?: string;
}

