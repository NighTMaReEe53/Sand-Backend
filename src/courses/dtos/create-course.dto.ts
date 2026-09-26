import {
  IsBoolean,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CourseStatus, GradeLevel, AccessType } from '@prisma/client';

export class CreateCourseDto {
  @ApiProperty({ example: 'شرح مادة الأحياء للثانوية العامة', description: 'Course title' })
  @IsString({ message: 'Title must be a string' })
  @IsNotEmpty({ message: 'Course title is required' })
  @Length(3, 150, { message: 'Title must be between 3 and 150 characters' })
  title: string;

  @ApiPropertyOptional({
    example: 'كورس شامل يغطي منهج الأحياء للصف الثالث الثانوي مع تدريبات وامتحانات دورية.',
    description: 'Detailed description of the course',
  })
  @IsString({ message: 'Description must be a string' })
  @IsNotEmpty({ message: 'Course description is required' })
  description: string;

  @ApiPropertyOptional({
    example: ['فهم أحداث المنهج بترتيبها الزمني', 'حل أسئلة وتدريبات متنوعة'],
    description: 'Short bullet points describing what the student will gain from the course',
  })
  @IsOptional()
  @IsArray({ message: 'ملخص ما سيتعلمه الطالب يجب أن يكون في صورة نقاط.' })
  @ArrayMaxSize(12, { message: 'يمكن إضافة 12 نقطة كحد أقصى.' })
  @IsString({ each: true, message: 'كل نقطة في الملخص يجب أن تكون نصاً.' })
  @MaxLength(180, { each: true, message: 'لا يمكن أن تزيد النقطة عن 180 حرفاً.' })
  learningOutcomes?: string[];

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/thumbnails/biology.jpg',
    description: 'Course thumbnail image URL',
  })
  @IsOptional()
  @Matches(/^(https?:\/\/\S+|\/\S+)$/i, {
    message:
      'thumbnailUrl must be a valid URL address or a server-relative path starting with /',
  })
  thumbnailUrl?: string;

  @ApiPropertyOptional({ example: 150.0, description: 'Price in EGP (0 for free courses)', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Price must be a number' })
  @Min(0, { message: 'Price cannot be negative' })
  price?: number = 0;

  @ApiPropertyOptional({ example: false, description: 'Whether the course is completely free', default: false })
  @IsOptional()
  @IsBoolean({ message: 'isFree must be a boolean' })
  isFree?: boolean = false;

  @ApiPropertyOptional({
    example: 25,
    description: 'Offer discount percentage (1-90) shown on the course card until discountEndsAt',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Discount percentage must be a whole number' })
  @Min(0, { message: 'Discount percentage cannot be negative' })
  discountPercent?: number;

  @ApiPropertyOptional({
    example: '2026-09-30T23:59:59.000Z',
    description: 'ISO datetime when the offer/discount expires (coupon end time)',
  })
  @IsOptional()
  @IsString()
  discountEndsAt?: string;

  @ApiPropertyOptional({
    enum: GradeLevel,
    example: GradeLevel.SEC_3_SCIENTIFIC,
    description: 'Legacy primary target grade level',
  })
  @IsOptional()
  @IsEnum(GradeLevel, {
    message: `Grade level must be one of: ${Object.values(GradeLevel).join(', ')}`,
  })
  gradeLevel?: GradeLevel;

  @ApiProperty({
    enum: GradeLevel,
    isArray: true,
    example: [GradeLevel.SEC_1, GradeLevel.SEC_2],
    description: 'All target grade levels for this course',
  })
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

  @ApiPropertyOptional({
    enum: CourseStatus,
    example: CourseStatus.DRAFT,
    description: 'Initial course status',
    default: CourseStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(CourseStatus, {
    message: `Status must be one of: ${Object.values(CourseStatus).join(', ')}`,
  })
  status?: CourseStatus = CourseStatus.DRAFT;

  @ApiPropertyOptional({
    enum: AccessType,
    example: AccessType.LIMITED,
    description: 'LIFETIME = lessons forever, LIMITED = bouquet with a timer',
    default: AccessType.LIFETIME,
  })
  @IsOptional()
  @IsEnum(AccessType, { message: 'accessType must be LIFETIME or LIMITED' })
  accessType?: AccessType;

  @ApiPropertyOptional({
    example: 3,
    description: 'Bouquet duration in months (required when accessType is LIMITED)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'durationMonths must be a whole number' })
  @Min(1, { message: 'durationMonths must be at least 1 month' })
  durationMonths?: number;

  @ApiPropertyOptional({
    type: [Object],
    example: [{ gradeId: 'uuid', trackId: 'uuid' }],
    description: 'Normalized taxonomy targets (created transactionally with the course)',
  })
  @IsOptional()
  @IsArray()
  targets?: { gradeId: string; trackId?: string | null }[];

  @ApiPropertyOptional({ description: 'Normalized Subject UUID (source of truth for subject)' })
  @IsOptional()
  @IsString()
  subjectId?: string;
}
