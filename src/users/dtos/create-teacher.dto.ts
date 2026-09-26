import {
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PASSWORD_REGEX,
  PASSWORD_VALIDATION_MESSAGE,
  PHONE_REGEX,
  PHONE_VALIDATION_MESSAGE,
} from '../../common/constants/security.constants';

/**
 * DTO لإنشاء حساب مدرس جديد بواسطة الأدمن.
 * 
 * ملاحظة هامة:
 * في Phase 1، حقل photoUrl هو عبارة عن Optional URL String يدخله الأدمن يدوياً بشكل مؤقت.
 * رفع الملفات الفعلي إلى AWS S3 سيتم دمجه في Phase 2.
 */
export class CreateTeacherDto {
  @ApiProperty({ example: 'أ. محمد سعيد', description: 'Full name of the teacher' })
  @IsString({ message: 'Full name must be a string' })
  @IsNotEmpty({ message: 'Full name is required' })
  @Length(3, 100, { message: 'Full name must be between 3 and 100 characters' })
  fullName: string;

  @ApiProperty({ example: 'مدرس أول لغة عربية', description: 'Subject or specialization' })
  @IsString({ message: 'Specialization must be a string' })
  @IsNotEmpty({ message: 'Specialization is required' })
  specialization: string;

  @ApiProperty({ example: 'teacher@example.com', description: 'Teacher unique email' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @ApiProperty({ example: '01099887766', description: 'Teacher Egyptian phone number' })
  @Matches(PHONE_REGEX, { message: PHONE_VALIDATION_MESSAGE })
  @IsNotEmpty({ message: 'Phone number is required' })
  phone: string;

  @ApiProperty({
    example: 'Teach@2026Pass',
    description: 'Initial password (min 8 chars, 1 uppercase, 1 lowercase, 1 digit)',
  })
  @Matches(PASSWORD_REGEX, { message: PASSWORD_VALIDATION_MESSAGE })
  @IsNotEmpty({ message: 'Password is required' })
  password: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/teachers/photo.jpg',
    description: 'Optional manual photo URL (Phase 1 manual link. AWS S3 upload is in Phase 2)',
  })
  @IsOptional()
  @IsUrl({}, { message: 'photoUrl must be a valid URL string' })
  photoUrl?: string;

  @ApiPropertyOptional({ example: 'مدينة نصر، القاهرة', description: 'Address or city' })
  @IsOptional()
  @IsString({ message: 'Address must be a string' })
  address?: string;

  @ApiPropertyOptional({ example: 'خبرة 15 عاماً في تدريس الثانوية العامة', description: 'Teacher biography' })
  @IsOptional()
  @IsString({ message: 'Bio must be a string' })
  bio?: string;

  @ApiPropertyOptional({ example: 'مؤلف سلسلة كتب التفوق', description: 'Extra information' })
  @IsOptional()
  @IsString({ message: 'Extra info must be a string' })
  extraInfo?: string;

  @ApiPropertyOptional({
    example: ['سنتر النور - المعادي', 'سنتر الأوائل - الدقي'],
    description: 'Educational centers or workplaces',
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'Work places must be an array of strings' })
  @IsString({ each: true, message: 'Each workplace must be a string' })
  workPlaces?: string[];
}
