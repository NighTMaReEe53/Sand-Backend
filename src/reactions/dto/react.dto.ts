import { IsEnum, IsString, IsNotEmpty } from 'class-validator';
import { ReactionTargetType, ReactionType } from '@prisma/client';

export class ReactDto {
  @IsEnum(ReactionTargetType)
  targetType: ReactionTargetType;

  @IsString()
  @IsNotEmpty()
  targetId: string;

  @IsEnum(ReactionType)
  type: ReactionType;
}
