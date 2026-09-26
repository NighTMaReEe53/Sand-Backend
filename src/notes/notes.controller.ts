import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotesService } from './notes.service';
import { BookmarksService } from './bookmarks.service';
import {
  CreateBookmarkDto,
  CreateNoteDto,
  ListBookmarksQueryDto,
  ListNotesQueryDto,
  UpdateNoteDto,
} from './notes.dtos';

@ApiTags('Notes & Bookmarks')
@ApiBearerAuth('bearer')
@Controller()
export class NotesController {
  constructor(
    private readonly notesService: NotesService,
    private readonly bookmarksService: BookmarksService,
  ) {}

  // ─── Notes ─────────────────────────────────────────────────────

  @Roles(Role.STUDENT)
  @Post('notes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a note linked to a lesson (optionally at a video timestamp).' })
  createNote(@CurrentUser('id') userId: string, @Body() dto: CreateNoteDto) {
    return this.notesService.createNote(userId, dto);
  }

  @Roles(Role.STUDENT)
  @Get('notes')
  @ApiOperation({
    summary:
      'List own notes with optional courseId / lessonId / search filters and pagination.',
  })
  listNotes(@CurrentUser('id') userId: string, @Query() query: ListNotesQueryDto) {
    return this.notesService.listNotes(userId, query);
  }

  @Roles(Role.STUDENT)
  @Patch('notes/:id')
  @ApiOperation({ summary: 'Update own note.' })
  updateNote(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoteDto,
  ) {
    return this.notesService.updateNote(userId, id, dto);
  }

  @Roles(Role.STUDENT)
  @Delete('notes/:id')
  @ApiOperation({ summary: 'Delete own note.' })
  deleteNote(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notesService.deleteNote(userId, id);
  }

  // ─── Bookmarks ─────────────────────────────────────────────────

  @Roles(Role.STUDENT)
  @Post('bookmarks')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a bookmark on a lesson (video timestamp or PDF page).' })
  createBookmark(@CurrentUser('id') userId: string, @Body() dto: CreateBookmarkDto) {
    return this.bookmarksService.createBookmark(userId, dto);
  }

  @Roles(Role.STUDENT)
  @Get('bookmarks')
  @ApiOperation({ summary: 'List own bookmarks with optional course/lesson filters.' })
  listBookmarks(@CurrentUser('id') userId: string, @Query() query: ListBookmarksQueryDto) {
    return this.bookmarksService.listBookmarks(userId, query);
  }

  @Roles(Role.STUDENT)
  @Delete('bookmarks/:id')
  @ApiOperation({ summary: 'Delete own bookmark.' })
  deleteBookmark(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bookmarksService.deleteBookmark(userId, id);
  }
}
