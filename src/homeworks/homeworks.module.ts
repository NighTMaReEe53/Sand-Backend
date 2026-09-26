import { Module } from '@nestjs/common';
import { HomeworksController } from './homeworks.controller';
import { HomeworksService } from './homeworks.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [HomeworksController],
  providers: [HomeworksService],
  exports: [HomeworksService],
})
export class HomeworksModule {}
