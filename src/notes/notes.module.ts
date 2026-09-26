import { Module } from '@nestjs/common';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { BookmarksService } from './bookmarks.service';
import { PrismaModule } from '../shared/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [NotesController],
  providers: [NotesService, BookmarksService],
  exports: [NotesService, BookmarksService],
})
export class NotesModule {}
