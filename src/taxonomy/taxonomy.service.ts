import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../shared/prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

export interface TargetInput {
  gradeId: string;
  trackId?: string | null;
}

/**
 * Single source of truth for taxonomy reads + all targeting validation.
 * Never duplicate these rules in controllers.
 */
@Injectable()
export class TaxonomyService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Reads (cascading selects) ─────────────────────────────────────

  listSystems() {
    return this.prisma.educationSystem.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      include: { stages: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } },
    });
  }

  async listStages(systemId: string) {
    const system = await this.prisma.educationSystem.findUnique({ where: { id: systemId } });
    if (!system) throw new NotFoundException('النظام التعليمي غير موجود.');
    return this.prisma.educationalStage.findMany({
      where: { educationSystemId: systemId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listGrades(stageId: string) {
    const stage = await this.prisma.educationalStage.findUnique({ where: { id: stageId } });
    if (!stage) throw new NotFoundException('المرحلة غير موجودة.');
    return this.prisma.grade.findMany({
      where: { stageId, isActive: true },
      orderBy: { createdAt: 'asc' },
      include: { tracks: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } },
    });
  }

  async listTracks(gradeId: string) {
    const grade = await this.prisma.grade.findUnique({ where: { id: gradeId } });
    if (!grade) throw new NotFoundException('الصف غير موجود.');
    return this.prisma.track.findMany({
      where: { gradeId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Subjects valid for a grade — optionally narrowed by a specific track via SubjectAssignment. */
  async listSubjectsForGrade(gradeId: string, trackId?: string | null) {
    const assignments = await this.prisma.subjectAssignment.findMany({
      where: {
        gradeId,
        isActive: true,
        ...(trackId ? { OR: [{ trackId }, { trackId: null }] } : {}),
      },
      include: { subject: true },
    });
    // A subject assigned to the grade (any track) is valid; prefer track-specific matches first
    const bySubject = new Map<string, { id: string; code: string; name: string; trackSpecific: boolean }>();
    for (const a of assignments) {
      const existing = bySubject.get(a.subjectId);
      const trackSpecific = Boolean(a.trackId);
      if (!existing || (trackSpecific && !existing.trackSpecific)) {
        bySubject.set(a.subjectId, {
          id: a.subject.id,
          code: a.subject.code,
          name: a.subject.name,
          trackSpecific,
        });
      }
    }
    return Array.from(bySubject.values());
  }

  listAllSubjects() {
    return this.prisma.subject.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  // ─── Validation rules (§5.2) ───────────────────────────────────────

  /**
   * Validates a (gradeId, trackId) pair:
   * 1. Track must belong to the given Grade (reject cross-grade assignment).
   * 2. Grade.hasTracks = true → trackId REQUIRED.
   * 3. Grade.hasTracks = false → trackId must be NULL.
   */
  async validateGradeTrackPair(gradeId: string, trackId?: string | null) {
    const grade = await this.prisma.grade.findUnique({
      where: { id: gradeId },
      include: { tracks: true },
    });
    if (!grade || !grade.isActive) throw new NotFoundException('الصف غير موجود أو غير مفعّل.');

    if (!grade.hasTracks) {
      if (trackId) throw new BadRequestException('هذا الصف لا يقبل الشُعب — احذف الشعبة المحددة.');
      return grade;
    }

    if (!trackId) {
      throw new BadRequestException('هذا الصف يتطلب اختيار شعبة إلزامية.');
    }
    const track = await this.prisma.track.findUnique({ where: { id: trackId } });
    if (!track || !track.isActive) throw new NotFoundException('الشعبة غير موجودة أو غير مفعّلة.');
    if (track.gradeId !== gradeId) {
      throw new BadRequestException('هذه الشعبة لا تنتمي إلى هذا الصف.');
    }
    return grade;
  }

  private async assertCourseManageable(courseId: string, user: AuthenticatedUser) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, isDeleted: true, teacher: { select: { userId: true } } },
    });
    if (!course || course.isDeleted) throw new NotFoundException('الكورس غير موجود.');

    const isAdmin = user.role === 'ADMIN';
    if (!isAdmin && user.role !== 'TEACHER') {
      throw new ForbiddenException('غير مصرح لك بتعديل استهداف هذا الكورس.');
    }
    if (!isAdmin && course.teacher.userId !== user.id) {
      throw new ForbiddenException('لا تملك صلاحية تعديل استهداف كورس مدرس آخر.');
    }
    return course;
  }

  // ─── Course targets ────────────────────────────────────────────────

  getCourseTargets(courseId: string) {
    return this.prisma.courseTarget.findMany({
      where: { courseId },
      include: {
        grade: { include: { stage: { include: { educationSystem: true } } } },
        track: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Replace-all semantics in one transaction with full server-side re-validation. */
  async setCourseTargets(courseId: string, targets: TargetInput[], user: AuthenticatedUser) {
    await this.assertCourseManageable(courseId, user);

    // Validate + dedupe client payload (rule §5.2 #4)
    const seen = new Set<string>();
    for (const t of targets ?? []) {
      if (!t?.gradeId) throw new BadRequestException('كل استهداف يجب أن يحدد الصف الدراسي.');
      await this.validateGradeTrackPair(t.gradeId, t.trackId ?? null);
      const key = `${t.gradeId}:${t.trackId ?? ''}`;
      if (seen.has(key)) throw new ConflictException('لا يمكن تكرار نفس الصف/الشعبة في الاستهداف.');
      seen.add(key);
    }
    if (seen.size === 0) throw new BadRequestException('يجب تحديد استهداف واحد على الأقل للكورس.');

    await this.prisma.$transaction(async (tx) => {
      await tx.courseTarget.deleteMany({ where: { courseId } });
      for (const t of targets) {
        await tx.courseTarget.create({
          data: { courseId, gradeId: t.gradeId, trackId: t.trackId ?? null },
        });
      }
      await tx.course.update({ where: { id: courseId }, data: { needsReview: false } });
    });

    return this.getCourseTargets(courseId);
  }

  async addCourseTarget(courseId: string, target: TargetInput, user: AuthenticatedUser) {
    await this.assertCourseManageable(courseId, user);
    if (!target?.gradeId) throw new BadRequestException('يجب تحديد الصف الدراسي.');
    await this.validateGradeTrackPair(target.gradeId, target.trackId ?? null);

    const exists = await this.prisma.courseTarget.findFirst({
      where: { courseId, gradeId: target.gradeId, trackId: target.trackId ?? null },
    });
    if (exists) throw new ConflictException('هذا الاستهداف مضاف بالفعل لهذا الكورس.');

    return this.prisma.courseTarget.create({
      data: { courseId, gradeId: target.gradeId, trackId: target.trackId ?? null },
      include: { grade: true, track: true },
    });
  }

  async updateCourseTarget(
    courseId: string,
    targetId: string,
    dto: { gradeId?: string; trackId?: string | null },
    user: AuthenticatedUser,
  ) {
    await this.assertCourseManageable(courseId, user);
    const target = await this.prisma.courseTarget.findUnique({ where: { id: targetId } });
    if (!target || target.courseId !== courseId) throw new NotFoundException('الاستهداف غير موجود.');

    const gradeId = dto?.gradeId ?? target.gradeId;
    const trackId = dto?.trackId !== undefined ? dto.trackId ?? null : target.trackId;
    await this.validateGradeTrackPair(gradeId, trackId);

    if (gradeId === target.gradeId && trackId === target.trackId) {
      return this.prisma.courseTarget.findUnique({
        where: { id: targetId },
        include: { grade: true, track: true },
      });
    }

    const exists = await this.prisma.courseTarget.findFirst({
      where: { courseId, gradeId, trackId },
    });
    if (exists && exists.id !== targetId) {
      throw new ConflictException('هذا الاستهداف مضاف بالفعل لهذا الكورس.');
    }

    return this.prisma.courseTarget.update({
      where: { id: targetId },
      data: { gradeId, trackId },
      include: { grade: true, track: true },
    });
  }

  async removeCourseTarget(courseId: string, targetId: string, user: AuthenticatedUser) {
    await this.assertCourseManageable(courseId, user);
    const target = await this.prisma.courseTarget.findUnique({ where: { id: targetId } });
    if (!target || target.courseId !== courseId) throw new NotFoundException('الاستهداف غير موجود.');
    await this.prisma.courseTarget.delete({ where: { id: targetId } });
    return { message: 'تم حذف الاستهداف.' };
  }

  // ─── Student education profile ─────────────────────────────────────

  async getMyEducationProfile(user: AuthenticatedUser) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!student) throw new ForbiddenException('ملف الطالب غير موجود.');
    return this.prisma.studentEducationProfile.findUnique({
      where: { studentId: student.id },
      include: {
        system: true,
        stage: true,
        grade: true,
        track: true,
      },
    });
  }

  async setMyEducationProfile(
    user: AuthenticatedUser,
    input: { educationSystemId: string; stageId: string; gradeId: string; trackId?: string | null },
  ) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!student) throw new ForbiddenException('ملف الطالب غير موجود.');

    // Ownership chain validation: stage ∈ system, grade ∈ stage, track ∈ grade
    const system = await this.prisma.educationSystem.findUnique({ where: { id: input.educationSystemId } });
    if (!system || !system.isActive) throw new NotFoundException('النظام التعليمي غير موجود.');
    const stage = await this.prisma.educationalStage.findUnique({ where: { id: input.stageId } });
    if (!stage || stage.educationSystemId !== input.educationSystemId) {
      throw new BadRequestException('المرحلة لا تنتمي إلى النظام التعليمي المحدد.');
    }
    const gradeRow = await this.prisma.grade.findUnique({ where: { id: input.gradeId }, include: { tracks: true } });
    if (!gradeRow || gradeRow.stageId !== input.stageId) {
      throw new BadRequestException('الصف لا ينتمي إلى المرحلة المحددة.');
    }
    let trackId: string | null = input.trackId ?? null;
    if (!gradeRow.hasTracks) {
      trackId = null;
    } else if (!trackId) {
      throw new BadRequestException('هذا الصف يتطلب اختيار شعبة إلزامية.');
    } else {
      const track = gradeRow.tracks.find((t) => t.id === trackId);
      if (!track) throw new BadRequestException('هذه الشعبة لا تنتمي إلى هذا الصف.');
    }

    const data = {
      educationSystemId: system.id,
      stageId: stage.id,
      gradeId: gradeRow.id,
      trackId,
    };

    const existing = await this.prisma.studentEducationProfile.findUnique({
      where: { studentId: student.id },
    });
    if (existing) {
      return this.prisma.studentEducationProfile.update({
        where: { studentId: student.id },
        data,
        include: { system: true, stage: true, grade: true, track: true },
      });
    }
    return this.prisma.studentEducationProfile.create({
      data: { studentId: student.id, ...data },
      include: { system: true, stage: true, grade: true, track: true },
    });
  }

  /**
   * §8.4 — Server-derived "Courses for You". NEVER trusts client-supplied
   * grade/track; always resolves from the authenticated student's profile.
   */
  async myCourses(user: AuthenticatedUser) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!student) throw new ForbiddenException('ملف الطالب غير موجود.');

    const profile = await this.prisma.studentEducationProfile.findUnique({
      where: { studentId: student.id },
      include: { system: true, stage: true, grade: true, track: true },
    });

    if (!profile) {
      // No profile yet → fall back to legacy enum matching so nothing breaks
      const studentRow = await this.prisma.studentProfile.findUniqueOrThrow({
        where: { id: student.id },
        select: { gradeLevel: true },
      });
      const courses = await this.prisma.course.findMany({
        where: {
          status: 'PUBLISHED',
          isDeleted: false,
          OR: [
            { gradeLevels: { has: studentRow.gradeLevel } },
            { gradeLevel: studentRow.gradeLevel },
          ],
        },
        include: COURSE_CARD_INCLUDE,
        orderBy: { createdAt: 'desc' },
      });
      return { personalized: false, profile: null, courses };
    }

    const courses = await this.prisma.course.findMany({
      where: {
        status: 'PUBLISHED',
        isDeleted: false,
        targets: {
          some: {
            gradeId: profile.gradeId,
            OR: [{ trackId: profile.trackId }, { trackId: null }],
          },
        },
      },
      include: COURSE_CARD_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return { personalized: true, profile, courses };
  }
}

/** Display-ready include reused everywhere a course card/detail renders. */
export const COURSE_CARD_INCLUDE = {
  subjectRef: { select: { id: true, code: true, name: true } },
  targets: {
    include: {
      grade: { select: { id: true, code: true, name: true } },
      track: { select: { id: true, code: true, name: true } },
    },
  },
} as const;
