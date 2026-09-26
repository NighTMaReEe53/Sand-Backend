import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MaterialType } from '@prisma/client';

export class CreateMaterialDto {
  @ApiProperty({ example: 'ملخص الباب الأول - بيولوجيا', description: 'Material title' })
  @IsString({ message: 'Title must be a string' })
  @IsNotEmpty({ message: 'Title is required' })
  @Length(2, 150, { message: 'Title must be between 2 and 150 characters' })
  title: string;

  @ApiProperty({
    example: 'https://cdn.example.com/materials/summary1.pdf',
    description: 'File URL (PDF or document)',
  })
  @IsUrl({}, { message: 'fileUrl must be a valid URL' })
  @IsNotEmpty({ message: 'fileUrl is required' })
  fileUrl: string;

  @ApiPropertyOptional({
    enum: MaterialType,
    example: MaterialType.PDF,
    description: 'Type of attached file',
    default: MaterialType.PDF,
  })
  @IsOptional()
  @IsEnum(MaterialType, {
    message: `fileType must be one of: ${Object.values(MaterialType).join(', ')}`,
  })
  fileType?: MaterialType = MaterialType.PDF;

  @ApiPropertyOptional({
    example: 'c1d2e3f4-a5b6-7890-abcd-ef1234567890',
    description: 'Attach directly to Course (XOR with lessonId)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'courseId must be a valid UUID' })
  courseId?: string;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'Attach directly to a specific Lesson (XOR with courseId)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'lessonId must be a valid UUID' })
  lessonId?: string;
}
