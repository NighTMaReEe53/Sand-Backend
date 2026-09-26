import { IsString, IsOptional, IsUUID, IsUrl, IsArray, IsBoolean, MinLength, MaxLength } from 'class-validator';

export class CreateSummaryDto {
  @IsUUID()
  courseId: string;

  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title: string;

  @IsString()
  @MinLength(10)
  description: string;

  @IsOptional()
  @IsUrl()
  videoUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}

export class ModerateSummaryDto {
  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

export class CreateSummaryCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}
