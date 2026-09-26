import { Module } from '@nestjs/common';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';
import { LeaderboardService } from './leaderboard.service';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { StorageModule } from '../shared/storage/storage.module';
import { PdfModule } from '../shared/pdf/pdf.module';

@Module({
  imports: [PrismaModule, StorageModule, PdfModule],
  controllers: [ExamsController],
  providers: [ExamsService, LeaderboardService],
  exports: [LeaderboardService],
})
export class ExamsModule {}
