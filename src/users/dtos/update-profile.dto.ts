import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { GradeLevel } from '@prisma/client';
import {
  PHONE_REGEX,
  PHONE_VALIDATION_MESSAGE,
} from '../../common/constants/security.constants';

export class UpdateProfileDto {
  // Student & Teacher Common
  @ApiPropertyOptional({ example: 'أحمد محمود', description: 'Updated full name' })
  @IsOptional()
  @IsString({ message: 'Full name must be a string' })
  @Length(3, 100, { message: 'Full name must be between 3 and 100 characters' })
  fullName?: string;

  // Student Profile fields
  @ApiPropertyOptional({ example: '01155443322', description: "Updated guardian's phone number" })
  @IsOptional()
  @Matches(PHONE_REGEX, { message: "Guardian's " + PHONE_VALIDATION_MESSAGE.toLowerCase() })
  guardianPhone?: string;

  @ApiPropertyOptional({ enum: GradeLevel, description: 'Updated grade level (for students)' })
  @IsOptional()
  @IsEnum(GradeLevel, {
    message: `Grade level must be one of: ${Object.values(GradeLevel).join(', ')}`,
  })
  gradeLevel?: GradeLevel;

  // Teacher Profile fields
  @ApiPropertyOptional({ example: 'مدرس فيزياء للثانوية العامة', description: 'Specialization' })
  @IsOptional()
  @IsString()
  specialization?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/photo.jpg', description: 'Photo URL' })
  @IsOptional()
  @IsUrl({}, { message: 'photoUrl must be a valid URL' })
  photoUrl?: string;

  @ApiPropertyOptional({ example: 'الدقي، الجيزة', description: 'Address' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'نبذة عن الخبرة والتدريس', description: 'Bio' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ example: 'معلومات إضافية', description: 'Extra info' })
  @IsOptional()
  @IsString()
  extraInfo?: string;

  @ApiPropertyOptional({ example: ['سنتر التفوق'], description: 'Workplaces', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  workPlaces?: string[];
}
