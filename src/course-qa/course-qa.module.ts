import { Module } from '@nestjs/common';
import { CourseQaController } from './course-qa.controller';
import { CourseQaService } from './course-qa.service';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [CourseQaController],
  providers: [CourseQaService],
  exports: [CourseQaService],
})
export class CourseQaModule {}
