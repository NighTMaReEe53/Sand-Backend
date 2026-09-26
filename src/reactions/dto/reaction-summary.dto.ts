import { IsEnum, IsString, IsNotEmpty } from 'class-validator';
import { ReactionTargetType } from '@prisma/client';

export class ReactionSummaryDto {
  @IsEnum(ReactionTargetType)
  targetType: ReactionTargetType;

  @IsString()
  @IsNotEmpty()
  targetId: string;
}
