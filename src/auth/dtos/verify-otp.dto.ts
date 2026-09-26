import { IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  PHONE_REGEX,
  PHONE_VALIDATION_MESSAGE,
} from '../../common/constants/security.constants';

export class VerifyOtpDto {
  @ApiProperty({ example: '01012345678', description: 'Egyptian mobile number' })
  @Matches(PHONE_REGEX, { message: PHONE_VALIDATION_MESSAGE })
  @IsNotEmpty({ message: 'رقم الهاتف مطلوب' })
  phone: string;

  @ApiProperty({ example: '123456', description: '6-digit OTP code' })
  @Matches(/^\d{6}$/, { message: 'رمز التحقق OTP يجب أن يتكون من 6 أرقام' })
  @IsNotEmpty({ message: 'رمز التحقق OTP مطلوب' })
  otp: string;
}
