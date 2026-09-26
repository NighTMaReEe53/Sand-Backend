import { ExamAttemptExitType } from '@prisma/client';
import { IsEnum, IsUUID } from 'class-validator';

export class RecordExamExitDto {
  /** Client-generated UUID reused by all browser events for one exit. */
  @IsUUID()
  eventId: string;

  @IsEnum(ExamAttemptExitType)
  exitType: ExamAttemptExitType;
}
