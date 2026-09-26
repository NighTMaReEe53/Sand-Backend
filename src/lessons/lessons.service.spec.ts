import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EnrollmentStatus, MaterialType, Role } from '@prisma/client';
import { LessonsService } from './lessons.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../shared/storage/storage.service';
import { LessonAccessService } from './lesson-access.service';

describe('LessonsService (Unit Tests)', () => {
  let service: LessonsService;
  let prisma: PrismaService;
  let storageService: StorageService;

  const mockPrismaService = {
    course: {
      findUnique: jest.fn(),
    },
    lesson: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    material: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    studentProfile: {
      findUnique: jest.fn(),
    },
    enrollment: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  const mockStorageService = {
    generateSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed-stream-url.example.com'),
    generatePresignedUploadUrl: jest.fn().mockResolvedValue({
      uploadUrl: 'https://upload.example.com',
      fileUrl: 'https://cdn.example.com/videos/video.mp4',
      key: 'videos/video.mp4',
      expiresInSeconds: 1800,
    }),
    deleteFile: jest.fn().mockResolvedValue(true),
  };

  const mockLessonAccessService = {
    getCourseLessonStates: jest.fn().mockResolvedValue(new Map()),
    isLessonQuizCompleted: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LessonsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },

        { provide: StorageService, useValue: mockStorageService },
        { provide: LessonAccessService, useValue: mockLessonAccessService },
      ],
    }).compile();

    service = module.get<LessonsService>(LessonsService);
    prisma = module.get<PrismaService>(PrismaService);
    storageService = module.get<StorageService>(StorageService);
    jest.clearAllMocks();
  });



  describe('reorderLessons', () => {
    const teacherUserId = 'teacher-user-1';
    const courseId = 'course-1';

    it('should throw BadRequestException if any lessonId does NOT belong to the specified course', async () => {
      mockPrismaService.course.findUnique.mockResolvedValue({
        id: courseId,
        isDeleted: false,
        teacher: { userId: teacherUserId },
      });
      // Course only has lesson-1 and lesson-2
      mockPrismaService.lesson.findMany.mockResolvedValue([
        { id: 'lesson-1' },
        { id: 'lesson-2' },
      ]);

      await expect(
        service.reorderLessons(teacherUserId, {
          courseId,
          orders: [
            { lessonId: 'lesson-1', newOrderIndex: 2 },
            { lessonId: 'FOREIGN_LESSON_ID', newOrderIndex: 1 }, // Foreign lesson
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reorder successfully using 2-step transaction avoiding unique collisions', async () => {
      mockPrismaService.course.findUnique.mockResolvedValue({
        id: courseId,
        isDeleted: false,
        teacher: { userId: teacherUserId },
      });
      mockPrismaService.lesson.findMany.mockResolvedValue([
        { id: 'lesson-1' },
        { id: 'lesson-2' },
      ]);
      mockPrismaService.lesson.update.mockResolvedValue({});

      await service.reorderLessons(teacherUserId, {
        courseId,
        orders: [
          { lessonId: 'lesson-1', newOrderIndex: 2 },
          { lessonId: 'lesson-2', newOrderIndex: 1 },
        ],
      });

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockPrismaService.lesson.update).toHaveBeenCalledTimes(4); // 2 temp negative + 2 final target
    });
  });

  describe('getLessonStreamUrl', () => {
    const lessonId = 'lesson-1';
    const mockLesson = {
      id: lessonId,
      courseId: 'course-1',
      title: 'Intro Lesson',
      videoUrl: 'https://s3.example.com/videos/lesson1.mp4',
      durationSeconds: 1200,
      isPreview: false,
      isDeleted: false,
      course: {
        id: 'course-1',
        isDeleted: false,
        teacher: { userId: 'teacher-owner-id' },
      },
    };

    it('should allow Course Owner to stream video', async () => {
      mockPrismaService.lesson.findUnique.mockResolvedValue(mockLesson);

      const result = await service.getLessonStreamUrl(lessonId, {
        id: 'teacher-owner-id',
        role: Role.TEACHER,
        email: 'teacher@test.com',
        phone: '01011111111',
        isVerified: true,
      });

      expect(result.streamUrl).toBe('https://signed-stream-url.example.com');
      expect(mockStorageService.generateSignedDownloadUrl).toHaveBeenCalled();
    });

    it('should allow anyone to stream a Free Preview lesson', async () => {
      mockPrismaService.lesson.findUnique.mockResolvedValue({
        ...mockLesson,
        isPreview: true, // Preview enabled
      });

      const result = await service.getLessonStreamUrl(lessonId, {
        id: 'unregistered-or-other-student',
        role: Role.STUDENT,
        email: 'student@test.com',
        phone: '01022222222',
        isVerified: true,
      });

      expect(result.streamUrl).toBe('https://signed-stream-url.example.com');
    });

    it('should allow Enrolled Student with ACTIVE status to stream', async () => {
      mockPrismaService.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrismaService.studentProfile.findUnique.mockResolvedValue({ id: 'student-profile-1' });
      mockPrismaService.enrollment.findFirst.mockResolvedValue({
        status: EnrollmentStatus.ACTIVE,
      });

      const result = await service.getLessonStreamUrl(lessonId, {
        id: 'student-user-id',
        role: Role.STUDENT,
        email: 'enrolled@test.com',
        phone: '01033333333',
        isVerified: true,
      });

      expect(result.streamUrl).toBe('https://signed-stream-url.example.com');
    });

    it('should throw ForbiddenException for non-enrolled student on paid non-preview lesson', async () => {
      mockPrismaService.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrismaService.studentProfile.findUnique.mockResolvedValue({ id: 'student-profile-1' });
      mockPrismaService.enrollment.findFirst.mockResolvedValue(null); // NOT ENROLLED

      await expect(
        service.getLessonStreamUrl(lessonId, {
          id: 'student-user-id',
          role: Role.STUDENT,
          email: 'notenrolled@test.com',
          phone: '01044444444',
          isVerified: true,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw LESSON_LOCKED for enrolled student when previous lesson is not completed', async () => {
      mockPrismaService.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrismaService.studentProfile.findUnique.mockResolvedValue({ id: 'student-profile-1' });
      mockPrismaService.enrollment.findFirst.mockResolvedValue({
        status: EnrollmentStatus.ACTIVE,
      });
      mockLessonAccessService.getCourseLessonStates.mockResolvedValue(
        new Map([
          [
            lessonId,
            {
              status: 'LOCKED',
              lockReasonCode: 'PREVIOUS_LESSON_NOT_COMPLETED',
              lockMessage: 'يجب إكمال مشاهدة الدرس السابق أولاً.',
              quizCompleted: true,
            },
          ],
        ]),
      );

      await expect(
        service.getLessonStreamUrl(lessonId, {
          id: 'student-user-id',
          role: Role.STUDENT,
          email: 'locked@test.com',
          phone: '01055555555',
          isVerified: true,
        }),
      ).rejects.toMatchObject({
        response: { code: 'LESSON_LOCKED', lockReasonCode: 'PREVIOUS_LESSON_NOT_COMPLETED' },
      });
      expect(mockStorageService.generateSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('should throw LESSON_LOCKED when previous video done but its quiz not passed', async () => {
      mockPrismaService.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrismaService.studentProfile.findUnique.mockResolvedValue({ id: 'student-profile-1' });
      mockPrismaService.enrollment.findFirst.mockResolvedValue({
        status: EnrollmentStatus.ACTIVE,
      });
      mockLessonAccessService.getCourseLessonStates.mockResolvedValue(
        new Map([
          [
            lessonId,
            {
              status: 'LOCKED',
              lockReasonCode: 'PREVIOUS_QUIZ_NOT_COMPLETED',
              lockMessage: 'يجب اجتياز كويز الدرس السابق أولاً.',
              quizCompleted: false,
            },
          ],
        ]),
      );

      await expect(
        service.getLessonStreamUrl(lessonId, {
          id: 'student-user-id',
          role: Role.STUDENT,
          email: 'quizlocked@test.com',
          phone: '01066666666',
          isVerified: true,
        }),
      ).rejects.toMatchObject({ response: { code: 'LESSON_LOCKED' } });
    });

    it('should allow enrolled student when previous lesson AND quiz are completed', async () => {
      mockPrismaService.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrismaService.studentProfile.findUnique.mockResolvedValue({ id: 'student-profile-1' });
      mockPrismaService.enrollment.findFirst.mockResolvedValue({
        status: EnrollmentStatus.ACTIVE,
      });
      mockLessonAccessService.getCourseLessonStates.mockResolvedValue(
        new Map([
          [lessonId, { status: 'AVAILABLE', lockReasonCode: null, lockMessage: null, quizCompleted: true }],
        ]),
      );

      const result = await service.getLessonStreamUrl(lessonId, {
        id: 'student-user-id',
        role: Role.STUDENT,
        email: 'unlocked@test.com',
        phone: '01077777777',
        isVerified: true,
      });

      expect(result.streamUrl).toBe('https://signed-stream-url.example.com');
    });
  });
});
