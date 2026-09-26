import { IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  PHONE_REGEX,
  PHONE_VALIDATION_MESSAGE,
} from '../../common/constants/security.constants';

export class ResendOtpDto {
  @ApiProperty({ example: '01012345678', description: 'Egyptian mobile number' })
  @Matches(PHONE_REGEX, { message: PHONE_VALIDATION_MESSAGE })
  @IsNotEmpty({ message: 'رقم الهاتف مطلوب' })
  phone: string;
}
