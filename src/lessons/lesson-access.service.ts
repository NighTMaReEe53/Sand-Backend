import { Injectable } from '@nestjs/common';
import {
  EnrollmentStatus,
  QuizAttemptStatus,
} from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import {
  LESSON_LOCK_MESSAGES,
  LessonState,
} from '../common/constants/lesson-completion.constants';

/**
 * Phase 1 — Sequential lesson unlocking.
 *
 * Single source of truth for per-student lesson states inside a course:
 *   Lesson N+1 is LOCKED until Lesson N is completed (≥ threshold watched)
 *   AND its published quiz is passed
 *   AND its published homework is submitted.
 *
 * Purely derived from existing data (Progress + QuizAttempt + HomeworkAttempt).
 */
@Injectable()
export class LessonAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Whether the lesson's published quiz has been passed by the student. */
  async isLessonQuizCompleted(studentId: string, lessonId: string): Promise<boolean> {
    const quiz = await this.prisma.quiz.findFirst({
      where: { lessonId, isPublished: true, isDeleted: false },
      select: { id: true },
    });
    // No published quiz on the lesson → nothing to gate on
    if (!quiz) return true;

    const passedAttempt = await this.prisma.quizAttempt.findFirst({
      where: {
        quizId: quiz.id,
        studentId,
        status: QuizAttemptStatus.SUBMITTED,
        isPassed: true,
      },
      select: { id: true },
    });
    return Boolean(passedAttempt);
  }

  /** Whether the lesson's published homework has been submitted by the student. */
  async isLessonHomeworkCompleted(studentId: string, lessonId: string): Promise<boolean> {
    const homework = await this.prisma.homework.findFirst({
      where: { lessonId, isPublished: true, isDeleted: false },
      select: { id: true },
    });
    if (!homework) return true;

    const submitted = await this.prisma.homeworkAttempt.findFirst({
      where: {
        homeworkId: homework.id,
        studentId,
        status: QuizAttemptStatus.SUBMITTED,
      },
      select: { id: true },
    });
    return Boolean(submitted);
  }

  /**
   * Compute states for every lesson in a course (ordered by orderIndex).
   * Efficient: 3 queries total regardless of course size.
   */
  async getCourseLessonStates(
    courseId: string,
    studentId: string,
  ): Promise<Map<string, LessonState>> {
    const [lessons, progresses, quizzes, homeworks] = await Promise.all([
      this.prisma.lesson.findMany({
        where: { courseId, isDeleted: false },
        orderBy: { orderIndex: 'asc' },
        select: { id: true },
      }),
      this.prisma.progress.findMany({
        where: { studentId, lesson: { courseId, isDeleted: false } },
        select: {
          lessonId: true,
          watchedPercentage: true,
          isCompleted: true,
          lastWatchedAt: true,
        },
      }),
      this.prisma.quiz.findMany({
        where: {
          lesson: { courseId, isDeleted: false },
          isPublished: true,
          isDeleted: false,
        },
        select: { id: true, lessonId: true },
      }),
      this.prisma.homework.findMany({
        where: {
          lesson: { courseId, isDeleted: false },
          isPublished: true,
          isDeleted: false,
        },
        select: { id: true, lessonId: true },
      }),
    ]);

    const progressMap = new Map(progresses.map((p) => [p.lessonId, p]));

    const quizIds = quizzes.map((q) => q.id);
    const passedAttempts = quizIds.length
      ? await this.prisma.quizAttempt.findMany({
          where: {
            quizId: { in: quizIds },
            studentId,
            status: QuizAttemptStatus.SUBMITTED,
            isPassed: true,
          },
          select: { quizId: true },
        })
      : [];
    const passedQuizIds = new Set(passedAttempts.map((a) => a.quizId));

    const homeworkIds = homeworks.map((h) => h.id);
    const submittedHomeworks = homeworkIds.length
      ? await this.prisma.homeworkAttempt.findMany({
          where: {
            homeworkId: { in: homeworkIds },
            studentId,
            status: QuizAttemptStatus.SUBMITTED,
          },
          select: { homeworkId: true },
        })
      : [];
    const submittedHomeworkIds = new Set(submittedHomeworks.map((a) => a.homeworkId));

    // Lessons with no published quiz are never gated
    const quizCompletedByLesson = new Map<string, boolean>();
    for (const lesson of lessons) quizCompletedByLesson.set(lesson.id, true);
    for (const quiz of quizzes) {
      quizCompletedByLesson.set(quiz.lessonId, passedQuizIds.has(quiz.id));
    }

    // Lessons with no published homework are never gated —
    // submitting (حل الواجب) is enough, no passing score required
    const homeworkCompletedByLesson = new Map<string, boolean>();
    for (const lesson of lessons) homeworkCompletedByLesson.set(lesson.id, true);
    for (const homework of homeworks) {
      homeworkCompletedByLesson.set(homework.lessonId, submittedHomeworkIds.has(homework.id));
    }

    const states = new Map<string, LessonState>();
    let prevCompleted = true; // first lesson is always unlocked
    let prevQuizCompleted = true;
    let prevHomeworkCompleted = true;

    for (const lesson of lessons) {
      const progress = progressMap.get(lesson.id);
      const quizCompleted = quizCompletedByLesson.get(lesson.id) ?? true;
      const homeworkCompleted = homeworkCompletedByLesson.get(lesson.id) ?? true;
      let status: LessonState['status'];
      let lockReasonCode: LessonState['lockReasonCode'] = null;
      let lockMessage: string | null = null;

      if (!prevCompleted || !prevQuizCompleted || !prevHomeworkCompleted) {
        status = 'LOCKED';
        lockReasonCode = !prevCompleted
          ? 'PREVIOUS_LESSON_NOT_COMPLETED'
          : !prevQuizCompleted
          ? 'PREVIOUS_QUIZ_NOT_COMPLETED'
          : 'PREVIOUS_HOMEWORK_NOT_COMPLETED';
        lockMessage = LESSON_LOCK_MESSAGES[lockReasonCode];
      } else if (progress?.isCompleted) {
        status = 'COMPLETED';
      } else if ((progress?.watchedPercentage ?? 0) > 0 || progress?.lastWatchedAt) {
        status = 'IN_PROGRESS';
      } else {
        status = 'AVAILABLE';
      }

      states.set(lesson.id, {
        status,
        lockReasonCode,
        lockMessage,
        quizCompleted,
        homeworkCompleted,
      });

      prevCompleted = Boolean(progress?.isCompleted);
      prevQuizCompleted = quizCompleted;
      prevHomeworkCompleted = homeworkCompleted;
    }

    return states;
  }
}
