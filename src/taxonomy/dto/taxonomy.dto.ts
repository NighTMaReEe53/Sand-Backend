import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTaxonomyItemDto {
  @ApiProperty({ example: 'EDUCATION_GENERAL' })
  @IsString()
  @MinLength(2)
  code: string;

  @ApiProperty({ example: 'التعليم العام' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: 'Parent entity id (systemId / stageId / gradeId depending on route)' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  hasTracks?: boolean;
}

export class SetCourseTargetsDto {
  @ApiProperty({
    type: [Object],
    example: [{ gradeId: 'uuid', trackId: 'uuid' }, { gradeId: 'uuid', trackId: null }],
  })
  targets: { gradeId: string; trackId?: string | null }[];
}

export class AddCourseTargetDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  gradeId: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  trackId?: string | null;
}

export class UpdateCourseTargetDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  gradeId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  trackId?: string | null;
}

export class SetEducationProfileDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  educationSystemId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  stageId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  gradeId: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  trackId?: string | null;
}
