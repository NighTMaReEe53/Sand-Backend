import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { GradeLevel } from '@prisma/client';
import {
  PASSWORD_REGEX,
  PASSWORD_VALIDATION_MESSAGE,
  PHONE_REGEX,
  PHONE_VALIDATION_MESSAGE,
} from '../../common/constants/security.constants';

export class RegisterStudentDto {
  @ApiProperty({ example: 'أحمد محمد', description: 'Full name of the student' })
  @IsString({ message: 'الاسم بالكامل يجب أن يكون نصاً' })
  @IsNotEmpty({ message: 'الاسم بالكامل مطلوب' })
  @Length(3, 100, { message: 'يجب أن يكون الاسم بين 3 و 100 حرف' })
  @Matches(/\S+(?:\s+\S+){2,}/u, {
    message: 'اكتب الاسم ثلاثياً على الأقل: الاسم الأول واسم الأب واسم الجد',
  })
  fullName: string;

  @ApiProperty({ example: 'student@example.com', description: 'Unique email address' })
  @IsEmail({}, { message: 'يرجى إدخال بريد إلكتروني صالح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  email: string;

  @ApiProperty({ example: '01012345678', description: 'Egyptian mobile number (11 digits)' })
  @Matches(PHONE_REGEX, { message: PHONE_VALIDATION_MESSAGE })
  @IsNotEmpty({ message: 'رقم هاتف الطالب مطلوب' })
  phone: string;

  @ApiProperty({ example: '01198765432', description: "Guardian's Egyptian mobile number (11 digits)" })
  @Matches(PHONE_REGEX, {
    message: 'رقم هاتف ولي الأمر يجب أن يكون رقماً مصرياً صحيحاً مكوناً من 11 رقماً (يبدأ بـ 010 أو 011 أو 012 أو 015)',
  })
  @IsNotEmpty({ message: 'رقم هاتف ولي الأمر مطلوب' })
  guardianPhone: string;

  @ApiProperty({
    example: 'P@ssw0rd123',
    description: 'Strong password (min 8 chars, 1 uppercase, 1 lowercase, 1 digit)',
  })
  @Matches(PASSWORD_REGEX, { message: PASSWORD_VALIDATION_MESSAGE })
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة' })
  password: string;

  @ApiProperty({
    enum: GradeLevel,
    required: false,
    description: 'LEGACY compatibility grade — resolved automatically from gradeId. Do not send from new clients.',
  })
  @IsOptional()
  @IsEnum(GradeLevel, {
    message: 'الصف الدراسي المحدد غير صالح',
  })
  gradeLevel?: GradeLevel;

  @ApiProperty({
    description: 'Normalized taxonomy Grade UUID (source of truth for the student education profile). Required for new clients unless legacy gradeLevel is sent.',
    example: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    required: false,
  })
  @IsOptional()
  @IsUUID('4', { message: 'الصف الدراسي (gradeId) يجب أن يكون معرفاً صالحاً' })
  gradeId?: string;

  @ApiProperty({
    required: false,
    description: 'Track UUID — REQUIRED when the selected grade has mandatory tracks',
  })
  @IsOptional()
  @IsUUID('4', { message: 'الشعبة المحددة غير صالحة' })
  trackId?: string | null;
}
