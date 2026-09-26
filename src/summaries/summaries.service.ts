import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EnrollmentStatus, ReactionTargetType, Role, SummaryStatus } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../shared/storage/storage.service';
import * as path from 'path';
import * as crypto from 'crypto';
import { CreateSummaryDto, ModerateSummaryDto, CreateSummaryCommentDto } from './dto/summaries.dto';

interface AuthUser {
  id: string;
  role: Role;
}

@Injectable()
export class SummariesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly storageService: StorageService,
  ) {}

  async uploadCommunityMedia(user: AuthUser, file?: Express.Multer.File) {
    if (!file?.buffer) throw new BadRequestException('Media file is required.');
    const isImage = file.mimetype.startsWith('image/');
    const isVideo = file.mimetype.startsWith('video/');
    if (!isImage && !isVideo) throw new BadRequestException('Only image and video files are allowed.');
    const maxSize = isVideo ? 50 * 1024 * 1024 : 8 * 1024 * 1024;
    if (file.size > maxSize) throw new BadRequestException(`Maximum size is ${isVideo ? '50MB' : '8MB'}.`);
    const ext = path.extname(file.originalname).toLowerCase() || (isImage ? '.jpg' : '.mp4');
    const url = await this.storageService.uploadFile({ originalname: `${crypto.randomUUID()}${ext}`, buffer: file.buffer, mimetype: file.mimetype }, `community/${isImage ? 'images' : 'videos'}`);
    return { url, type: isImage ? 'image' : 'video' };
  }

  private async getStudent(userId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');
    return student;
  }

  private async getTeacher(userId: string) {
    const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId } });
    if (!teacher) throw new ForbiddenException('Teacher profile not found.');
    return teacher;
  }

  private async assertEnrolled(studentId: string, courseId: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, courseId, status: EnrollmentStatus.ACTIVE },
      select: { id: true },
    });
    if (!enrollment) throw new ForbiddenException('You must be actively enrolled in this course.');
  }

  private async assertTeacherOwnsCourse(teacherId: string, courseId: string) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId }, select: { teacherId: true } });
    if (!course) throw new NotFoundException('Course not found.');
    if (course.teacherId !== teacherId) throw new ForbiddenException('You do not teach this course.');
  }

  private async assertCanAccessCourse(user: AuthUser, courseId: string) {
    if (user.role === Role.STUDENT) {
      const student = await this.getStudent(user.id);
      await this.assertEnrolled(student.id, courseId);
    } else if (user.role === Role.TEACHER) {
      const teacher = await this.getTeacher(user.id);
      await this.assertTeacherOwnsCourse(teacher.id, courseId);
    }
  }

  async createSummary(user: AuthUser, dto: CreateSummaryDto) {
    const student = await this.getStudent(user.id);
    await this.assertEnrolled(student.id, dto.courseId);

    const summary = await this.prisma.summary.create({
      data: {
        courseId: dto.courseId,
        studentId: student.id,
        title: dto.title.trim(),
        description: dto.description.trim(),
        videoUrl: dto.videoUrl,
        images: dto.images || [],
      },
    });

    try {
      const course = await this.prisma.course.findUnique({
        where: { id: dto.courseId },
        select: { title: true, teacher: { select: { userId: true } } },
      });
      if (course?.teacher?.userId) {
        await this.notificationsService.notify({
          userId: course.teacher.userId,
          type: 'ANNOUNCEMENT',
          title: 'ملخص جديد من طالب',
          body: `أضاف طالب ملخصاً "${dto.title}" في كورس "${course.title}".`,
          linkUrl: `/courses/${dto.courseId}/summaries/${summary.id}`,
        });
      }
    } catch { /* non-blocking */ }

    return { message: 'Summary submitted for moderation.', summary };
  }

  async listApprovedSummaries(user: AuthUser, courseId?: string, query: { page?: number; limit?: number; sort?: string } = {}) {
    let resolvedCourseId = courseId;
    if (!resolvedCourseId) {
      if (user.role === Role.STUDENT) {
        const student = await this.prisma.studentProfile.findUnique({ where: { userId: user.id } });
        if (student) {
          const enrollment = await this.prisma.enrollment.findFirst({
            where: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
            select: { courseId: true },
            orderBy: { enrolledAt: 'desc' },
          });
          if (enrollment) {
            resolvedCourseId = enrollment.courseId;
          }
        }
      } else if (user.role === Role.TEACHER) {
        const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id } });
        if (teacher) {
          const course = await this.prisma.course.findFirst({
            where: { teacherId: teacher.id, isDeleted: false },
            select: { id: true },
          });
          if (course) {
            resolvedCourseId = course.id;
          }
        }
      }
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 20, 50);

    let orderBy: any = { createdAt: 'desc' };
    if (query.sort === 'mostLiked') orderBy = { createdAt: 'desc' };
    if (query.sort === 'mostCommented') orderBy = { createdAt: 'desc' };

    const where: any = { status: SummaryStatus.APPROVED };
    if (resolvedCourseId) {
      where.courseId = resolvedCourseId;
    }
    if (query.sort === 'mine' && user.role === Role.STUDENT) {
      const student = await this.getStudent(user.id);
      where.studentId = student.id;
    }

    const [summaries, total] = await Promise.all([
      this.prisma.summary.findMany({
        where,
        include: {
          student: { select: { fullName: true, photoUrl: true, gradeLevel: true } },
          _count: { select: { comments: true } },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.summary.count({ where }),
    ]);

    return {
      summaries: summaries.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        videoUrl: s.videoUrl,
        images: s.images,
        studentName: s.student.fullName,
        studentPhoto: s.student.photoUrl,
        studentGradeLevel: s.student.gradeLevel,
        commentsCount: s._count.comments,
        createdAt: s.createdAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async getSummaryDetail(user: AuthUser, summaryId: string) {
    const summary = await this.prisma.summary.findUnique({
      where: { id: summaryId },
      include: {
        student: { select: { fullName: true, photoUrl: true, gradeLevel: true, userId: true } },
        course: { select: { id: true, title: true } },
      },
    });
    if (!summary) throw new NotFoundException('Summary not found.');

    if (summary.status !== SummaryStatus.APPROVED) {
      if (user.role === Role.STUDENT) {
        const student = await this.getStudent(user.id);
        if (summary.studentId !== student.id) throw new ForbiddenException('This summary is not yet approved.');
      }
    }

    const comments = await this.prisma.summaryComment.findMany({
      where: { summaryId, parentId: null },
      include: {
        author: { select: { id: true, role: true, studentProfile: { select: { fullName: true, photoUrl: true } }, teacherProfile: { select: { fullName: true, photoUrl: true } } } },
        children: {
          include: {
            author: { select: { id: true, role: true, studentProfile: { select: { fullName: true, photoUrl: true } }, teacherProfile: { select: { fullName: true, photoUrl: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Collect all comment IDs to load their reactions
    const allCommentIds: string[] = [];
    const collectCommentIds = (list: any[]) => {
      list.forEach((c) => {
        allCommentIds.push(c.id);
        if (c.children?.length) collectCommentIds(c.children);
      });
    };
    collectCommentIds(comments);

    const commentReactions = allCommentIds.length
      ? await this.prisma.reaction.findMany({
          where: {
            targetType: ReactionTargetType.SUMMARY_COMMENT,
            targetId: { in: allCommentIds },
          },
          select: {
            targetId: true,
            type: true,
            userId: true,
          },
        })
      : [];

    const reactionsByCommentId = new Map<string, { summary: Record<string, number>; currentUserReaction: string | null }>();
    allCommentIds.forEach((id) => reactionsByCommentId.set(id, { summary: {}, currentUserReaction: null }));
    commentReactions.forEach((r) => {
      const entry = reactionsByCommentId.get(r.targetId);
      if (entry) {
        entry.summary[r.type] = (entry.summary[r.type] || 0) + 1;
        if (r.userId === user.id) {
          entry.currentUserReaction = r.type;
        }
      }
    });

    const formatComment = (c: any): any => {
      const reactionData = reactionsByCommentId.get(c.id) || { summary: {}, currentUserReaction: null };
      return {
        id: c.id,
        content: c.content,
        authorName: c.author.studentProfile?.fullName || c.author.teacherProfile?.fullName || 'مستخدم',
        authorPhoto: c.author.studentProfile?.photoUrl || c.author.teacherProfile?.photoUrl || c.author.teacherProfile?.imageUrl,
        isTeacher: c.author.role === Role.TEACHER || c.author.role === Role.ADMIN,
        createdAt: c.createdAt,
        reactions: reactionData.summary,
        currentUserReaction: reactionData.currentUserReaction,
        reactionCount: Object.values(reactionData.summary).reduce((a, b) => a + b, 0),
        children: c.children?.map(formatComment) || [],
      };
    };

    return {
      summary: {
        id: summary.id,
        title: summary.title,
        description: summary.description,
        videoUrl: summary.videoUrl,
        images: summary.images,
        status: summary.status,
        rejectionReason: summary.rejectionReason,
        studentName: summary.student.fullName,
        studentPhoto: summary.student.photoUrl,
        studentGradeLevel: summary.student.gradeLevel,
        isOwn: user.role === Role.STUDENT && summary.student.userId === user.id,
        courseTitle: summary.course.title,
        createdAt: summary.createdAt,
        approvedAt: summary.approvedAt,
      },
      comments: comments.map(formatComment),
    };
  }

  async getMySummaries(user: AuthUser, query: { page?: number; limit?: number }) {
    const student = await this.getStudent(user.id);
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 20, 50);

    const where = { studentId: student.id };
    const [summaries, total] = await Promise.all([
      this.prisma.summary.findMany({
        where,
        include: { course: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.summary.count({ where }),
    ]);

    return {
      summaries: summaries.map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        rejectionReason: s.rejectionReason,
        courseName: s.course.title,
        createdAt: s.createdAt,
        approvedAt: s.approvedAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async getModerationQueue(user: AuthUser, query: { courseId?: string; page?: number; limit?: number }) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 20, 50);

    let where: any = { status: SummaryStatus.PENDING };

    if (user.role === Role.ADMIN) {
      if (query.courseId) {
        where.courseId = query.courseId;
      }
    } else {
      const teacher = await this.getTeacher(user.id);
      const courseFilter = query.courseId ? { id: query.courseId } : {};
      const teacherCourses = await this.prisma.course.findMany({
        where: { teacherId: teacher.id, ...courseFilter },
        select: { id: true },
      });
      const courseIds = teacherCourses.map((c) => c.id);
      where.courseId = { in: courseIds };
    }

    const [summaries, total] = await Promise.all([
      this.prisma.summary.findMany({
        where,
        include: {
          student: { select: { fullName: true, photoUrl: true, gradeLevel: true } },
          course: { select: { title: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.summary.count({ where }),
    ]);

    return {
      summaries: summaries.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        videoUrl: s.videoUrl,
        images: s.images,
        studentName: s.student.fullName,
        studentPhoto: s.student.photoUrl,
        studentGradeLevel: s.student.gradeLevel,
        courseName: s.course.title,
        courseId: s.courseId,
        createdAt: s.createdAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async moderateSummary(user: AuthUser, summaryId: string, dto: ModerateSummaryDto) {
    const summary = await this.prisma.summary.findUnique({
      where: { id: summaryId },
      include: { course: { select: { teacherId: true, title: true } } },
    });
    if (!summary) throw new NotFoundException('Summary not found.');

    if (user.role !== Role.ADMIN) {
      const teacher = await this.getTeacher(user.id);
      if (teacher.id !== summary.course.teacherId) throw new ForbiddenException('Access denied.');
    }

    if (dto.approve) {
      await this.prisma.summary.update({
        where: { id: summaryId },
        data: { status: SummaryStatus.APPROVED, approvedAt: new Date(), approvedById: user.id },
      });
      const student = await this.prisma.studentProfile.findUnique({
        where: { id: summary.studentId },
        select: { userId: true },
      });
      if (student?.userId) {
        await this.notificationsService.notify({
          userId: student.userId,
          type: 'SUMMARY_APPROVED',
          title: '🎉 تم اعتماد ملخصك!',
          body: `ملخص "${summary.title}" أصبح الآن متاحاً لزملائك في كورس "${summary.course.title}".`,
          linkUrl: `/courses/${summary.courseId}/summaries/${summaryId}`,
        });
      }
      return { message: 'Summary approved.' };
    } else {
      await this.prisma.summary.update({
        where: { id: summaryId },
        data: { status: SummaryStatus.REJECTED, rejectionReason: dto.rejectionReason || 'تم الرفض بواسطة المعلم' },
      });
      const student = await this.prisma.studentProfile.findUnique({
        where: { id: summary.studentId },
        select: { userId: true },
      });
      if (student?.userId) {
        await this.notificationsService.notify({
          userId: student.userId,
          type: 'SUMMARY_REJECTED',
          title: '⚠️ ملخصك يحتاج تعديلات',
          body: dto.rejectionReason || 'يرجى مراجعة ملخصك وإعادة رفعه.',
          linkUrl: `/courses/${summary.courseId}/summaries`,
        });
      }
      return { message: 'Summary rejected.' };
    }
  }

  async addComment(user: AuthUser, summaryId: string, dto: CreateSummaryCommentDto) {
    const summary = await this.prisma.summary.findUnique({ where: { id: summaryId } });
    if (!summary) throw new NotFoundException('Summary not found.');
    if (summary.status !== SummaryStatus.APPROVED) throw new ForbiddenException('Summary not approved yet.');

    if (user.role === Role.STUDENT) {
      const student = await this.getStudent(user.id);
      await this.assertEnrolled(student.id, summary.courseId);
    }

    if (dto.parentId) {
      const parentComment = await this.prisma.summaryComment.findUnique({ where: { id: dto.parentId } });
      if (!parentComment || parentComment.summaryId !== summaryId) {
        throw new ForbiddenException('Parent comment does not belong to this summary.');
      }
    }

    const comment = await this.prisma.summaryComment.create({
      data: {
        summaryId,
        authorId: user.id,
        content: dto.content.trim(),
        parentId: dto.parentId,
      },
    });

    // Notify summary student and course teacher
    try {
      const summaryDetail = await this.prisma.summary.findUnique({
        where: { id: summaryId },
        include: {
          student: { select: { userId: true } },
          course: { select: { title: true, teacher: { select: { userId: true } } } },
        },
      });
      if (summaryDetail) {
        const summaryLink = `/courses/${summaryDetail.courseId}/summaries/${summaryId}`;
        const isTeacher = user.role === Role.TEACHER || user.role === Role.ADMIN;
        // Notify student owner if someone else commented
        if (summaryDetail.student.userId !== user.id) {
          await this.notificationsService.notify({
            userId: summaryDetail.student.userId,
            type: 'NEW_SUMMARY_COMMENT',
            title: isTeacher ? '🎓 تعليق من المدرس على ملخصك' : '💬 تعليق جديد على ملخصك',
            body: `علق ${isTeacher ? 'المدرس' : 'طالب'} على ملخصك "${summaryDetail.title}".`,
            linkUrl: summaryLink,
          });
        }
        // Notify teacher if student commented and teacher is not the author
        if (!isTeacher && summaryDetail.course?.teacher?.userId && summaryDetail.course.teacher.userId !== user.id) {
          await this.notificationsService.notify({
            userId: summaryDetail.course.teacher.userId,
            type: 'NEW_SUMMARY_COMMENT',
            title: '💬 تعليق جديد على ملخص في كورسك',
            body: `أضاف طالب تعليقاً على ملخص "${summaryDetail.title}".`,
            linkUrl: summaryLink,
          });
        }
      }
    } catch { /* non-blocking */ }

    return { message: 'Comment added successfully.', comment };
  }

  async updateSummary(user: AuthUser, summaryId: string, dto: Partial<CreateSummaryDto>) {
    const teacher = await this.getTeacher(user.id);
    const summary = await this.prisma.summary.findUnique({ where: { id: summaryId }, include: { course: { select: { teacherId: true } } } });
    if (!summary) throw new NotFoundException('Summary not found.');
    if (summary.course.teacherId !== teacher.id) throw new ForbiddenException('Access denied.');
    const updated = await this.prisma.summary.update({
      where: { id: summaryId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
        ...(dto.videoUrl !== undefined ? { videoUrl: dto.videoUrl } : {}),
        ...(dto.images !== undefined ? { images: dto.images } : {}),
      },
    });
    return { message: 'Summary updated successfully.', summary: updated };
  }

  async deleteSummary(user: AuthUser, summaryId: string) {
    const teacher = await this.getTeacher(user.id);
    const summary = await this.prisma.summary.findUnique({ where: { id: summaryId }, include: { course: { select: { teacherId: true } } } });
    if (!summary) throw new NotFoundException('Summary not found.');
    if (summary.course.teacherId !== teacher.id) throw new ForbiddenException('Access denied.');
    await this.prisma.summary.delete({ where: { id: summaryId } });
    return { message: 'Summary deleted successfully.' };
  }

  async getLeaderboard(user: AuthUser, courseId: string | undefined) {
    if (!courseId) {
      if (user.role === Role.STUDENT) {
        const student = await this.getStudent(user.id);
        const enrollment = await this.prisma.enrollment.findFirst({
          where: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
          select: { courseId: true },
          orderBy: { enrolledAt: 'desc' },
        });
        if (!enrollment) {
          return { leaderboard: [] };
        }
        courseId = enrollment.courseId;
      } else if (user.role === Role.TEACHER) {
        const teacher = await this.getTeacher(user.id);
        const course = await this.prisma.course.findFirst({
          where: { teacherId: teacher.id, isDeleted: false },
          select: { id: true },
        });
        if (!course) {
          return { leaderboard: [] };
        }
        courseId = course.id;
      } else {
        const course = await this.prisma.course.findFirst({
          where: { isDeleted: false },
          select: { id: true },
        });
        if (!course) {
          return { leaderboard: [] };
        }
        courseId = course.id;
      }
    }

    const summaries = await this.prisma.summary.findMany({
      where: { courseId, status: SummaryStatus.APPROVED },
      select: {
        id: true,
        title: true,
        student: { select: { id: true, fullName: true, photoUrl: true } },
        _count: { select: { comments: true } },
        createdAt: true,
      },
      take: 50,
    });

    const summaryIds = summaries.map((s) => s.id);
    const reactions = summaryIds.length > 0
      ? await this.prisma.reaction.groupBy({
          by: ['targetId'],
          where: { targetType: ReactionTargetType.SUMMARY, targetId: { in: summaryIds } },
          _count: { _all: true },
        })
      : [];

    const reactionsMap = new Map(reactions.map((r) => [r.targetId, r._count._all]));

    const computed = summaries.map((s) => {
      const likesCount = reactionsMap.get(s.id) || 0;
      const commentsCount = s._count.comments;
      const score = likesCount * 5 + commentsCount * 3 + 10;
      return {
        id: s.id,
        title: s.title,
        studentName: s.student.fullName,
        studentPhoto: s.student.photoUrl,
        commentsCount,
        likesCount,
        score,
        createdAt: s.createdAt,
      };
    });

    // Sort by score descending
    computed.sort((a, b) => b.score - a.score || b.likesCount - a.likesCount);

    return {
      leaderboard: computed.map((entry, index) => ({
        rank: index + 1,
        ...entry,
      })),
    };
  }
}
