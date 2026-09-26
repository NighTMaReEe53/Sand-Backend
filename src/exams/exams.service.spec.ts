import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ExamAttemptStatus, EnrollmentStatus, Role } from '@prisma/client';
import { ExamsService } from './exams.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GamificationService } from '../gamification/gamification.service';
import { StorageService } from '../shared/storage/storage.service';
import { PdfGeneratorService } from '../shared/pdf/pdf-generator.service';
import { LeaderboardService } from './leaderboard.service';

describe('ExamsService (Unit Tests)', () => {
  let service: ExamsService;

  const mockPrismaService = {
    teacherProfile: { findUnique: jest.fn() },
    studentProfile: { findUnique: jest.fn() },
    course: { findFirst: jest.fn(), findUnique: jest.fn() },
    lesson: { findFirst: jest.fn() },
    enrollment: { findFirst: jest.fn() },
    exam: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    question: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    examAttempt: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    attemptAnswer: {
      createMany: jest.fn(),
    },
    $transaction: jest.fn((ops) => (Array.isArray(ops) ? Promise.all(ops) : ops(mockPrismaService))),
  };

  const teacherUser = { id: 'teacher-user-id', role: Role.TEACHER, phone: '01000000000' };
  const studentUser = { id: 'student-user-id', role: Role.STUDENT, phone: '01000000001' };
  const mockTeacher = { id: 'teacher-prof-id', userId: 'teacher-user-id' };
  const mockStudent = { id: 'student-prof-id', userId: 'student-user-id' };
  const mockCourse = { id: 'course-uuid', teacherId: 'teacher-prof-id', isDeleted: false, price: 200 };
  const mockExam = {
    id: 'exam-uuid',
    courseId: 'course-uuid',
    lessonId: null,
    title: 'امتحان الفيزياء',
    description: null,
    durationMinutes: 45,
    totalMarks: 100,
    passingMarks: 50,
    startAt: null,
    endAt: null,
    maxAttempts: 2,
    shuffleQuestions: false,
    showCorrectAnswersAfterSubmission: true,
    isPublished: true,
    isDeleted: false,
    course: { teacherId: 'teacher-prof-id' },
    questions: [
      {
        id: 'q-1',
        text: 'ما هي وحدة قياس التيار؟',
        imageUrl: null,
        options: ['فولت', 'أمبير', 'أوم', 'وات'],
        correctOptionIndex: 1,
        explanation: 'الأمبير هو وحدة شدة التيار الكهربي.',
        marks: 10,
        orderIndex: 1,
        isDeleted: false,
      },
      {
        id: 'q-2',
        text: 'وحدة قياس المقاومة؟',
        imageUrl: null,
        options: ['فولت', 'أمبير', 'أوم', 'وات'],
        correctOptionIndex: 2,
        explanation: 'الأوم هو وحدة قياس المقاومة الكهربية.',
        marks: 10,
        orderIndex: 2,
        isDeleted: false,
      },
    ],
  };
  const mockEnrollment = { id: 'enrollment-uuid', studentId: 'student-prof-id', courseId: 'course-uuid', status: EnrollmentStatus.ACTIVE };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: { uploadFile: jest.fn().mockResolvedValue('url') } },
        { provide: PdfGeneratorService, useValue: { generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifyEnrolledStudents: jest.fn().mockResolvedValue(undefined) } },
        { provide: GamificationService, useValue: { recordActivity: jest.fn().mockResolvedValue(undefined), awardBadge: jest.fn().mockResolvedValue(undefined) } },
        { provide: LeaderboardService, useValue: { recomputeExamAchievements: jest.fn().mockResolvedValue(undefined), getExamLeaderboard: jest.fn(), getMyAchievements: jest.fn() } },

      ],
    }).compile();

    service = module.get<ExamsService>(ExamsService);
    jest.clearAllMocks();

    // Default successful mocks
    mockPrismaService.exam.update.mockResolvedValue({ ...mockExam });
    mockPrismaService.exam.create.mockResolvedValue({ ...mockExam });
    mockPrismaService.question.create.mockResolvedValue({ id: 'q-new', marks: 10, orderIndex: 1 });
    mockPrismaService.question.update.mockResolvedValue({});
    mockPrismaService.examAttempt.update.mockResolvedValue({ id: 'attempt-1', status: ExamAttemptStatus.SUBMITTED, score: 10, isPassed: false });
    mockPrismaService.attemptAnswer.createMany.mockResolvedValue({ count: 2 });
  });

  // ─────────────────────────────────────────────────────────────
  describe('createExam', () => {
    it('should create an exam for a valid teacher and course', async () => {
      mockPrismaService.teacherProfile.findUnique.mockResolvedValue(mockTeacher);
      mockPrismaService.course.findFirst.mockResolvedValue(mockCourse);

      const result = await service.createExam('course-uuid', {
        title: 'امتحان الفيزياء',
        durationMinutes: 45,
        totalMarks: 100,
        passingMarks: 50,
        maxAttempts: 2,
      }, teacherUser);

      expect(result.message).toContain('created successfully');
      expect(mockPrismaService.exam.create).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundException if course does not belong to teacher', async () => {
      mockPrismaService.teacherProfile.findUnique.mockResolvedValue(mockTeacher);
      mockPrismaService.course.findFirst.mockResolvedValue(null);

      await expect(
        service.createExam('other-course', { title: 'Test', durationMinutes: 30 }, teacherUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if startAt >= endAt', async () => {
      mockPrismaService.teacherProfile.findUnique.mockResolvedValue(mockTeacher);
      mockPrismaService.course.findFirst.mockResolvedValue(mockCourse);

      await expect(
        service.createExam('course-uuid', {
          title: 'Test',
          durationMinutes: 30,
          startAt: '2026-09-01T12:00:00Z',
          endAt: '2026-09-01T10:00:00Z',
        }, teacherUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('addQuestion', () => {
    it('should throw BadRequestException if correctOptionIndex exceeds options length', async () => {
      mockPrismaService.teacherProfile.findUnique.mockResolvedValue(mockTeacher);
      mockPrismaService.exam.findFirst.mockResolvedValue({ ...mockExam });
      mockPrismaService.question.findFirst.mockResolvedValue(null);

      await expect(
        service.addQuestion('exam-uuid', {
          text: 'سؤال اختبار',
          options: ['أ', 'ب'],
          correctOptionIndex: 5, // Invalid — out of range
          marks: 10,
        }, teacherUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should add question successfully when correctOptionIndex is valid', async () => {
      mockPrismaService.teacherProfile.findUnique.mockResolvedValue(mockTeacher);
      mockPrismaService.exam.findFirst.mockResolvedValue({ ...mockExam });
      mockPrismaService.question.findFirst.mockResolvedValue(null);

      const result = await service.addQuestion('exam-uuid', {
        text: 'ما هي وحدة التيار؟',
        options: ['فولت', 'أمبير', 'أوم', 'وات'],
        correctOptionIndex: 1,
        marks: 10,
      }, teacherUser);

      expect(result.message).toContain('added successfully');
      expect(mockPrismaService.question.create).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('startExam (Anti-Cheat & Server Timing)', () => {
    it('should return questions WITHOUT correctOptionIndex (anti-cheat)', async () => {
      mockPrismaService.exam.findFirst.mockResolvedValue({ ...mockExam });
      mockPrismaService.studentProfile.findUnique.mockResolvedValue(mockStudent);
      mockPrismaService.enrollment.findFirst.mockResolvedValue(mockEnrollment);
      mockPrismaService.examAttempt.count.mockResolvedValue(0); // No completed attempts
      mockPrismaService.examAttempt.findFirst.mockResolvedValue(null); // No active attempt
      mockPrismaService.examAttempt.create.mockResolvedValue({
        id: 'attempt-new',
        attemptNumber: 1,
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 45 * 60 * 1000),
        status: ExamAttemptStatus.IN_PROGRESS,
      });

      const result = await service.startExam('exam-uuid', studentUser);

      expect(result.attempt).toBeDefined();
      expect(result.questions).toBeDefined();
      // CRITICAL: correctOptionIndex must NOT appear in questions
      result.questions.forEach((q: any) => {
        expect(q.correctOptionIndex).toBeUndefined();
        expect(q.explanation).toBeUndefined();
      });
    });

    it('should throw ForbiddenException if student is not enrolled', async () => {
      mockPrismaService.exam.findFirst.mockResolvedValue({ ...mockExam });
      mockPrismaService.studentProfile.findUnique.mockResolvedValue(mockStudent);
      mockPrismaService.enrollment.findFirst.mockResolvedValue(null); // NOT enrolled

      await expect(service.startExam('exam-uuid', studentUser)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if student has reached maxAttempts', async () => {
      mockPrismaService.exam.findFirst.mockResolvedValue({ ...mockExam }); // maxAttempts = 2
      mockPrismaService.studentProfile.findUnique.mockResolvedValue(mockStudent);
      mockPrismaService.enrollment.findFirst.mockResolvedValue(mockEnrollment);
      mockPrismaService.examAttempt.findFirst.mockResolvedValue(null);
      mockPrismaService.examAttempt.count.mockResolvedValue(2); // Already used all 2 attempts

      await expect(service.startExam('exam-uuid', studentUser)).rejects.toThrow(ForbiddenException);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('submitExam (Atomic Auto-Grading)', () => {
    const mockAttempt = {
      id: 'attempt-1',
      examId: 'exam-uuid',
      studentId: 'student-prof-id',
      status: ExamAttemptStatus.IN_PROGRESS,
      expiresAt: new Date(Date.now() + 1000 * 3600), // Not expired
      exam: {
        totalMarks: 20,
        passingMarks: 10,
        showCorrectAnswersAfterSubmission: true,
        questions: mockExam.questions,
      },
    };

    it('should grade answers correctly and return score and isPassed', async () => {
      mockPrismaService.studentProfile.findUnique.mockResolvedValue(mockStudent);
      mockPrismaService.examAttempt.findFirst.mockResolvedValue(mockAttempt);

      const result = await service.submitExam('attempt-1', {
        answers: [
          { questionId: 'q-1', selectedOptionIndex: 1 }, // ✅ correct (index=1)
          { questionId: 'q-2', selectedOptionIndex: 0 }, // ❌ wrong (correct is 2)
        ],
      }, studentUser);

      expect(result.score).toBe(10); // Only q-1 is correct (10 marks out of 20 total)
      expect(result.isPassed).toBe(true); // 10 >= passingMarks(10) → passes
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should throw ConflictException if attempt already submitted', async () => {
      mockPrismaService.studentProfile.findUnique.mockResolvedValue(mockStudent);
      mockPrismaService.examAttempt.findFirst.mockResolvedValue({
        ...mockAttempt,
        status: ExamAttemptStatus.SUBMITTED,
      });

      await expect(
        service.submitExam('attempt-1', { answers: [] }, studentUser),
      ).rejects.toThrow(ConflictException);
    });

    it('should mark as TIMED_OUT if submission arrives after expiresAt', async () => {
      mockPrismaService.studentProfile.findUnique.mockResolvedValue(mockStudent);
      mockPrismaService.examAttempt.findFirst.mockResolvedValue({
        ...mockAttempt,
        expiresAt: new Date(Date.now() - 1000), // EXPIRED
      });

      const result = await service.submitExam('attempt-1', {
        answers: [
          { questionId: 'q-1', selectedOptionIndex: 1 },
          { questionId: 'q-2', selectedOptionIndex: 2 },
        ],
      }, studentUser);

      expect(result.status).toBe(ExamAttemptStatus.TIMED_OUT);
      expect(result.message).toContain('time expired');
    });
  });
});
