import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class GetAdhkarQueryDto {
  @ApiPropertyOptional({ enum: ['morning', 'evening', 'dua'], example: 'morning' })
  @IsOptional()
  @IsIn(['morning', 'evening', 'dua'])
  category?: 'morning' | 'evening' | 'dua';
}

export class GetRandomDuaQueryDto {
  @ApiPropertyOptional({
    enum: ['general', 'exam', 'post-exam', 'post-lecture'],
    default: 'general',
  })
  @IsOptional()
  @IsIn(['general', 'exam', 'post-exam', 'post-lecture'])
  context?: 'general' | 'exam' | 'post-exam' | 'post-lecture';

  @ApiPropertyOptional({
    description: 'Comma-separated Dua codes to exclude (recently shown items)',
    example: 'dua-general-001,dua-general-004',
  })
  @IsOptional()
  @IsString()
  excludeCodes?: string;
}

export class DismissAdhkarDto {
  @ApiProperty({ format: 'uuid', description: 'AdhkarItem id to dismiss for 24h' })
  @IsUUID()
  itemId: string;
}
