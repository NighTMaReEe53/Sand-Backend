import { IsString, IsOptional, IsUUID, MinLength, MaxLength } from 'class-validator';

export class CreateCourseQuestionDto {
  @IsUUID()
  courseId: string;

  @IsString()
  @MinLength(3)
  @MaxLength(3000)
  content: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}

export class CreateCourseReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  content: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateQuestionStatusDto {
  @IsString()
  status: 'ANSWERED' | 'CLOSED';
}
