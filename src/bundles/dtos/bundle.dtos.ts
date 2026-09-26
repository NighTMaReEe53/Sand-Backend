import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBundleDto {
  @ApiProperty({ example: 'باقة الصف الثالث الثانوي الكاملة' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(150)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ example: 750, description: 'Total bundle price (should be less than the sum of courses).' })
  @Type(() => Number)
  @Min(0)
  price!: number;

  @ApiProperty({ type: [String], description: 'Course UUIDs included in this bundle.' })
  courseIds!: string[];
}

export class UpdateBundleDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(150) title?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @Type(() => Number) @Min(0) price?: number;
  @IsOptional() @IsArray() courseIds?: string[];
  @IsOptional() @Type(() => Boolean) @IsBoolean() isActive?: boolean;
}
