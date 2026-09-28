import { IsEmail, IsNotEmpty, IsString, Matches, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PHONE_REGEX, PHONE_VALIDATION_MESSAGE } from '../../common/constants/security.constants';

export class LoginDto {
  @ApiPropertyOptional({ example: 'student@example.com', description: 'User registered email address' })
  @ValidateIf((dto) => !dto.phone)
  @IsEmail({}, { message: 'يرجى إدخال بريد إلكتروني صالح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  email?: string;

  @ApiPropertyOptional({ example: '01012345678', description: 'User registered Egyptian mobile number' })
  @ValidateIf((dto) => !dto.email)
  @Matches(PHONE_REGEX, { message: PHONE_VALIDATION_MESSAGE })
  @IsNotEmpty({ message: 'رقم الهاتف مطلوب' })
  phone?: string;

  @ApiProperty({ example: 'P@ssw0rd123', description: 'User account password' })
  @IsString({ message: 'كلمة المرور يجب أن تكون نصاً' })
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة' })
  password: string;
}
