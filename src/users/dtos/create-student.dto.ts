import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PASSWORD_REGEX,
  PASSWORD_VALIDATION_MESSAGE,
  PHONE_REGEX,
  PHONE_VALIDATION_MESSAGE,
} from '../../common/constants/security.constants';

/** TEACHER/ADMIN: create a student account (optionally enrolling into a course). */
export class CreateStudentDto {
  @ApiProperty({ example: 'أحمد محمد' })
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  @Length(3, 100, { message: 'Full name must be between 3 and 100 characters' })
  fullName: string;

  @ApiProperty({ example: 'student@example.com' })
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @ApiProperty({ example: '01012345678' })
  @IsNotEmpty({ message: 'Student phone is required' })
  @Matches(PHONE_REGEX, { message: PHONE_VALIDATION_MESSAGE })
  studentPhone: string;

  @ApiProperty({ example: '01098765432' })
  @IsNotEmpty({ message: 'Guardian phone is required' })
  @Matches(PHONE_REGEX, { message: PHONE_VALIDATION_MESSAGE })
  guardianPhone: string;

  @ApiPropertyOptional({
    example: 'Aa123456',
    description: 'If omitted, a random password is generated and returned once.',
  })
  @IsOptional()
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_VALIDATION_MESSAGE })
  password?: string;

  @ApiProperty({ example: 'SEC_1', description: 'Grade level of the student' })
  @IsNotEmpty({ message: 'Grade level is required' })
  @IsString()
  gradeLevel: string;

  @ApiPropertyOptional({
    description: 'Course to enroll the student into immediately (teacher must own it)',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID(4, { message: 'courseId must be a valid UUID' })
  courseId?: string;
}

/** ADMIN: activate / deactivate an account */
export class SetAccountStatusDto {
  @ApiProperty({ example: true })
  @IsNotEmpty({ message: 'isActive is required' })
  isActive: boolean;
}
