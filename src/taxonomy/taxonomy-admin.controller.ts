import {
  BadRequestException,
  Controller,
  Body,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../shared/prisma/prisma.service';
import { CreateTaxonomyItemDto } from './dto/taxonomy.dto';

/**
 * Admin taxonomy management — soft delete ONLY (isActive toggling),
 * never hard-delete referenced taxonomy data (plan §2 rule 6).
 */
@ApiTags('Admin · Education Taxonomy')
@ApiBearerAuth('bearer')
@Roles(Role.ADMIN)
@Controller('admin/taxonomy')
export class TaxonomyAdminController {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Systems ──────────────────────────────────────────────────────

  @Post('systems')
  @ApiOperation({ summary: 'Create an education system' })
  createSystem(@Body() dto: CreateTaxonomyItemDto) {
    return this.prisma.educationSystem.create({
      data: { code: dto.code.trim(), name: dto.name.trim() },
    });
  }

  @Patch('systems/:id')
  @ApiOperation({ summary: 'Rename a system' })
  updateSystem(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: Partial<CreateTaxonomyItemDto>) {
    return this.prisma.educationSystem.update({
      where: { id },
      data: { ...(dto.name ? { name: dto.name.trim() } : {}) },
    });
  }

  @Delete('systems/:id')
  @ApiOperation({ summary: 'Deactivate (soft delete) a system' })
  deactivateSystem(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.prisma.educationSystem.update({ where: { id }, data: { isActive: false } });
  }

  @Patch('systems/:id/activate')
  @ApiOperation({ summary: 'Re-activate a system' })
  activateSystem(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.prisma.educationSystem.update({ where: { id }, data: { isActive: true } });
  }

  // ─── Stages ───────────────────────────────────────────────────────

  @Post('stages')
  @ApiOperation({ summary: 'Create a stage under a system (parentId = systemId)' })
  async createStage(@Body() dto: CreateTaxonomyItemDto) {
    if (!dto.parentId) throw new BadRequestException('parentId (systemId) مطلوب.');
    return this.prisma.educationalStage.create({
      data: { code: dto.code.trim(), name: dto.name.trim(), educationSystemId: dto.parentId },
    });
  }

  @Patch('stages/:id')
  @ApiOperation({ summary: 'Rename a stage' })
  updateStage(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: Partial<CreateTaxonomyItemDto>) {
    return this.prisma.educationalStage.update({
      where: { id },
      data: { ...(dto.name ? { name: dto.name.trim() } : {}) },
    });
  }

  @Delete('stages/:id')
  @ApiOperation({ summary: 'Deactivate a stage' })
  deactivateStage(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.prisma.educationalStage.update({ where: { id }, data: { isActive: false } });
  }

  // ─── Grades ───────────────────────────────────────────────────────

  @Post('grades')
  @ApiOperation({ summary: 'Create a grade under a stage (parentId = stageId)' })
  async createGrade(@Body() dto: CreateTaxonomyItemDto) {
    if (!dto.parentId) throw new BadRequestException('parentId (stageId) مطلوب.');
    return this.prisma.grade.create({
      data: {
        code: dto.code.trim(),
        name: dto.name.trim(),
        stageId: dto.parentId,
        hasTracks: Boolean(dto.hasTracks),
      },
    });
  }

  @Patch('grades/:id')
  @ApiOperation({ summary: 'Rename a grade / toggle hasTracks' })
  updateGrade(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: Partial<CreateTaxonomyItemDto>) {
    return this.prisma.grade.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.hasTracks !== undefined ? { hasTracks: dto.hasTracks } : {}),
      },
    });
  }

  @Delete('grades/:id')
  @ApiOperation({ summary: 'Deactivate a grade' })
  deactivateGrade(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.prisma.grade.update({ where: { id }, data: { isActive: false } });
  }

  // ─── Tracks ───────────────────────────────────────────────────────

  @Post('tracks')
  @ApiOperation({ summary: 'Create a track under a grade (parentId = gradeId)' })
  async createTrack(@Body() dto: CreateTaxonomyItemDto) {
    if (!dto.parentId) throw new BadRequestException('parentId (gradeId) مطلوب.');
    return this.prisma.track.create({
      data: { code: `${dto.parentId}:${dto.code.trim()}`, name: dto.name.trim(), gradeId: dto.parentId },
    });
  }

  @Patch('tracks/:id')
  @ApiOperation({ summary: 'Rename a track' })
  updateTrack(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: Partial<CreateTaxonomyItemDto>) {
    return this.prisma.track.update({
      where: { id },
      data: { ...(dto.name ? { name: dto.name.trim() } : {}) },
    });
  }

  @Delete('tracks/:id')
  @ApiOperation({ summary: 'Deactivate a track' })
  deactivateTrack(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.prisma.track.update({ where: { id }, data: { isActive: false } });
  }

  // ─── Subjects ─────────────────────────────────────────────────────

  @Post('subjects')
  @ApiOperation({ summary: 'Create a subject' })
  createSubject(@Body() dto: CreateTaxonomyItemDto) {
    return this.prisma.subject.create({ data: { code: dto.code.trim(), name: dto.name.trim() } });
  }

  @Patch('subjects/:id')
  @ApiOperation({ summary: 'Rename a subject' })
  updateSubject(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: Partial<CreateTaxonomyItemDto>) {
    return this.prisma.subject.update({
      where: { id },
      data: { ...(dto.name ? { name: dto.name.trim() } : {}) },
    });
  }

  @Delete('subjects/:id')
  @ApiOperation({ summary: 'Deactivate a subject' })
  deactivateSubject(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.prisma.subject.update({ where: { id }, data: { isActive: false } });
  }

  // ─── Subject assignments ──────────────────────────────────────────

  @Get('subject-assignments')
  @ApiOperation({ summary: 'List all subject assignments' })
  listAssignments() {
    return this.prisma.subjectAssignment.findMany({
      include: { subject: true, grade: true, track: true },
      orderBy: { id: 'asc' },
      take: 500,
    });
  }

  @Post('subject-assignments')
  @ApiOperation({ summary: 'Assign a subject to a grade (+ optional track)' })
  async createAssignment(
    @Body() dto: { subjectId: string; gradeId: string; trackId?: string | null },
  ) {
    if (!dto.subjectId || !dto.gradeId) throw new BadRequestException('subjectId و gradeId مطلوبان.');
    const grade = await this.prisma.grade.findUnique({ where: { id: dto.gradeId }, include: { tracks: true } });
    if (!grade) throw new BadRequestException('الصف غير موجود.');
    let trackId: string | null = dto.trackId ?? null;
    if (!grade.hasTracks) {
      trackId = null;
    } else if (trackId && !grade.tracks.some((t) => t.id === trackId)) {
      throw new BadRequestException('هذه الشعبة لا تنتمي إلى هذا الصف.');
    }
    const exists = await this.prisma.subjectAssignment.findFirst({
      where: { subjectId: dto.subjectId, gradeId: dto.gradeId, trackId },
    });
    if (exists) return exists;
    return this.prisma.subjectAssignment.create({
      data: { subjectId: dto.subjectId, gradeId: dto.gradeId, trackId },
    });
  }

  @Delete('subject-assignments/:id')
  @ApiOperation({ summary: 'Deactivate a subject assignment' })
  deactivateAssignment(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.prisma.subjectAssignment.update({ where: { id }, data: { isActive: false } });
  }

  // ─── Migration review queue (backfill flags) ──────────────────────

  @Get('review-queue')
  @ApiOperation({ summary: 'Courses flagged during backfill that need manual targeting review' })
  reviewQueue() {
    return this.prisma.course.findMany({
      where: { needsReview: true, isDeleted: false },
      select: {
        id: true,
        title: true,
        gradeLevel: true,
        gradeLevels: true,
        subject: true,
        createdAt: true,
        teacher: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }
}
