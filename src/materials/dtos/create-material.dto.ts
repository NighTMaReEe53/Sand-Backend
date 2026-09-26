import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MaterialKind } from '@prisma/client';

export class CreateCourseMaterialDto {
  @ApiProperty({
    example: 'ملخص الباب الأول - بيولوجيا',
    description: 'Material title (required)',
  })
  @IsString({ message: 'Title must be a string' })
  @IsNotEmpty({ message: 'Title is required' })
  @Length(2, 150, { message: 'Title must be between 2 and 150 characters' })
  title: string;

  @ApiPropertyOptional({
    example: 'مذكرة شرح تفصيلية مع أهم الأسئلة المتوقعة',
    description: 'Optional description of the material content',
  })
  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  @Length(0, 1000, { message: 'Description cannot exceed 1000 characters' })
  description?: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Section ID that this material belongs to (optional, defaults to first section)',
  })
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional({
    enum: MaterialKind,
    example: MaterialKind.MATERIAL,
    description: 'Whether the file is a study material (default) or a homework assignment',
  })
  @IsOptional()
  kind?: MaterialKind;
}

export class DownloadMaterialResponseDto {
  @ApiProperty({
    example: 'http://localhost:3000/api/v1/storage/stream?key=...&token=...',
    description: 'Temporary Signed Download URL (Expires in 300s)',
  })
  downloadUrl: string;

  @ApiProperty({
    example: 300,
    description: 'Signed URL expiration time in seconds',
  })
  expiresInSeconds: number;

  @ApiProperty({
    example: 'ملخص_الباب_الأول.pdf',
    description: 'Original file name',
  })
  fileName: string;
}
