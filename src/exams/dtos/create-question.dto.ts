import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateQuestionDto {
  @ApiProperty({
    example: 'ما هي وحدة قياس شدة التيار الكهربي في النظام الدولي للوحدات (SI)؟',
    description: 'Question text',
  })
  @IsString({ message: 'text must be a string' })
  @IsNotEmpty({ message: 'Question text is required' })
  text: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/questions/circuit1.png',
    description: 'Optional illustration diagram image URL',
  })
  @IsOptional()
  @IsString({ message: 'imageUrl must be a string' })
  imageUrl?: string;

  @ApiProperty({
    example: ['الفولت (V)', 'الأمبير (A)', 'الأوم (Ω)', 'الوات (W)'],
    description: 'List of 2 to 6 multiple choice options',
  })
  @IsArray({ message: 'options must be an array of strings' })
  @ArrayMinSize(2, { message: 'Question must have at least 2 options' })
  @IsString({ each: true, message: 'Each option must be a string' })
  options: string[];

  @ApiProperty({
    example: 1,
    description: '0-based index of the correct option (e.g. 1 points to second option "الأمبير")',
  })
  @Type(() => Number)
  @IsInt({ message: 'correctOptionIndex must be an integer' })
  @Min(0, { message: 'correctOptionIndex cannot be negative' })
  correctOptionIndex: number;

  @ApiPropertyOptional({
    example: 'الأمبير هو وحدة قياس شدة التيار وفقاً للنظام الدولي للوحدات، حيث 1 أمبير = 1 كولوم / 1 ثانية.',
    description: 'Explanation for model answer shown after submission',
  })
  @IsOptional()
  @IsString()
  explanation?: string;

  @ApiPropertyOptional({ example: 1, description: 'Marks awarded for this question', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  marks?: number = 1;

  @ApiPropertyOptional({ example: 1, description: 'Order position of question' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderIndex?: number;
}
