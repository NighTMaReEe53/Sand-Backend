import { Injectable, Logger } from '@nestjs/common';
import { ExamAttemptStatus, ExamMedal } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { GamificationService } from '../gamification/gamification.service';

const MEDAL_BY_RANK: Record<number, ExamMedal> = {
  1: 'GOLD',
  2: 'SILVER',
  3: 'BRONZE',
};

export const LEADERBOARD_SIZE = 10;

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gamificationService: GamificationService,
  ) {}

  /**
   * Phase 3 — recompute the Top-10 achievements for one exam.
   * Deterministic ranking (server-side only):
   *   score DESC → timeTaken ASC → submittedAt ASC
   * Best attempt per student wins. Idempotent full refresh per exam.
   */
  async recomputeExamAchievements(examId: string): Promise<void> {
    try {
      const exam = await this.prisma.exam.findUnique({
        where: { id: examId },
        select: { totalMarks: true },
      });
      if (!exam) return;

      const attempts = await this.prisma.examAttempt.findMany({
        where: {
          examId,
          status: ExamAttemptStatus.SUBMITTED,
          submittedAt: { not: null },
          isEligibleForLeaderboard: true,
        },
        select: {
          studentId: true,
          score: true,
          startedAt: true,
          submittedAt: true,
          questionSnapshots: true,
        },
      });
      if (attempts.length === 0) return;

      // Best attempt per student
      const bestByStudent = new Map<
        string,
        { score: number; timeTakenSeconds: number; submittedAt: Date; totalMarks: number }
      >();
       for (const a of attempts) {
         if (!a.startedAt || !a.submittedAt) continue;
         const timeTakenSeconds = Math.max(
           1,
           Math.round(((a.submittedAt as Date).getTime() - a.startedAt.getTime()) / 1000),
         );
         // Real total for THIS attempt: bank exams serve a subset and some exams'
         // configured totalMarks doesn't match the served question marks.
         const snaps = Array.isArray(a.questionSnapshots)
           ? (a.questionSnapshots as { marks?: number }[])
           : [];
         const attemptTotal =
           snaps.length > 0
             ? snaps.reduce((sum, s) => sum + (s.marks ?? 0), 0)
             : (exam.totalMarks ?? 0);
         const candidate = {
           score: a.score ?? 0,
           timeTakenSeconds,
           submittedAt: a.submittedAt as Date,
           totalMarks: attemptTotal,
         };
        const current = bestByStudent.get(a.studentId);
        if (
          !current ||
          candidate.score > current.score ||
          (candidate.score === current.score &&
            candidate.timeTakenSeconds < current.timeTakenSeconds) ||
          (candidate.score === current.score &&
            candidate.timeTakenSeconds === current.timeTakenSeconds &&
            candidate.submittedAt < current.submittedAt)
        ) {
          bestByStudent.set(a.studentId, candidate);
        }
      }

      const ranked = [...bestByStudent.entries()]
        .sort(
          (a, b) =>
            b[1].score - a[1].score ||
            a[1].timeTakenSeconds - b[1].timeTakenSeconds ||
            a[1].submittedAt.getTime() - b[1].submittedAt.getTime(),
        )
        .slice(0, LEADERBOARD_SIZE);

      await this.prisma.$transaction([
        this.prisma.examAchievement.deleteMany({ where: { examId } }),
        ...ranked.map(([studentId, best], index) => {
          const rank = index + 1;
          const percentage =
            best.totalMarks > 0
              ? Math.min(100, Math.round((best.score / best.totalMarks) * 100))
              : 0;
          return this.prisma.examAchievement.create({
            data: {
              studentId,
              examId,
              rank,
              medal: MEDAL_BY_RANK[rank] ?? null,
              score: best.score,
              percentage,
              timeTakenSeconds: best.timeTakenSeconds,
              submittedAt: best.submittedAt,
            },
          });
        }),
      ]);

      // Notify medalists once per recomputation (idempotent-ish: only on rank 1-3 rows)
      for (const [studentId] of ranked.slice(0, 3)) {
        const userId = await this.prisma.studentProfile.findUnique({
          where: { id: studentId },
          select: { userId: true },
        });
        if (!userId) continue;
        const achievement = await this.prisma.examAchievement.findUnique({
          where: { studentId_examId: { studentId, examId } },
          select: { medal: true, rank: true },
        });
        if (achievement?.medal) {
          await this.gamificationService.awardBadge(studentId, 'EXAM_SCORE_90').catch(() => undefined);
          await this.prisma.notification
            .create({
              data: {
                userId: userId.userId,
                type: 'ACHIEVEMENT_EARNED',
                title:
                  achievement.medal === 'GOLD'
                    ? '🥇 المركز الأول!'
                    : achievement.medal === 'SILVER'
                      ? '🥈 المركز الثاني!'
                      : '🥉 المركز الثالث!',
                body: `حصلت على مركز ${achievement.rank} في لوحة أبطال الامتحان.`,
                linkUrl: `/exams/${examId}/leaderboard`,
              },
            })
            .catch(() => undefined);
        }
      }
    } catch (error) {
      // Achievements must never break the submit flow
      this.logger.error(`recomputeExamAchievements(${examId}) failed: ${error}`);
    }
  }

  /** Student-facing Top-N leaderboard for ONE exam (never global). */
  async getExamLeaderboard(examId: string, limit = LEADERBOARD_SIZE, viewerUserId?: string) {
    const take = Math.min(Math.max(limit, 1), LEADERBOARD_SIZE);

    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, isDeleted: false },
      select: { id: true, title: true, totalMarks: true },
    });
    if (!exam) return null;

    const top = await this.prisma.examAchievement.findMany({
      where: { examId },
      orderBy: { rank: 'asc' },
      take,
      include: { student: { select: { id: true, fullName: true, photoUrl: true } } },
    });

    // Self-healing: if no achievements exist yet (e.g. recompute previously
    // failed on a malformed attempt), rebuild them from submitted attempts so
    // the ranking appears without requiring a new submission.
    if (top.length === 0) {
      await this.recomputeExamAchievements(examId).catch(() => undefined);
      const rebuilt = await this.prisma.examAchievement.findMany({
        where: { examId },
        orderBy: { rank: 'asc' },
        take,
        include: { student: { select: { id: true, fullName: true, photoUrl: true } } },
      });
      if (rebuilt.length > 0) return this.getExamLeaderboard(examId, limit, viewerUserId);
    }

    let viewer: {
      rank: number | null;
      medal: string | null;
      score: number;
      percentage: number;
      correctCount?: number;
      totalQuestions?: number;
      wrongCount?: number;
      unansweredCount?: number;
      exitCount?: number;
      isEligible?: boolean;
      disqualifiedReason?: string;
    } | null = null;

    // Recompute the percentage denominator from each student's actual attempt
    // (bank exams serve a subset; exam.totalMarks can mismatch the served marks)
    // so the displayed percentage is always correct, even for old attempts.
    const leaderboard = await Promise.all(
      top.map(async (a) => {
        const stats = await this.getBestAttemptStats(a.student.id, examId);
        const percentage =
          stats.totalMarks > 0
            ? Math.min(100, Math.round((a.score / stats.totalMarks) * 100))
            : a.percentage;
        return {
          rank: a.rank,
          medal: a.medal,
          studentId: a.student.id,
          studentName: a.student.fullName,
          photoUrl: a.student.photoUrl,
          score: a.score,
          percentage,
          timeTakenSeconds: a.timeTakenSeconds,
          submittedAt: a.submittedAt,
          correctCount: stats.correctCount,
          totalQuestions: stats.totalQuestions,
          wrongCount: Math.max(0, stats.answeredCount - stats.correctCount),
          unansweredCount: Math.max(0, stats.totalQuestions - stats.answeredCount),
          exitCount: stats.exitCount,
        };
      }),
    );

    if (viewerUserId) {
      const viewerStudent = await this.prisma.studentProfile.findUnique({
        where: { userId: viewerUserId },
        select: { id: true },
      });
      if (viewerStudent) {
        const stats = await this.getBestAttemptStats(viewerStudent.id, examId);
        if (stats.hasAttempt) {
          const own = await this.prisma.examAchievement.findUnique({
            where: { studentId_examId: { studentId: viewerStudent.id, examId } },
          });
          const percentage =
            stats.totalMarks > 0
              ? Math.min(100, Math.round((stats.score / stats.totalMarks) * 100))
              : 0;
          const isDisqualified = stats.exitCount > 2 || !stats.isEligibleForLeaderboard;

          if (isDisqualified) {
            viewer = {
              rank: null,
              medal: null,
              score: stats.score,
              percentage,
              correctCount: stats.correctCount,
              totalQuestions: stats.totalQuestions,
              wrongCount: Math.max(0, stats.answeredCount - stats.correctCount),
              unansweredCount: Math.max(0, stats.totalQuestions - stats.answeredCount),
              exitCount: stats.exitCount,
              isEligible: false,
              disqualifiedReason:
                stats.exitCount > 2
                  ? `تم استبعادك من لوحة الشرف بسبب الخروج من الامتحان ${stats.exitCount} مرات (الحد الأقصى المسموح: مرتان)`
                  : 'غير مؤهل للوحة الشرف وفقاً لضوابط الامتحان',
            };
          } else if (own) {
            viewer = {
              rank: own.rank,
              medal: own.medal,
              score: own.score,
              percentage: percentage || own.percentage,
              correctCount: stats.correctCount,
              totalQuestions: stats.totalQuestions,
              wrongCount: Math.max(0, stats.answeredCount - stats.correctCount),
              unansweredCount: Math.max(0, stats.totalQuestions - stats.answeredCount),
              exitCount: stats.exitCount,
              isEligible: true,
            };
          } else {
            const privateRank = await this.getPrivateAttemptRank(examId, viewerStudent.id).catch(
              () => null,
            );
            viewer = {
              rank: privateRank,
              medal: null,
              score: stats.score,
              percentage,
              correctCount: stats.correctCount,
              totalQuestions: stats.totalQuestions,
              wrongCount: Math.max(0, stats.answeredCount - stats.correctCount),
              unansweredCount: Math.max(0, stats.totalQuestions - stats.answeredCount),
              exitCount: stats.exitCount,
              isEligible: true,
            };
          }
        }
      }
    }

    return {
      exam: { id: exam.id, title: exam.title, totalMarks: exam.totalMarks },
      leaderboard,
      viewer,
    };
  }

  /** Per-student best submitted attempt stats for an exam: real total marks,
   *  number of correctly answered questions, total question count, exit count, etc. */
  private async getBestAttemptStats(
    studentId: string,
    examId: string,
  ): Promise<{
    hasAttempt: boolean;
    totalMarks: number;
    score: number;
    correctCount: number;
    answeredCount: number;
    totalQuestions: number;
    exitCount: number;
    isEligibleForLeaderboard: boolean;
  }> {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: {
        examId,
        studentId,
        status: ExamAttemptStatus.SUBMITTED,
        submittedAt: { not: null },
      },
      orderBy: { score: 'desc' },
      select: {
        score: true,
        exitCount: true,
        isEligibleForLeaderboard: true,
        questionSnapshots: true,
        answers: {
          select: { id: true, isCorrect: true, selectedOptionIndex: true },
        },
      },
    });
    if (!attempt) {
      return {
        hasAttempt: false,
        totalMarks: 0,
        score: 0,
        correctCount: 0,
        answeredCount: 0,
        totalQuestions: 0,
        exitCount: 0,
        isEligibleForLeaderboard: true,
      };
    }
    const snaps = Array.isArray(attempt.questionSnapshots)
      ? (attempt.questionSnapshots as { marks?: number }[])
      : [];
    const correctCount = attempt.answers.filter((a) => a.isCorrect).length;
    const answeredCount = attempt.answers.filter(
      (a) => a.selectedOptionIndex !== null && a.selectedOptionIndex !== undefined,
    ).length;

    return {
      hasAttempt: true,
      totalMarks: snaps.length > 0 ? snaps.reduce((sum, s) => sum + (s.marks ?? 0), 0) : 0,
      score: attempt.score ?? 0,
      correctCount,
      answeredCount,
      totalQuestions: snaps.length,
      exitCount: attempt.exitCount ?? 0,
      isEligibleForLeaderboard: attempt.isEligibleForLeaderboard ?? true,
    };
  }

  /** "My Achievements" — medal counts scoped to (student, exam). */
  async getMyAchievements(userId: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!student) return null;

    const achievements = await this.prisma.examAchievement.findMany({
      where: { studentId: student.id },
      orderBy: { createdAt: 'desc' },
      include: {
        exam: { select: { id: true, title: true, course: { select: { title: true } } } },
      },
    });

    const count = (medal: ExamMedal) =>
      achievements.filter((a) => a.medal === medal).length;

    return {
      totals: {
        gold: count('GOLD'),
        silver: count('SILVER'),
        bronze: count('BRONZE'),
        topTenCount: achievements.length,
      },
      achievements: achievements.map((a) => ({
        examId: a.exam.id,
        examTitle: a.exam.title,
        courseTitle: a.exam.course.title,
        rank: a.rank,
        medal: a.medal,
        score: a.score,
        percentage: a.percentage,
        timeTakenSeconds: a.timeTakenSeconds,
        submittedAt: a.submittedAt,
      })),
    };
  }

  /** Private rank uses the public tie-breaks but includes every valid result. */
  async getPrivateAttemptRank(examId: string, studentId: string): Promise<number | null> {
    const attempts = await this.prisma.examAttempt.findMany({
      where: {
        examId,
        status: ExamAttemptStatus.SUBMITTED,
        submittedAt: { not: null },
      },
      select: { studentId: true, score: true, startedAt: true, submittedAt: true },
    });
    const bestByStudent = new Map<string, { score: number; timeTakenSeconds: number; submittedAt: Date }>();
    for (const attempt of attempts) {
      if (!attempt.startedAt || !attempt.submittedAt) continue;
      const candidate = {
        score: attempt.score ?? 0,
        timeTakenSeconds: Math.max(1, Math.round(((attempt.submittedAt as Date).getTime() - attempt.startedAt.getTime()) / 1000)),
        submittedAt: attempt.submittedAt as Date,
      };
      const current = bestByStudent.get(attempt.studentId);
      if (!current || candidate.score > current.score ||
          (candidate.score === current.score && candidate.timeTakenSeconds < current.timeTakenSeconds) ||
          (candidate.score === current.score && candidate.timeTakenSeconds === current.timeTakenSeconds && candidate.submittedAt < current.submittedAt)) {
        bestByStudent.set(attempt.studentId, candidate);
      }
    }
    const rank = [...bestByStudent.entries()]
      .sort((a, b) => b[1].score - a[1].score || a[1].timeTakenSeconds - b[1].timeTakenSeconds || a[1].submittedAt.getTime() - b[1].submittedAt.getTime())
      .findIndex(([id]) => id === studentId);
    return rank >= 0 ? rank + 1 : null;
  }
}
