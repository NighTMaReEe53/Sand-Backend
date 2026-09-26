import { Injectable, NotFoundException } from '@nestjs/common';
import { ReactionTargetType, ReactionType, Role } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ReactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async react(userId: string, targetType: ReactionTargetType, targetId: string, type: ReactionType) {
    const reaction = await this.prisma.reaction.upsert({
      where: {
        userId_targetType_targetId: { userId, targetType, targetId },
      },
      update: { type },
      create: { userId, targetType, targetId, type },
    });

    // Send notification in background (non-blocking)
    void this._sendReactionNotification(userId, targetType, targetId, type);

    return reaction;
  }

  private async _sendReactionNotification(
    userId: string,
    targetType: ReactionTargetType,
    targetId: string,
    type: ReactionType,
  ) {
    try {
      const reactor = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          role: true,
          studentProfile: { select: { fullName: true } },
          teacherProfile: { select: { fullName: true } },
        },
      });
      const reactorName = reactor?.studentProfile?.fullName || reactor?.teacherProfile?.fullName || 'مستخدم';
      const isTeacher = reactor?.role === Role.TEACHER || reactor?.role === Role.ADMIN;
      const emojiMap: Record<string, string> = {
        LIKE: '👍',
        LOVE: '❤️',
        HAHA: '😂',
        WOW: '😮',
        SAD: '😢',
        ANGRY: '😡',
      };
      const emoji = emojiMap[type] || '👍';

      if (targetType === ReactionTargetType.QUESTION) {
        const question = await this.prisma.courseQuestion.findUnique({
          where: { id: targetId },
          select: {
            courseId: true,
            student: { select: { userId: true } },
            course: { select: { title: true } },
          },
        });
        if (question && question.student.userId !== userId) {
          await this.notificationsService.notify({
            userId: question.student.userId,
            type: 'NEW_QA_REPLY',
            title: `${emoji} تفاعل جديد على سؤالك`,
            body: `تفاعل ${isTeacher ? `المدرس ${reactorName}` : reactorName} مع سؤالك بـ ${emoji} في كورس "${question.course.title}".`,
            linkUrl: `/courses/${question.courseId}/qa/${targetId}`,
          });
        }
      } else if (targetType === ReactionTargetType.QA_REPLY) {
        const reply = await this.prisma.qAReply.findUnique({
          where: { id: targetId },
          select: {
            authorId: true,
            questionId: true,
            question: { select: { courseId: true, course: { select: { title: true } } } },
          },
        });
        if (reply && reply.authorId !== userId) {
          await this.notificationsService.notify({
            userId: reply.authorId,
            type: 'NEW_QA_REPLY',
            title: `${emoji} تفاعل جديد على تعليقك`,
            body: `تفاعل ${isTeacher ? `المدرس ${reactorName}` : reactorName} بـ ${emoji} مع تعليقك.`,
            linkUrl: `/courses/${reply.question.courseId}/qa/${reply.questionId}`,
          });
        }
      } else if (targetType === ReactionTargetType.SUMMARY) {
        const summary = await this.prisma.summary.findUnique({
          where: { id: targetId },
          select: {
            title: true,
            courseId: true,
            student: { select: { userId: true } },
          },
        });
        if (summary && summary.student.userId !== userId) {
          await this.notificationsService.notify({
            userId: summary.student.userId,
            type: 'NEW_SUMMARY_COMMENT',
            title: `${emoji} تفاعل جديد على ملخصك`,
            body: `تفاعل ${isTeacher ? `المدرس ${reactorName}` : reactorName} بـ ${emoji} مع ملخصك "${summary.title}".`,
            linkUrl: `/courses/${summary.courseId}/summaries/${targetId}`,
          });
        }
      } else if (targetType === ReactionTargetType.SUMMARY_COMMENT) {
        const comment = await this.prisma.summaryComment.findUnique({
          where: { id: targetId },
          include: {
            summary: { select: { courseId: true, title: true } },
          },
        });
        if (comment && comment.authorId !== userId) {
          await this.notificationsService.notify({
            userId: comment.authorId,
            type: 'NEW_SUMMARY_COMMENT',
            title: `${emoji} تفاعل جديد على تعليقك`,
            body: `تفاعل ${isTeacher ? `المدرس ${reactorName}` : reactorName} بـ ${emoji} مع تعليقك.`,
            linkUrl: `/courses/${comment.summary.courseId}/summaries/${comment.summaryId}`,
          });
        }
      }
    } catch {
      // Non-blocking
    }
  }

  async unreact(userId: string, targetType: ReactionTargetType, targetId: string) {
    const reaction = await this.prisma.reaction.findUnique({
      where: { userId_targetType_targetId: { userId, targetType, targetId } },
    });
    if (!reaction) throw new NotFoundException('Reaction not found.');

    await this.prisma.reaction.delete({
      where: { userId_targetType_targetId: { userId, targetType, targetId } },
    });
    return { message: 'Reaction removed.' };
  }

  async getReactionSummary(targetType: ReactionTargetType, targetId: string, currentUserId?: string) {
    const [reactions, recentReactors] = await Promise.all([
      this.prisma.reaction.groupBy({
        by: ['type'],
        where: { targetType, targetId },
        _count: { id: true },
      }),
      this.prisma.reaction.findMany({
        where: { targetType, targetId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          user: {
            select: {
              id: true,
              role: true,
              studentProfile: { select: { fullName: true, photoUrl: true } },
              teacherProfile: { select: { fullName: true, photoUrl: true } },
            },
          },
        },
      }),
    ]);

    const summary: Record<string, number> = {};
    for (const r of reactions) {
      summary[r.type] = r._count.id;
    }

    const reactors = recentReactors.map((r) => ({
      userId: r.userId,
      type: r.type,
      name: r.user.studentProfile?.fullName || r.user.teacherProfile?.fullName || 'مستخدم',
      photo: r.user.studentProfile?.photoUrl || r.user.teacherProfile?.photoUrl || null,
    }));

    let currentUserReaction: ReactionType | null = null;
    if (currentUserId) {
      const existing = await this.prisma.reaction.findUnique({
        where: { userId_targetType_targetId: { userId: currentUserId, targetType, targetId } },
        select: { type: true },
      });
      currentUserReaction = existing?.type ?? null;
    }

    return { summary, currentUserReaction, reactors };
  }
}
