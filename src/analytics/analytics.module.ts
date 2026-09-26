import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { WeeklyReportSnapshotService } from './weekly-report-snapshot.service';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { PdfModule } from '../shared/pdf/pdf.module';

@Module({
  imports: [PrismaModule, PdfModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, WeeklyReportSnapshotService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
