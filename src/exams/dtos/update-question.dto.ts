import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateQuestionDto {
  @ApiPropertyOptional({ description: 'Question text' })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({ description: 'Illustration image URL' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Array of options' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional({ description: '0-based index of correct option' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  correctOptionIndex?: number;

  @ApiPropertyOptional({ description: 'Explanation' })
  @IsOptional()
  @IsString()
  explanation?: string;

  @ApiPropertyOptional({ description: 'Marks' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  marks?: number;

  @ApiPropertyOptional({ description: 'Order index' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderIndex?: number;
}
