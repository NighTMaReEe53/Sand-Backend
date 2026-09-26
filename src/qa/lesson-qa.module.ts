import { Module } from '@nestjs/common';
import { LessonQaController } from './lesson-qa.controller';
import { LessonQaService } from './lesson-qa.service';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [LessonQaController],
  providers: [LessonQaService],
  exports: [LessonQaService],
})
export class LessonQaModule {}
