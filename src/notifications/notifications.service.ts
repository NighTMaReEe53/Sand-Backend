import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnrollmentStatus, LiveLectureStatus, QuizAttemptStatus } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * title / linkUrl / type map to varchar(191) columns — anything longer
   * makes the INSERT fail and the notification is silently lost. Clamp
   * defensively so an over-long exam/lesson title can never kill a notify.
   */
  private clamp(value: string | null | undefined, max: number): string | null {
    if (value == null) return null;
    const v = String(value);
    return v.length > max ? `${v.slice(0, max - 1)}…` : v;
  }

  /**
   * Create a notification for one user. Safe to fire-and-forget from
   * other services (payments, lessons, exams, progress).
   */
  async notify(input: {
    userId: string;
    type:
      | 'LESSON_NEW'
      | 'COURSE_NEW'
      | 'EXAM_NEW'
      | 'QUIZ_NEW'
      | 'PAYMENT_APPROVED'
      | 'PAYMENT_REJECTED'
      | 'EXAM_RESULT'
      | 'QUIZ_RESULT'
      | 'HOMEWORK_RESULT'
      | 'COURSE_COMPLETED'
      | 'ANNOUNCEMENT'
      | 'ENROLLMENT'
      | 'COMMENT'
      | 'PLANNER_REMINDER'
      | 'LEARNING_REMINDER'
      | 'QUESTION_NEW'
      | 'EXAM_SUBMITTED'
      | 'COURSE_REVIEWED'
      | 'LIVE_LECTURE_NEW'
      | 'LIVE_LECTURE_STARTED'
      | 'LIVE_LECTURE_CANCELLED'
      | 'LIVE_LECTURE_ENDED'
      | 'EXAM_CANCELLED'
      | 'QUIZ_CANCELLED'
      | 'HOMEWORK_NEW'
      | 'MATERIAL_NEW'
      | 'LESSON_REMOVED'
      // Phase 2+ — backlog & gamification & challenges (plan §Phase 5)
      | 'LESSON_OVERDUE'
      | 'BACKLOG_UPDATED'
      | 'BACKLOG_CLEARED'
      | 'CHALLENGE_INVITATION'
      | 'CHALLENGE_ACCEPTED'
      | 'CHALLENGE_REJECTED'
      | 'CHALLENGE_READY'
      | 'CHALLENGE_STARTED'
      | 'CHALLENGE_OPPONENT_FINISHED'
      | 'CHALLENGE_COMPLETED'
      | 'ACHIEVEMENT_EARNED'
      | 'EXAM_LEADERBOARD_RANK'
      | 'HOMEWORK_SUBMITTED'
      | 'NEW_QUESTION'
      | 'NEW_QA_REPLY'
      | 'NEW_SUMMARY_SUBMITTED'
      | 'SUMMARY_APPROVED'
      | 'SUMMARY_REJECTED'
      | 'NEW_SUMMARY_COMMENT';
    title: string;
    body: string;
    linkUrl?: string;
  }) {
    try {
      return await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: this.clamp(input.type, 50)!,
          title: this.clamp(input.title, 180)!,
          body: input.body,
          linkUrl: this.clamp(input.linkUrl ?? null, 180),
        },
      });
    } catch (err) {
      // Notifications must never break the main flow - but must be visible in logs
      this.logger.error(
        `notify failed (type=${input.type}, userId=${input.userId}): ${String(err)}`,
      );
      throw err;
    }
  }

  /** Fire-and-forget broadcast to many users (never throws to callers). */
  async notifyMany(
    userIds: string[],
    input: {
      type:
        | 'LESSON_NEW'
        | 'COURSE_NEW'
        | 'EXAM_NEW'
        | 'QUIZ_NEW'
        | 'ANNOUNCEMENT'
        | 'LIVE_LECTURE_NEW'
        | 'LIVE_LECTURE_STARTED'
        | 'LIVE_LECTURE_CANCELLED'
      | 'LIVE_LECTURE_ENDED'
      | 'EXAM_CANCELLED'
      | 'QUIZ_CANCELLED'
      | 'HOMEWORK_NEW'
      | 'MATERIAL_NEW'
      | 'LESSON_REMOVED';
      title: string;
      body: string;
      linkUrl?: string;
    },
  ) {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;
    try {
      await this.prisma.notification.createMany({
        data: unique.map((userId) => ({
          userId,
          type: this.clamp(input.type, 50)!,
          title: this.clamp(input.title, 180)!,
          body: input.body,
          linkUrl: this.clamp(input.linkUrl ?? null, 180),
        })),
      });
    } catch (err) {
      // Notifications must never break the main flow - but must be visible in logs
      this.logger.error(
        `notifyMany failed (type=${input.type}, users=${unique.length}): ${String(err)}`,
      );
    }
  }

  /**
   * Broadcast to every student whose grade level matches the course's
   * target stages (used for new course / lesson / exam / quiz events).
   */
  async notifyStudentsOfCourseStage(
    courseId: string,
    input: {
      type: 'LESSON_NEW' | 'COURSE_NEW' | 'EXAM_NEW' | 'QUIZ_NEW';
      title: string;
      body: string;
      linkUrl?: string;
    },
  ) {
    try {
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
        select: { gradeLevels: true, gradeLevel: true },
      });
      if (!course) return;

      const levels =
        course.gradeLevels?.length > 0
          ? course.gradeLevels
          : course.gradeLevel
            ? [course.gradeLevel]
            : [];
      if (levels.length === 0) return;

      const students = await this.prisma.studentProfile.findMany({
        where: { gradeLevel: { in: levels } },
        select: { userId: true },
      });
      await this.notifyMany(
        students.map((s) => s.userId),
        input,
      );
    } catch (err) {
      this.logger.error(`notifyStudentsOfCourseStage failed (courseId=${courseId}): ${String(err)}`);
    }
  }

  /**
   * Broadcast to every student ACTIVELY ENROLLED in the course -
   * used for exam events so enrolled students are always reached,
   * regardless of their grade level vs the course's target stages.
   */
  async notifyEnrolledStudents(
    courseId: string,
    input: {
      type:
        | 'LESSON_NEW'
        | 'COURSE_NEW'
        | 'EXAM_NEW'
        | 'QUIZ_NEW'
        | 'ANNOUNCEMENT'
        | 'LIVE_LECTURE_NEW'
        | 'LIVE_LECTURE_STARTED'
        | 'LIVE_LECTURE_CANCELLED'
      | 'LIVE_LECTURE_ENDED'
      | 'EXAM_CANCELLED'
      | 'QUIZ_CANCELLED'
      | 'HOMEWORK_NEW'
      | 'MATERIAL_NEW'
      | 'LESSON_REMOVED';
      title: string;
      body: string;
      linkUrl?: string;
    },
  ) {
    try {
      const enrollments = await this.prisma.enrollment.findMany({
        where: { courseId, status: EnrollmentStatus.ACTIVE },
        select: { student: { select: { userId: true } } },
      });
      await this.notifyMany(
        enrollments.map((e) => e.student.userId),
        input,
      );
    } catch (err) {
      this.logger.error(`notifyEnrolledStudents failed (courseId=${courseId}, type=${input.type}): ${String(err)}`);
    }
  }

  async list(userId: string, query: { page?: number; limit?: number; unreadOnly?: boolean }) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 20, 50);

    const where = {
      userId,
      ...(query.unreadOnly && { isRead: false }),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      notifications,
      unreadCount,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async getUnreadCount(userId: string) {
    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { unreadCount };
  }

  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) throw new NotFoundException('Notification not found.');
    if (notification.userId !== userId) {
      throw new ForbiddenException('Access denied.');
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });
    return { message: 'Notification marked as read.' };
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { message: 'All notifications marked as read.' };
  }

  /**
   * A compact, server-authoritative reminder feed for the global reminder
   * banner. It deliberately returns only actionable items and never exposes
   * another student's progress or attendance.
   */
  async getLearningReminders(userId: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!student) return { reminders: [] };

    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
      select: { courseId: true },
    });
    const courseIds = enrollments.map((enrollment) => enrollment.courseId);
    if (courseIds.length === 0) return { reminders: [] };

    const now = new Date();
    const matureContentAt = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const recentLectureAt = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [lessons, quizzes, homeworks, exams, lectures] = await Promise.all([
      this.prisma.lesson.findMany({
        where: {
          courseId: { in: courseIds },
          isDeleted: false,
          createdAt: { lte: matureContentAt },
          progress: { none: { studentId: student.id, isCompleted: true } },
        },
        select: { id: true, title: true, courseId: true, course: { select: { title: true } } },
        orderBy: { orderIndex: 'asc' },
        take: 2,
      }),
      this.prisma.quiz.findMany({
        where: {
          isPublished: true,
          isDeleted: false,
          createdAt: { lte: matureContentAt },
          lesson: { courseId: { in: courseIds }, isDeleted: false },
          questions: { some: { isDeleted: false } },
          attempts: { none: { studentId: student.id, status: QuizAttemptStatus.SUBMITTED } },
        },
        select: {
          id: true,
          title: true,
          lesson: { select: { id: true, courseId: true, title: true, course: { select: { title: true } } } },
        },
        orderBy: { createdAt: 'asc' },
        take: 2,
      }),
      this.prisma.homework.findMany({
        where: {
          isPublished: true,
          isDeleted: false,
          lesson: { courseId: { in: courseIds }, isDeleted: false },
          questions: { some: { isDeleted: false } },
          attempts: { none: { studentId: student.id, status: QuizAttemptStatus.SUBMITTED } },
        },
        select: {
          id: true,
          title: true,
          lesson: { select: { id: true, courseId: true, title: true, course: { select: { title: true } } } },
        },
        orderBy: { createdAt: 'asc' },
        take: 2,
      }),
      this.prisma.exam.findMany({
        where: {
          courseId: { in: courseIds },
          isPublished: true,
          isDeleted: false,
          OR: [{ startAt: null }, { startAt: { lte: now } }],
          AND: [{ OR: [{ endAt: null }, { endAt: { gte: now } }] }],
          attempts: {
            none: { studentId: student.id },
          },
        },
        select: { id: true, title: true, courseId: true, course: { select: { title: true } } },
        orderBy: [{ endAt: 'asc' }, { createdAt: 'asc' }],
        take: 2,
      }),
      this.prisma.liveLecture.findMany({
        where: {
          courseId: { in: courseIds },
          isDeleted: false,
          status: LiveLectureStatus.ENDED,
          endedAt: { gte: recentLectureAt },
          attendances: { none: { studentId: student.id } },
        },
        select: { id: true, title: true, course: { select: { title: true } }, endedAt: true },
        orderBy: { endedAt: 'desc' },
        take: 1,
      }),
    ]);

    const reminders = [
      ...exams.map((exam) => ({
        id: `exam:${exam.id}`,
        kind: 'EXAM' as const,
        title: `امتحان ${exam.title} متاح الآن`,
        body: `لم تبدأ امتحان «${exam.title}» في كورس ${exam.course.title}.`,
        linkUrl: `/courses/${exam.courseId}/exams`,
        priority: 1,
      })),
      ...homeworks.map((hw) => ({
        id: `homework:${hw.id}`,
        kind: 'HOMEWORK' as const,
        title: `واجب ${hw.title} لم يتم تسليمه`,
        body: `قم بحل وتسليم واجب «${hw.title}» لدرس ${hw.lesson.title}.`,
        linkUrl: `/courses/${hw.lesson.courseId}/learn?lesson=${hw.lesson.id}`,
        priority: 2,
      })),
      ...quizzes.map((quiz) => ({
        id: `quiz:${quiz.id}`,
        kind: 'QUIZ' as const,
        title: `كويز ${quiz.title} بانتظارك`,
        body: `راجع كويز «${quiz.title}» بعد درس ${quiz.lesson.title}.`,
        linkUrl: `/courses/${quiz.lesson.courseId}/learn?lesson=${quiz.lesson.id}`,
        priority: 2,
      })),
      ...lessons.map((lesson) => ({
        id: `lesson:${lesson.id}`,
        kind: 'LESSON' as const,
        title: `لم تشاهد ${lesson.title} بعد`,
        body: `استكمل درس «${lesson.title}» في كورس ${lesson.course.title}.`,
        linkUrl: `/courses/${lesson.courseId}/learn?lesson=${lesson.id}`,
        priority: 3,
      })),
      ...lectures.map((lecture) => ({
        id: `lecture:${lecture.id}`,
        kind: 'LECTURE' as const,
        title: `فاتتك محاضرة ${lecture.title}`,
        body: `لم تسجل حضورك في المحاضرة المباشرة الخاصة بكورس ${lecture.course.title}.`,
        linkUrl: `/live-lectures/${lecture.id}`,
        priority: 4,
      })),
    ]
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 4)
      .map(({ priority: _priority, ...reminder }) => reminder);

    return { reminders };
  }

  /** Send a maximum of one summary reminder per learner every 12 hours. */
  @Cron(CronExpression.EVERY_6_HOURS)
  async sendLearningReminderNotifications() {
    try {
      const students = await this.prisma.studentProfile.findMany({
        where: { enrollments: { some: { status: EnrollmentStatus.ACTIVE } } },
        select: { userId: true },
      });
      const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
      let sent = 0;

      for (const student of students) {
        const alreadySent = await this.prisma.notification.findFirst({
          where: { userId: student.userId, type: 'LEARNING_REMINDER', createdAt: { gte: since } },
          select: { id: true },
        });
        if (alreadySent) continue;

        const { reminders } = await this.getLearningReminders(student.userId);
        if (reminders.length === 0) continue;

        await this.notify({
          userId: student.userId,
          type: 'LEARNING_REMINDER',
          title: 'تذكير بسيط بخطتك الدراسية 🔔',
          body: `${reminders[0].title}${reminders.length > 1 ? `، ولديك ${reminders.length - 1} مهام أخرى.` : '.'}`,
          linkUrl: reminders[0].linkUrl,
        });
        sent += 1;
      }
      if (sent > 0) this.logger.log(`Sent ${sent} learning reminder notification(s).`);
    } catch (error) {
      this.logger.error('Failed to send learning reminders.', error as Error);
    }
  }
}

