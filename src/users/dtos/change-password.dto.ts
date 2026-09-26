import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  PASSWORD_REGEX,
  PASSWORD_VALIDATION_MESSAGE,
} from '../../common/constants/security.constants';

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldPassword123', description: 'Current account password' })
  @IsString({ message: 'Current password must be a string' })
  @IsNotEmpty({ message: 'Current password is required' })
  currentPassword: string;

  @ApiProperty({
    example: 'NewSecurePass@2026',
    description: 'New password (min 8 chars, 1 uppercase, 1 lowercase, 1 digit)',
  })
  @Matches(PASSWORD_REGEX, { message: PASSWORD_VALIDATION_MESSAGE })
  @IsNotEmpty({ message: 'New password is required' })
  newPassword: string;
}
