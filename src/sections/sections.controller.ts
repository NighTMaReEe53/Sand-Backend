import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SectionsService } from './sections.service';
import { CreateSectionDto } from './dtos/create-section.dto';
import { UpdateSectionDto } from './dtos/update-section.dto';
import { ReorderSectionsDto } from './dtos/reorder-sections.dto';

@ApiTags('Sections (Course Chapters)')
@ApiBearerAuth('bearer')
@Controller()
export class SectionsController {
  constructor(private readonly sectionsService: SectionsService) {}

  @Post('courses/:id/sections')
  @Roles(Role.TEACHER, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[TEACHER] إنشاء فصل/سكشن جديد داخل الكورس' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid', description: 'Course ID' })
  @ApiResponse({ status: 201, description: 'Section created successfully.' })
  @ApiResponse({ status: 403, description: 'Access denied.' })
  createSection(
    @Param('id', ParseUUIDPipe) courseId: string,
    @Body() dto: CreateSectionDto,
    @CurrentUser() user: any,
  ) {
    return this.sectionsService.createSection(courseId, dto, user);
  }

  @Patch('sections/:id')
  @Roles(Role.TEACHER, Role.ADMIN)
  @ApiOperation({ summary: '[TEACHER] تعديل عنوان أو ترتيب سكشن' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid', description: 'Section ID' })
  @ApiResponse({ status: 200, description: 'Section updated successfully.' })
  updateSection(
    @Param('id', ParseUUIDPipe) sectionId: string,
    @Body() dto: UpdateSectionDto,
    @CurrentUser() user: any,
  ) {
    return this.sectionsService.updateSection(sectionId, dto, user);
  }

  @Delete('sections/:id')
  @Roles(Role.TEACHER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[TEACHER] حذف سكشن (يُرفض لو فيه محتوى)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid', description: 'Section ID' })
  @ApiResponse({ status: 200, description: 'Section deleted.' })
  @ApiResponse({ status: 400, description: 'Section has content — cannot delete.' })
  deleteSection(
    @Param('id', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: any,
  ) {
    return this.sectionsService.deleteSection(sectionId, user);
  }

  @Post('courses/:id/sections/reorder')
  @Roles(Role.TEACHER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[TEACHER] إعادة ترتيب السكاشن' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid', description: 'Course ID' })
  @ApiResponse({ status: 200, description: 'Sections reordered.' })
  reorderSections(
    @Param('id', ParseUUIDPipe) courseId: string,
    @Body() dto: ReorderSectionsDto,
    @CurrentUser() user: any,
  ) {
    return this.sectionsService.reorderSections(courseId, dto, user);
  }
}
