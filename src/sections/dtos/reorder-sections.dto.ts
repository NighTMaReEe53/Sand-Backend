import { IsArray, IsString, IsUUID, ArrayNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReorderSectionsDto {
  @ApiProperty({
    description: 'مصفوفة IDs السكاشن بالترتيب الجديد المطلوب',
    type: [String],
    example: ['uuid-1', 'uuid-2', 'uuid-3'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  sectionIds: string[];
}
