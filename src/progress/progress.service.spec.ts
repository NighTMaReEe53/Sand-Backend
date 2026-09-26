import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EnrollmentStatus } from '@prisma/client';
import { ProgressService } from './progress.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GamificationService } from '../gamification/gamification.service';
import { CertificatesService } from '../certificates/certificates.service';
import { LessonAccessService } from '../lessons/lesson-access.service';

describe('ProgressService (Unit Tests)', () => {
  let service: ProgressService;

  const mockPrismaService = {
    studentProfile: { findUnique: jest.fn() },
    lesson: { findFirst: jest.fn() },
    course: { findFirst: jest.fn() },
    enrollment: { findFirst: jest.fn() },
    progress: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const mockLessonAccessService = {
    getCourseLessonStates: jest.fn().mockResolvedValue(new Map()),
    isLessonQuizCompleted: jest.fn().mockResolvedValue(true),
  };

  const studentUserId = 'student-user-uuid';
  const mockStudent = { id: 'student-prof-uuid', userId: studentUserId };
  const mockLesson = { id: 'lesson-uuid', courseId: 'course-uuid', isDeleted: false };
  const mockEnrollment = { id: 'enr-uuid', studentId: 'student-prof-uuid', courseId: 'course-uuid', status: EnrollmentStatus.ACTIVE };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgressService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: GamificationService, useValue: { recordActivity: jest.fn().mockResolvedValue(undefined), awardBadge: jest.fn().mockResolvedValue(undefined) } },
        { provide: CertificatesService, useValue: { issue: jest.fn().mockResolvedValue(undefined) } },
        { provide: LessonAccessService, useValue: mockLessonAccessService },

      ],
    }).compile();

    service = module.get<ProgressService>(ProgressService);
    jest.clearAllMocks();
  });

  describe('updateLessonProgress', () => {
    it('should update progress and auto-complete when watchedPercentage >= 90', async () => {
      mockPrismaService.studentProfile.findUnique.mockResolvedValue(mockStudent);
      mockPrismaService.lesson.findFirst.mockResolvedValue(mockLesson);
      mockPrismaService.enrollment.findFirst.mockResolvedValue(mockEnrollment);
      mockPrismaService.progress.findUnique.mockResolvedValue({ watchedPercentage: 50, isCompleted: false });
      mockPrismaService.progress.upsert.mockResolvedValue({
        studentId: mockStudent.id,
        lessonId: mockLesson.id,
        watchedPercentage: 95,
        isCompleted: true,
        lastWatchedAt: new Date(),
      });

      const result = await service.updateLessonProgress(mockLesson.id, studentUserId, {
        watchedPercentage: 95,
      });

      expect(result.progress.isCompleted).toBe(true);
      expect(result.progress.watchedPercentage).toBe(95);
      expect(result.message).toContain('completed');
    });

    it('should not regress progress if new percentage is lower', async () => {
      mockPrismaService.studentProfile.findUnique.mockResolvedValue(mockStudent);
      mockPrismaService.lesson.findFirst.mockResolvedValue(mockLesson);
      mockPrismaService.enrollment.findFirst.mockResolvedValue(mockEnrollment);
      mockPrismaService.progress.findUnique.mockResolvedValue({ watchedPercentage: 80, isCompleted: false });
      mockPrismaService.progress.upsert.mockResolvedValue({
        studentId: mockStudent.id,
        lessonId: mockLesson.id,
        watchedPercentage: 80,
        isCompleted: false,
        lastWatchedAt: new Date(),
      });

      await service.updateLessonProgress(mockLesson.id, studentUserId, {
        watchedPercentage: 30, // Lower than current (80)
      });

      expect(mockPrismaService.progress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ watchedPercentage: 80 }),
        }),
      );
    });

    it('should throw ForbiddenException if student is not enrolled', async () => {
      mockPrismaService.studentProfile.findUnique.mockResolvedValue(mockStudent);
      mockPrismaService.lesson.findFirst.mockResolvedValue(mockLesson);
      mockPrismaService.enrollment.findFirst.mockResolvedValue(null); // Not enrolled

      await expect(
        service.updateLessonProgress(mockLesson.id, studentUserId, { watchedPercentage: 50 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getCourseProgress', () => {
    it('should calculate course progress percentage across all lessons', async () => {
      mockPrismaService.studentProfile.findUnique.mockResolvedValue(mockStudent);
      mockPrismaService.course.findFirst.mockResolvedValue({
        id: 'course-uuid',
        title: 'كورس الكيمياء',
        lessons: [
          { id: 'l1', title: 'الدرس 1', orderIndex: 1, durationSeconds: 600 },
          { id: 'l2', title: 'الدرس 2', orderIndex: 2, durationSeconds: 800 },
        ],
      });
      mockPrismaService.enrollment.findFirst.mockResolvedValue(mockEnrollment);
      mockPrismaService.progress.findMany.mockResolvedValue([
        { lessonId: 'l1', watchedPercentage: 100, isCompleted: true },
        { lessonId: 'l2', watchedPercentage: 40, isCompleted: false },
      ]);

      const result = await service.getCourseProgress('course-uuid', studentUserId);

      expect(result.totalLessons).toBe(2);
      expect(result.completedLessons).toBe(1);
      expect(result.courseProgressPercentage).toBe(50); // 1 out of 2 = 50%
      expect(result.isCourseCompleted).toBe(false);
    });
  });
});
