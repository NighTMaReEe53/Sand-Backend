import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateStudyTaskDto, UpdateStudyTaskDto } from './dtos/study-planner.dtos';

@Injectable()
export class StudyPlannerService {
  private readonly logger = new Logger(StudyPlannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async getStudent(userId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');
    return student;
  }

  private async assertOwnedTask(userId: string, taskId: string) {
    const student = await this.getStudent(userId);
    const task = await this.prisma.studyPlanTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found.');
    if (task.studentId !== student.id) throw new ForbiddenException('Access denied.');
    return { student, task };
  }

  private async validateLinks(studentId: string, dto: { courseId?: string | null; lessonId?: string | null; examId?: string | null }) {
    if (dto.courseId) {
      const enrolled = await this.prisma.enrollment.findFirst({
        where: { studentId, courseId: dto.courseId },
        select: { id: true },
      });
      if (!enrolled) throw new ForbiddenException('You are not enrolled in this course.');
    }
    // lesson/exam links are validated loosely (existence only)
    if (dto.lessonId) {
      const lesson = await this.prisma.lesson.findFirst({
        where: { id: dto.lessonId, isDeleted: false },
        select: { id: true },
      });
      if (!lesson) throw new NotFoundException('Lesson not found.');
    }
    if (dto.examId) {
      const exam = await this.prisma.exam.findFirst({
        where: { id: dto.examId, isDeleted: false },
        select: { id: true },
      });
      if (!exam) throw new NotFoundException('Exam not found.');
    }
  }

  async create(userId: string, dto: CreateStudyTaskDto) {
    const student = await this.getStudent(userId);
    await this.validateLinks(student.id, dto);

    const task = await this.prisma.studyPlanTask.create({
      data: {
        studentId: student.id,
        title: dto.title.trim(),
        description: dto.description ?? null,
        dueDate: new Date(dto.dueDate),
        courseId: dto.courseId ?? null,
        lessonId: dto.lessonId ?? null,
        examId: dto.examId ?? null,
      },
    });
    return { message: 'Task created successfully.', task };
  }

  async update(userId: string, taskId: string, dto: UpdateStudyTaskDto) {
    const { student } = await this.assertOwnedTask(userId, taskId);
    await this.validateLinks(student.id, dto);

    const updated = await this.prisma.studyPlanTask.update({
      where: { id: taskId },
      data: {
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.dueDate !== undefined && { dueDate: new Date(dto.dueDate) }),
        ...(dto.isCompleted !== undefined && {
          isCompleted: dto.isCompleted,
          completedAt: dto.isCompleted ? new Date() : null,
        }),
        ...(dto.courseId !== undefined && { courseId: dto.courseId }),
        ...(dto.lessonId !== undefined && { lessonId: dto.lessonId }),
        ...(dto.examId !== undefined && { examId: dto.examId }),
      },
    });
    return { message: 'Task updated successfully.', task: updated };
  }

  async delete(userId: string, taskId: string) {
    await this.assertOwnedTask(userId, taskId);
    await this.prisma.studyPlanTask.delete({ where: { id: taskId } });
    return { message: 'Task deleted successfully.' };
  }

  /**
   * Grouped view: today / upcoming / overdue / completed
   */
  async getPlanner(userId: string, query: { courseId?: string; daysAhead?: number }) {
    const student = await this.getStudent(userId);

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const daysAhead = Math.min(query.daysAhead && query.daysAhead > 0 ? query.daysAhead : 14, 90);
    const horizonEnd = new Date(endOfToday);
    horizonEnd.setDate(horizonEnd.getDate() + daysAhead);

    const baseWhere = {
      studentId: student.id,
      ...(query.courseId && { courseId: query.courseId }),
    };

    const [today, upcoming, overdue, completed] = await Promise.all([
      this.prisma.studyPlanTask.findMany({
        where: { ...baseWhere, isCompleted: false, dueDate: { gte: startOfToday, lt: endOfToday } },
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.studyPlanTask.findMany({
        where: { ...baseWhere, isCompleted: false, dueDate: { gte: endOfToday, lt: horizonEnd } },
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.studyPlanTask.findMany({
        where: { ...baseWhere, isCompleted: false, dueDate: { lt: startOfToday } },
        orderBy: { dueDate: 'desc' },
      }),
      this.prisma.studyPlanTask.findMany({
        where: { ...baseWhere, isCompleted: true },
        orderBy: { completedAt: 'desc' },
        take: 50,
      }),
    ]);

    return { today, upcoming, overdue, completed };
  }

  // ─────────────────────────────────────────────────────────────
  // CRON: Daily study-plan reminder (08:00)
  // Sends each student one notification summarizing today's plan:
  // tasks due today + overdue tasks, so they remember what to do.
  // ─────────────────────────────────────────────────────────────
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async sendDailyReminders() {
    try {
      const now = new Date();
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date(startOfToday);
      endOfToday.setDate(endOfToday.getDate() + 1);

      // All incomplete tasks that are due today or overdue
      const dueTasks = await this.prisma.studyPlanTask.findMany({
        where: {
          isCompleted: false,
          dueDate: { lt: endOfToday },
        },
        orderBy: { dueDate: 'asc' },
        select: {
          studentId: true,
          title: true,
          description: true,
          dueDate: true,
        },
      });
      if (dueTasks.length === 0) return;

      // Group by student, splitting today vs overdue
      const byStudent = new Map<
        string,
        { today: string[]; overdue: string[] }
      >();
      for (const t of dueTasks) {
        const entry =
          byStudent.get(t.studentId) ?? { today: [], overdue: [] };
        if (t.dueDate >= startOfToday) entry.today.push(t.title);
        else entry.overdue.push(t.title);
        byStudent.set(t.studentId, entry);
      }

      const studentIds = [...byStudent.keys()];
      const students = await this.prisma.studentProfile.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, userId: true },
      });
      const userIdByStudentId = new Map(
        students.map((s) => [s.id, s.userId]),
      );

      let sent = 0;
      for (const [studentId, { today, overdue }] of byStudent) {
        const userId = userIdByStudentId.get(studentId);
        if (!userId) continue;

        // One reminder per student per day — skip if already sent today.
        const alreadySent = await this.prisma.notification.findFirst({
          where: {
            userId,
            type: 'PLANNER_REMINDER',
            createdAt: { gte: startOfToday },
          },
          select: { id: true },
        });
        if (alreadySent) continue;

        const parts: string[] = [];
        if (today.length > 0) {
          parts.push(
            `لديك ${today.length} ${today.length === 1 ? 'مهمة' : 'مهام'} اليوم: ${today
              .slice(0, 3)
              .join('، ')}${today.length > 3 ? '…' : ''}`,
          );
        }
        if (overdue.length > 0) {
          parts.push(
            `وعليك ${overdue.length} ${overdue.length === 1 ? 'مهمة متأخرة' : 'مهام متأخرة'} بحاجة للمتابعة.`,
          );
        }

        await this.notificationsService.notify({
          userId,
          type: 'PLANNER_REMINDER',
          title: 'تذكير بخطتك الدراسية 📚',
          body: parts.join(' '),
          linkUrl: '/study-planner',
        });
        sent += 1;
      }

      if (sent > 0) {
        this.logger.log(`Sent ${sent} study-planner daily reminders.`);
      }
    } catch (err) {
      this.logger.error('Failed to send study-planner reminders.', err as Error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Remind immediately when a task becomes due within the next hour
  // ─────────────────────────────────────────────────────────────
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sendDueSoonReminders() {
    try {
      const now = new Date();
      const soon = new Date(now.getTime() + 60 * 60 * 1000);

      const dueTasks = await this.prisma.studyPlanTask.findMany({
        where: {
          isCompleted: false,
          dueDate: { gte: now, lte: soon },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          student: { select: { userId: true } },
        },
      });

      for (const t of dueTasks) {
        const alreadySent = await this.prisma.notification.findFirst({
          where: {
            userId: t.student.userId,
            type: 'PLANNER_REMINDER',
            linkUrl: `/study-planner?task=${t.id}`,
          },
          select: { id: true },
        });
        if (alreadySent) continue;

        await this.notificationsService.notify({
          userId: t.student.userId,
          type: 'PLANNER_REMINDER',
          title: 'اقترب موعد إحدى مهامك ⏰',
          body: `المهمة "${t.title}" مستحقة الآن تقريبًا — لا تنسَ إنجازها.`,
          linkUrl: `/study-planner?task=${t.id}`,
        });
      }
    } catch (err) {
      this.logger.error('Failed to send due-soon reminders.', err as Error);
    }
  }
}
