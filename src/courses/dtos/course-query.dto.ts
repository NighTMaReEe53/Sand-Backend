import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AccessType, CourseStatus, GradeLevel } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dtos/pagination-query.dto';

// NOTE: must read the RAW value from `obj` — with the global ValidationPipe's
// enableImplicitConversion, the reflected boolean type coerces the query
// string BEFORE @Transform runs (Boolean('false') === true), so a
// value-based transform can never see 'false'. isFree=false was therefore
// indistinguishable from isFree=true and "مدفوع" returned free courses.
const booleanQueryTransform = ({ obj, key }: any) => {
  const raw = obj?.[key];
  return raw === undefined || raw === null ? undefined : raw === 'true' || raw === true;
};

export class CourseQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: GradeLevel, description: 'Filter by grade level' })
  @IsOptional()
  @IsEnum(GradeLevel)
  gradeLevel?: GradeLevel;

  @ApiPropertyOptional({ example: true, description: 'Filter by free courses only' })
  @IsOptional()
  @Transform(booleanQueryTransform)
  @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional({ enum: CourseStatus, description: 'Filter by status (for teachers)' })
  @IsOptional()
  @IsEnum(CourseStatus)
  status?: CourseStatus;

  @ApiPropertyOptional({ enum: AccessType, description: 'Filter by access type: LIFETIME (forever) or LIMITED (bouquet)' })
  @IsOptional()
  @IsEnum(AccessType)
  accessType?: AccessType;

  @ApiPropertyOptional({ description: 'Filter courses by teacher ID' })
  @IsOptional()
  teacherId?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'When true and the caller is a TEACHER, forces results to only their own courses (ignores teacherId)',
  })
  @IsOptional()
  @Transform(booleanQueryTransform)
  @IsBoolean()
  mine?: boolean;

  @ApiPropertyOptional({ description: 'Text search in title/description/teacher name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'رياضيات', description: 'Filter by subject' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional({ example: 0, description: 'Minimum price' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 500, description: 'Maximum price' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ example: 4, description: 'Minimum average rating (1-5)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({
    example: true,
    description:
      'When true and the caller is a STUDENT, only courses the student has an ACTIVE enrollment in are returned. Combinable with all other filters.',
  })
  @IsOptional()
  @Transform(booleanQueryTransform)
  @IsBoolean()
  enrolledOnly?: boolean;

  @ApiPropertyOptional({ description: 'Sort option: newest, price_asc, price_desc, popular, rating' })
  @IsOptional()
  @IsString()
  sort?: string;

  // ─── Taxonomy targeting filters (normalized) ──────────────────────
  // A course matches when it has a CourseTarget with the given gradeId and
  // (trackId equal to the filter OR no track at all — "all tracks").

  @ApiPropertyOptional({ description: 'Taxonomy EducationSystem UUID filter' })
  @IsOptional()
  @IsString()
  educationSystemId?: string;

  @ApiPropertyOptional({ description: 'Taxonomy Stage UUID filter' })
  @IsOptional()
  @IsString()
  stageId?: string;

  @ApiPropertyOptional({ description: 'Taxonomy Grade UUID filter' })
  @IsOptional()
  @IsString()
  gradeId?: string;

  @ApiPropertyOptional({ description: 'Taxonomy Track UUID filter (matches courses open to all tracks too)' })
  @IsOptional()
  @IsString()
  trackId?: string;

  @ApiPropertyOptional({ description: 'Normalized Subject UUID filter' })
  @IsOptional()
  @IsString()
  subjectId?: string;
}
