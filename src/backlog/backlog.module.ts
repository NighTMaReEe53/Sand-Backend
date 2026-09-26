import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BacklogController } from './backlog.controller';
import { BacklogService } from './backlog.service';
import { LessonsModule } from '../lessons/lessons.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    LessonsModule,
    NotificationsModule,
  ],
  controllers: [BacklogController],
  providers: [BacklogService],
  exports: [BacklogService],
})
export class BacklogModule {}
