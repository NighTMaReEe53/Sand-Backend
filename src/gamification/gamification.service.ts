import { Injectable, Logger } from '@nestjs/common';
import { BadgeCode } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

export const BADGE_DEFINITIONS: {
  code: BadgeCode;
  title: string;
  description: string;
  icon: string;
}[] = [
  { code: 'FIRST_COURSE_ENROLLED', title: 'بداية الرحلة', description: 'الاشتراك في أول كورس', icon: 'rocket' },
  { code: 'FIRST_EXAM_COMPLETED', title: 'الخطوة الأولى', description: 'إكمال أول امتحان', icon: 'target' },
  { code: 'STREAK_7_DAYS', title: 'أسبوع متواصل', description: 'نشاط يومي لمدة 7 أيام', icon: 'flame' },
  { code: 'EXAM_SCORE_90', title: 'التفوق', description: 'الحصول على 90% أو أكثر في امتحان', icon: 'trophy' },
  { code: 'COURSE_COMPLETED', title: 'الإنجاز الكامل', description: 'إكمال جميع دروس كورس', icon: 'medal' },
];

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record daily activity for a student and update their streak.
   * Call this from any learning activity (lesson watched, exam submitted, etc.)
   */
  async recordActivity(studentId: string) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const streak = await this.prisma.studentStreak.upsert({
        where: { studentId },
        create: { studentId, currentStreak: 1, longestStreak: 1, lastActiveDate: today },
        update: {},
      });

      // Already counted today
      if (streak.lastActiveDate.getTime() === today.getTime()) return;

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const isConsecutive = streak.lastActiveDate.getTime() === yesterday.getTime();
      const currentStreak = isConsecutive ? streak.currentStreak + 1 : 1;
      const longestStreak = Math.max(streak.longestStreak, currentStreak);

      await this.prisma.studentStreak.update({
        where: { studentId },
        data: { currentStreak, longestStreak, lastActiveDate: today },
      });

      if (longestStreak >= 7) {
        await this.awardBadge(studentId, 'STREAK_7_DAYS');
      }
    } catch (error) {
      // Gamification must never break the main flow
      this.logger.error(`recordActivity failed: ${error}`);
    }
  }

  /** Award a badge if not already owned (idempotent). */
  async awardBadge(studentId: string, badgeCode: BadgeCode) {
    try {
      await this.prisma.studentBadge.upsert({
        where: { studentId_badgeCode: { studentId, badgeCode } },
        create: { studentId, badgeCode },
        update: {},
      });
    } catch (error) {
      this.logger.error(`awardBadge(${badgeCode}) failed: ${error}`);
    }
  }

  async getStudentGamification(userId: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!student) return null;

    const [streak, badges] = await Promise.all([
      this.prisma.studentStreak.findUnique({ where: { studentId: student.id } }),
      this.prisma.studentBadge.findMany({
        where: { studentId: student.id },
        orderBy: { awardedAt: 'desc' },
      }),
    ]);

    const earnedCodes = new Set(badges.map((b) => b.badgeCode));

    return {
      streak: {
        currentStreak: streak?.currentStreak ?? 0,
        longestStreak: streak?.longestStreak ?? 0,
        lastActiveDate: streak?.lastActiveDate ?? null,
      },
      badges: BADGE_DEFINITIONS.map((def) => ({
        ...def,
        earned: earnedCodes.has(def.code),
        awardedAt: badges.find((b) => b.badgeCode === def.code)?.awardedAt ?? null,
      })),
      earnedCount: badges.length,
      totalCount: BADGE_DEFINITIONS.length,
    };
  }
}
