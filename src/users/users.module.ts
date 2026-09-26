import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AdminController } from './admin.controller';
import { TeachersController } from './teachers.controller';
import { StudentsController } from './students.controller';

@Module({
  controllers: [AdminController, UsersController, TeachersController, StudentsController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
