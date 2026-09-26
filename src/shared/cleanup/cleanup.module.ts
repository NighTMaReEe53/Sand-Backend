import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OrphanedFilesCleanupService } from './orphaned-files-cleanup.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [OrphanedFilesCleanupService],
  exports: [OrphanedFilesCleanupService],
})
export class CleanupModule {}
