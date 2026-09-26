import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CourseStatus, EnrollmentStatus, Role } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LessonAccessService } from '../lessons/lesson-access.service';
import { canManageCourse } from '../common/utils/course-access.util';

export interface BacklogItem {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  orderIndex: number;
  type: 'VIDEO' | 'QUIZ' | 'HOMEWORK' | 'EXAM';
  watchedPercentage: number;
  durationSeconds: number;
  dueDate: Date | null;
  overdue: boolean;
}

@Injectable()
export class BacklogService {
  private readonly logger = new Logger(BacklogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly lessonAccessService: LessonAccessService,
  ) {}

  /**
   * Phase 2 — student backlog across all actively-enrolled courses.
   *
   * A backlog item is a published, AVAILABLE (not locked) item that is:
   * - VIDEO: not fully watched yet.
   * - QUIZ: published quiz not completed/passed.
   * - HOMEWORK: published homework not solved/submitted.
   * - EXAM: published exam not taken/submitted.
   */
  async getStudentBacklog(studentId: string): Promise<{
    totalItems: number;
    courses: {
      courseId: string;
      courseTitle: string;
      itemCount: number;
      items: BacklogItem[];
    }[];
  }> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId, status: EnrollmentStatus.ACTIVE },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            status: true,
            lessons: {
              where: { isDeleted: false },
              orderBy: { orderIndex: 'asc' },
              select: { id: true, title: true, orderIndex: true, durationSeconds: true, dueDate: true },
            },
          },
        },
      },
      orderBy: { enrolledAt: 'asc' },
    });

    const now = new Date();
    const result: {
      courseId: string;
      courseTitle: string;
      itemCount: number;
      items: BacklogItem[];
    }[] = [];

    for (const enrollment of enrollments) {
      const course = enrollment.course;
      if (course.status !== CourseStatus.PUBLISHED || course.lessons.length === 0) continue;

      const lessonIds = course.lessons.map((l) => l.id);

      const [states, progresses, homeworks, homeworkAttempts, exams, examAttempts] = await Promise.all([
        this.lessonAccessService.getCourseLessonStates(course.id, studentId),
        this.prisma.progress.findMany({
          where: { studentId, lesson: { courseId: course.id, isDeleted: false } },
        }),
        lessonIds.length > 0
          ? this.prisma.homework.findMany({
              where: { lessonId: { in: lessonIds }, isDeleted: false, isPublished: true },
              select: { id: true, title: true, lessonId: true, availableFrom: true },
            })
          : [],
        this.prisma.homeworkAttempt.findMany({
          where: { studentId, homework: { lesson: { courseId: course.id } } },
          select: { homeworkId: true, status: true, isPassed: true },
        }),
        this.prisma.exam.findMany({
          where: { courseId: course.id, isDeleted: false, isPublished: true },
          select: { id: true, title: true, startAt: true, endAt: true },
        }),
        this.prisma.examAttempt.findMany({
          where: { studentId, exam: { courseId: course.id } },
          select: { examId: true, status: true, isPassed: true },
        }),
      ]);

      const progressMap = new Map(progresses.map((p) => [p.lessonId, p]));
      const submittedHwSet = new Set(
        homeworkAttempts
          .filter((a) => a.status === 'SUBMITTED' || a.isPassed)
          .map((a) => a.homeworkId),
      );
      const submittedExamSet = new Set(
        examAttempts
          .filter((a) => a.status === 'SUBMITTED' || a.isPassed)
          .map((a) => a.examId),
      );

      const items: BacklogItem[] = [];

      // 1. Lessons: Check Video, Quiz, and Homework
      for (const lesson of course.lessons) {
        const state = states.get(lesson.id);
        if (!state) continue;
        if (state.status === 'LOCKED') continue;

        const progress = progressMap.get(lesson.id);
        const videoCompleted = progress?.isCompleted ?? false;

        // Unwatched / incomplete video
        if (!videoCompleted) {
          items.push({
            courseId: course.id,
            courseTitle: course.title,
            lessonId: lesson.id,
            lessonTitle: lesson.title,
            orderIndex: lesson.orderIndex,
            type: 'VIDEO',
            watchedPercentage: progress?.watchedPercentage ?? 0,
            durationSeconds: progress?.videoDurationSeconds ?? lesson.durationSeconds,
            dueDate: lesson.dueDate,
            overdue: lesson.dueDate ? lesson.dueDate < now : false,
          });
        }

        // Unpassed quiz on available lesson
        if (!state.quizCompleted) {
          items.push({
            courseId: course.id,
            courseTitle: course.title,
            lessonId: lesson.id,
            lessonTitle: lesson.title,
            orderIndex: lesson.orderIndex,
            type: 'QUIZ',
            watchedPercentage: progress?.watchedPercentage ?? 0,
            durationSeconds: lesson.durationSeconds,
            dueDate: lesson.dueDate,
            overdue: lesson.dueDate ? lesson.dueDate < now : false,
          });
        }

        // Unsubmitted homework on available lesson
        const lessonHws = homeworks.filter((h) => h.lessonId === lesson.id);
        for (const hw of lessonHws) {
          if (!submittedHwSet.has(hw.id)) {
            items.push({
              courseId: course.id,
              courseTitle: course.title,
              lessonId: lesson.id,
              lessonTitle: `${lesson.title} - واجب: ${hw.title}`,
              orderIndex: lesson.orderIndex,
              type: 'HOMEWORK',
              watchedPercentage: progress?.watchedPercentage ?? 0,
              durationSeconds: 0,
              dueDate: lesson.dueDate,
              overdue: lesson.dueDate ? lesson.dueDate < now : false,
            });
          }
        }
      }

      // 2. Published Exams in this course that student hasn't submitted yet
      for (const exam of exams) {
        if (!submittedExamSet.has(exam.id)) {
          const isOverdue = exam.endAt ? exam.endAt < now : false;
          items.push({
            courseId: course.id,
            courseTitle: course.title,
            lessonId: '',
            lessonTitle: `امتحان: ${exam.title}`,
            orderIndex: 0,
            type: 'EXAM',
            watchedPercentage: 0,
            durationSeconds: 0,
            dueDate: exam.endAt,
            overdue: isOverdue,
          });
        }
      }

      if (items.length > 0) {
        result.push({
          courseId: course.id,
          courseTitle: course.title,
          itemCount: items.length,
          items,
        });
      }
    }

    return {
      totalItems: result.reduce((sum, c) => sum + c.itemCount, 0),
      courses: result,
    };
  }

  /** User-id entry points (resolve StudentProfile first). */
  async getStudentBacklogByUser(userId: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!student) throw new ForbiddenException('Student profile not found.');
    return this.getStudentBacklog(student.id);
  }

  async getCourseBacklogByUser(courseId: string, userId: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!student) throw new ForbiddenException('Student profile not found.');
    return this.getCourseBacklog(courseId, student.id);
  }

  /** Backlog limited to one course (must be actively enrolled). */
  async getCourseBacklog(courseId: string, studentId: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, courseId, status: EnrollmentStatus.ACTIVE },
      select: { id: true },
    });
    if (!enrollment) throw new ForbiddenException('You must be actively enrolled in this course.');

    const all = await this.getStudentBacklog(studentId);
    const course = all.courses.find((c) => c.courseId === courseId);
    return {
      courseId,
      itemCount: course?.itemCount ?? 0,
      items: course?.items ?? [],
    };
  }

  /**
   * Phase 2 — teacher/admin analytics: learning-status distribution and the
   * most-behind students for one course. Never exposed to students.
   */
  async getCourseLearningStatus(
    courseId: string,
    user: { id: string; role: Role },
  ) {
    const isOwner = await canManageCourse(this.prisma, user.id, courseId, user.role);
    if (!isOwner) throw new ForbiddenException('You can only view analytics for your own courses.');

    const course = await this.prisma.course.findFirst({
      where: { id: courseId, isDeleted: false },
      select: {
        id: true,
        title: true,
        lessons: {
          where: { isDeleted: false },
          select: { id: true },
        },
      },
    });
    if (!course) throw new NotFoundException('Course not found.');
    const totalLessons = course.lessons.length;

    const enrollments = await this.prisma.enrollment.findMany({
      where: { courseId, status: EnrollmentStatus.ACTIVE },
      include: { student: { select: { id: true, fullName: true, photoUrl: true } } },
    });

    const rows: {
      studentId: string;
      fullName: string;
      photoUrl: string | null;
      backlogCount: number;
    }[] = [];

    for (const enrollment of enrollments) {
      const backlog = await this.getCourseBacklog(courseId, enrollment.studentId);
      rows.push({
        studentId: enrollment.studentId,
        fullName: enrollment.student.fullName,
        photoUrl: enrollment.student.photoUrl,
        backlogCount: backlog.itemCount,
      });
    }

    const onTrack = rows.filter((r) => r.backlogCount === 0).length;
    const behind = rows.filter((r) => r.backlogCount > 0 && r.backlogCount <= 3).length;
    const severelyBehind = rows.filter((r) => r.backlogCount > 3).length;
    const total = rows.length || 1;

    return {
      courseId,
      courseTitle: course.title,
      totalStudents: rows.length,
      distribution: {
        onTrackPercentage: Math.round((onTrack / total) * 100),
        behindPercentage: Math.round((behind / total) * 100),
        severelyBehindPercentage: Math.round((severelyBehind / total) * 100),
      },
      mostBehindStudents: [...rows]
        .filter((r) => r.backlogCount > 0)
        .sort((a, b) => b.backlogCount - a.backlogCount)
        .slice(0, 10),
      averageCompletion:
        totalLessons > 0 && rows.length > 0
          ? Math.round(
              rows.reduce(
                (sum, r) => sum + ((totalLessons - r.backlogCount) / totalLessons) * 100,
                0,
              ) / rows.length,
            )
          : null,
    };
  }

  /**
   * Anti-spam notification rules:
   * - first time backlog appears → single notification
   * - re-notify ONLY when the count increases since last notification
   * - one celebratory notification when it returns to 0
   * State tracked per (student, course) on the existing Enrollment row.
   */
  async checkAndNotifyStudent(studentId: string, courseId: string) {
    try {
      const enrollment = await this.prisma.enrollment.findFirst({
        where: { studentId, courseId, status: EnrollmentStatus.ACTIVE },
        include: { student: { select: { userId: true } }, course: { select: { title: true } } },
      });
      if (!enrollment) return;

      const backlog = await this.getCourseBacklog(courseId, studentId);
      const count = backlog.itemCount;
      const lastNotified = enrollment.lastNotifiedBacklogCount ?? null;

      if (count === 0) {
        if (lastNotified !== null && lastNotified > 0) {
          await this.notificationsService.notify({
            userId: enrollment.student.userId,
            type: 'BACKLOG_CLEARED',
            title: 'عادت أمورك إلى المسار الصحيح!',
            body: `أحسنت! أنجزت كل الدروس المتأخرة في كورس "${enrollment.course.title}".`,
            linkUrl: `/courses/${courseId}/learn`,
          });
        }
        if (lastNotified !== 0) {
          await this.prisma.enrollment.update({
            where: { id: enrollment.id },
            data: { lastNotifiedBacklogCount: 0 },
          });
        }
        return;
      }

      const shouldNotify =
        lastNotified === null || count > lastNotified;
      if (shouldNotify) {
        const isFirst = lastNotified === null || lastNotified === 0;
        await this.notificationsService.notify({
          userId: enrollment.student.userId,
          type: 'BACKLOG_UPDATED',
          title: isFirst ? 'لديك دروس متأخرة' : 'تراكمت دروس جديدة متأخرة',
          body: isFirst
            ? `أنت متأخر عن "${enrollment.course.title}" بعدد ${count} درس/دروس. تابع الآن!`
            : `ازداد تأخرك في "${enrollment.course.title}" إلى ${count} دروس.`,
          linkUrl: `/my-backlog`,
        });
        await this.prisma.enrollment.update({
          where: { id: enrollment.id },
          data: { lastNotifiedBacklogCount: count },
        });
      }
    } catch (error) {
      this.logger.error(`checkAndNotifyStudent failed: ${error}`);
    }
  }

  /** Daily anti-spam backlog sweep over every active enrollment. */
  @Cron('0 18 * * *')
  async dailyBacklogSweep() {
    try {
      const enrollments = await this.prisma.enrollment.findMany({
        where: { status: EnrollmentStatus.ACTIVE },
        select: { studentId: true, courseId: true },
      });
      for (const e of enrollments) {
        await this.checkAndNotifyStudent(e.studentId, e.courseId);
      }
    } catch (error) {
      this.logger.error(`dailyBacklogSweep failed: ${error}`);
    }
  }
}
