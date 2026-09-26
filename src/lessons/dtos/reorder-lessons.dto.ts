import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class LessonOrderItemDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'Lesson UUID' })
  @IsUUID('4', { message: 'lessonId must be a valid UUID' })
  @IsNotEmpty({ message: 'lessonId is required' })
  lessonId: string;

  @ApiProperty({ example: 1, description: 'New order index position' })
  @IsInt({ message: 'newOrderIndex must be an integer' })
  @Min(1, { message: 'newOrderIndex must be at least 1' })
  newOrderIndex: number;
}

export class ReorderLessonsDto {
  @ApiProperty({
    example: 'c1d2e3f4-a5b6-7890-abcd-ef1234567890',
    description: 'Course UUID that owns all these lessons (Mandatory constraint)',
  })
  @IsUUID('4', { message: 'courseId must be a valid UUID' })
  @IsNotEmpty({ message: 'courseId is required' })
  courseId: string;

  @ApiProperty({
    type: [LessonOrderItemDto],
    description: 'Array of lesson IDs with their desired new order indices',
  })
  @IsArray({ message: 'orders must be an array' })
  @ValidateNested({ each: true })
  @Type(() => LessonOrderItemDto)
  orders: LessonOrderItemDto[];
}
