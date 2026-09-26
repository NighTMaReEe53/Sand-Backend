import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CoursesService } from './courses.service';
import { CoursesController } from './courses.controller';
import { CourseOwnerGuard } from './guards/course-owner.guard';
import { TaxonomyModule } from '../taxonomy/taxonomy.module';

@Module({
  imports: [TaxonomyModule, ScheduleModule.forRoot()],
  controllers: [CoursesController],
  providers: [CoursesService, CourseOwnerGuard],
  exports: [CoursesService, CourseOwnerGuard],
})
export class CoursesModule {}
