import { Module } from '@nestjs/common';
import { StudyPlannerController } from './study-planner.controller';
import { StudyPlannerService } from './study-planner.service';
import { PrismaModule } from '../shared/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StudyPlannerController],
  providers: [StudyPlannerService],
  exports: [StudyPlannerService],
})
export class StudyPlannerModule {}
