import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ChallengesController } from './challenges.controller';
import { ChallengesService } from './challenges.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ScheduleModule.forRoot(), NotificationsModule],
  controllers: [ChallengesController],
  providers: [ChallengesService],
  exports: [ChallengesService],
})
export class ChallengesModule {}
