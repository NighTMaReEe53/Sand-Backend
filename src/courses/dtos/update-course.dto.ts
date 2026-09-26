import {
  IsBoolean,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Length,
  ArrayMaxSize,
  ArrayMinSize,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CourseStatus, GradeLevel, AccessType } from '@prisma/client';

export class UpdateCourseDto {
  @ApiPropertyOptional({ example: 'العنوان المحدث للكورس', description: 'Course title' })
  @IsOptional()
  @IsString()
  @Length(3, 150)
  title?: string;

  @ApiPropertyOptional({ example: 'الوصف المحدث للكورس', description: 'Course description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: ['فهم التسلسل الزمني للأحداث', 'التدرب على أسئلة الامتحان'],
    description: 'Short bullet points describing what the student will gain from the course',
  })
  @IsOptional()
  @IsArray({ message: 'ملخص ما سيتعلمه الطالب يجب أن يكون في صورة نقاط.' })
  @ArrayMaxSize(12, { message: 'يمكن إضافة 12 نقطة كحد أقصى.' })
  @IsString({ each: true, message: 'كل نقطة في الملخص يجب أن تكون نصاً.' })
  @MaxLength(180, { each: true, message: 'لا يمكن أن تزيد النقطة عن 180 حرفاً.' })
  learningOutcomes?: string[];

  @ApiPropertyOptional({ example: 'https://cdn.example.com/new-thumb.jpg', description: 'Thumbnail URL' })
  @IsOptional()
  @Matches(/^(https?:\/\/\S+|\/\S+)$/i, {
    message:
      'thumbnailUrl must be a valid URL address or a server-relative path starting with /',
  })
  thumbnailUrl?: string;

  @ApiPropertyOptional({ example: 200.0, description: 'Course price' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ example: false, description: 'Is course free' })
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional({
    example: 25,
    description: 'Offer discount percentage (0/null clears the offer, 1-90 sets it)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Discount percentage must be a whole number' })
  @Min(0, { message: 'Discount percentage cannot be negative' })
  discountPercent?: number;

  @ApiPropertyOptional({
    example: '2026-09-30T23:59:59.000Z',
    description: 'ISO datetime when the offer/discount expires',
  })
  @IsOptional()
  @IsString()
  discountEndsAt?: string;

  @ApiPropertyOptional({ enum: GradeLevel, description: 'Target grade level' })
  @IsOptional()
  @IsEnum(GradeLevel)
  gradeLevel?: GradeLevel;

  @ApiPropertyOptional({ enum: GradeLevel, isArray: true, description: 'All target grade levels for this course' })
  @IsOptional()
  @IsArray({ message: 'الفئات المستهدفة يجب أن تكون قائمة من المراحل الدراسية.' })
  @ArrayMinSize(1, { message: 'اختر مرحلة دراسية واحدة على الأقل للكورس.' })
  @ArrayMaxSize(7, { message: 'لا يمكن اختيار أكثر من 7 مراحل دراسية.' })
  @IsEnum(GradeLevel, { each: true, message: 'توجد مرحلة دراسية غير صحيحة ضمن الفئات المستهدفة.' })
  gradeLevels?: GradeLevel[];

  @ApiPropertyOptional({
    example: 'رياضيات',
    description: 'Subject of the course (e.g. رياضيات، لغة عربية، علوم)',
  })
  @IsOptional()
  @IsString({ message: 'Subject must be a string' })
  @Length(1, 50, { message: 'Subject must be between 1 and 50 characters' })
  subject?: string;

  @ApiPropertyOptional({ description: 'Normalized Subject UUID (source of truth)' })
  @IsOptional()
  @IsString()
  subjectId?: string;

  @ApiPropertyOptional({ enum: CourseStatus, description: 'Course publishing status' })
  @IsOptional()
  @IsEnum(CourseStatus)
  status?: CourseStatus;

  @ApiPropertyOptional({
    enum: AccessType,
    example: AccessType.LIMITED,
    description: 'LIFETIME = lessons forever, LIMITED = bouquet with a timer',
  })
  @IsOptional()
  @IsEnum(AccessType, { message: 'accessType must be LIFETIME or LIMITED' })
  accessType?: AccessType;

  @ApiPropertyOptional({
    example: 3,
    description: 'Bouquet duration in months',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'durationMonths must be a whole number' })
  @Min(1, { message: 'durationMonths must be at least 1 month' })
  durationMonths?: number;
}
