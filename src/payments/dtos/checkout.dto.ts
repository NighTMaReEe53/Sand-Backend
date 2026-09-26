import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckoutDto {
  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'Target Course UUID for enrollment (Price is strictly calculated on the server). Required unless bundleId is provided.',
  })
  @IsUUID('4', { message: 'courseId must be a valid UUID' })
  @ValidateIf((o) => !o.bundleId)
  @IsNotEmpty({ message: 'courseId is required when bundleId is not provided' })
  courseId?: string;

  @ApiPropertyOptional({
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    description: 'Bundle UUID — purchasing a bundle enrolls the student in every paid published course of that bundle.',
  })
  @IsUUID('4', { message: 'bundleId must be a valid UUID' })
  @ValidateIf((o) => !o.courseId)
  @IsNotEmpty({ message: 'bundleId is required when courseId is not provided' })
  bundleId?: string;

  @ApiPropertyOptional({
    example: 'SUMMER25',
    description: 'Optional discount coupon code. The final price is always computed on the server.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  couponCode?: string;
}
