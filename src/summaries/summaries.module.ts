import { Module } from '@nestjs/common';
import { SummariesController } from './summaries.controller';
import { SummariesService } from './summaries.service';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [SummariesController],
  providers: [SummariesService],
  exports: [SummariesService],
})
export class SummariesModule {}
