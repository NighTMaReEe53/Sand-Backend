import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AnalyticsService } from './analytics.service';

/**
 * Generates a weekly performance snapshot for every active student enrollment.
 * Runs every Sunday at midnight. Snapshots are stored in WeeklyStudentReport
 * and surfaced to students (ProfilePage) and parents (ParentDashboardPage).
 */
@Injectable()
export class WeeklyReportSnapshotService {
  private readonly logger = new Logger(WeeklyReportSnapshotService.name);

  constructor(private readonly analytics: AnalyticsService) {}

  @Cron(CronExpression.EVERY_WEEK)
  async snapshot() {
    this.logger.log('Generating weekly student performance snapshots...');
    try {
      await this.analytics.generateWeeklySnapshots();
      this.logger.log('Weekly student performance snapshots generated successfully.');
    } catch (err: any) {
      this.logger.error(`Weekly snapshot job failed: ${err?.message}`);
    }
  }
}
