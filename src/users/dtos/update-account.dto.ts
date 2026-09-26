import {
  IsEmail,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  PHONE_REGEX,
  PHONE_VALIDATION_MESSAGE,
} from '../../common/constants/security.constants';

/** ADMIN: partially update a student account. */
export class UpdateStudentDto {
  @ApiPropertyOptional({ example: 'أحمد محمد' })
  @IsOptional()
  @IsString()
  @Length(3, 100, { message: 'Full name must be between 3 and 100 characters' })
  fullName?: string;

  @ApiPropertyOptional({ example: 'student@example.com' })
  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email?: string;

  @ApiPropertyOptional({ example: '01012345678' })
  @IsOptional()
  @Matches(PHONE_REGEX, { message: PHONE_VALIDATION_MESSAGE })
  studentPhone?: string;

  @ApiPropertyOptional({ example: '01098765432' })
  @IsOptional()
  @Matches(PHONE_REGEX, { message: PHONE_VALIDATION_MESSAGE })
  guardianPhone?: string;

  @ApiPropertyOptional({ example: 'SEC_1', enum: [
    'PREP_1', 'PREP_2', 'PREP_3',
    'SEC_1', 'SEC_2', 'SEC_3_LITERARY', 'SEC_3_SCIENTIFIC',
    'AZHAR_PREP', 'AZHAR_SEC', 'BAC',
  ] })
  @IsOptional()
  @IsString()
  gradeLevel?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** ADMIN: partially update a teacher account. */
export class UpdateTeacherDto {
  @ApiPropertyOptional({ example: 'أستاذ خالد' })
  @IsOptional()
  @IsString()
  @Length(3, 100, { message: 'Full name must be between 3 and 100 characters' })
  fullName?: string;

  @ApiPropertyOptional({ example: 'teacher@example.com' })
  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email?: string;

  @ApiPropertyOptional({ example: '01012345678' })
  @IsOptional()
  @Matches(PHONE_REGEX, { message: PHONE_VALIDATION_MESSAGE })
  phone?: string;

  @ApiPropertyOptional({ example: 'مدرس أول لغة عربية' })
  @IsOptional()
  @IsString()
  specialization?: string;

  @ApiPropertyOptional({ example: 'خبرة 15 عاماً في التدريس...' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ example: 'مدينة نصر، القاهرة' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'https://.../photo.jpg' })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
