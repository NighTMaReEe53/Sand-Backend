import { LessonAccessService } from './lesson-access.service';
import { PrismaService } from '../shared/prisma/prisma.service';

describe('LessonAccessService (Unit Tests)', () => {
  let service: LessonAccessService;

  const mockPrismaService = {
    lesson: { findMany: jest.fn() },
    progress: { findMany: jest.fn() },
    quiz: { findMany: jest.fn() },
    quizAttempt: { findMany: jest.fn() },
  };

  const lessons = [
    { id: 'lesson-a' },
    { id: 'lesson-b' },
    { id: 'lesson-c' },
  ];

  const quizOnEveryLesson = [
    { id: 'quiz-a', lessonId: 'lesson-a' },
    { id: 'quiz-b', lessonId: 'lesson-b' },
    { id: 'quiz-c', lessonId: 'lesson-c' },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    service = new LessonAccessService(mockPrismaService as unknown as PrismaService);
    mockPrismaService.lesson.findMany.mockResolvedValue(lessons);
    mockPrismaService.quiz.findMany.mockResolvedValue(quizOnEveryLesson);
  });

  const setState = (
    progresses: { lessonId: string; watchedPercentage?: number; isCompleted: boolean }[],
    passedQuizIds: string[],
  ) => {
    mockPrismaService.progress.findMany.mockResolvedValue(progresses);
    mockPrismaService.quizAttempt.findMany.mockResolvedValue(
      passedQuizIds.map((quizId) => ({ quizId })),
    );
  };

  it('Video✓ + Quiz✓ on previous lesson → next lesson AVAILABLE', async () => {
    setState([{ lessonId: 'lesson-a', isCompleted: true, watchedPercentage: 100 }], ['quiz-a']);

    const states = await service.getCourseLessonStates('course-1', 'student-1');

    expect(states.get('lesson-a')!.status).toBe('COMPLETED');
    expect(states.get('lesson-b')!.status).toBe('AVAILABLE');
    expect(states.get('lesson-b')!.lockReasonCode).toBeNull();
  });

  it('Video✓ + Quiz✗ → next lesson LOCKED by quiz', async () => {
    setState([{ lessonId: 'lesson-a', isCompleted: true, watchedPercentage: 95 }], []);

    const states = await service.getCourseLessonStates('course-1', 'student-1');

    expect(states.get('lesson-b')).toMatchObject({
      status: 'LOCKED',
      lockReasonCode: 'PREVIOUS_QUIZ_NOT_COMPLETED',
    });
  });

  it('Video✗ + Quiz✓ → next lesson LOCKED by lesson', async () => {
    setState(
      [{ lessonId: 'lesson-a', isCompleted: false, watchedPercentage: 40 }],
      ['quiz-a'],
    );

    const states = await service.getCourseLessonStates('course-1', 'student-1');

    expect(states.get('lesson-b')).toMatchObject({
      status: 'LOCKED',
      lockReasonCode: 'PREVIOUS_LESSON_NOT_COMPLETED',
    });
  });

  it('Video✗ + Quiz✗ → next lesson LOCKED by lesson', async () => {
    setState([], []);

    const states = await service.getCourseLessonStates('course-1', 'student-1');

    expect(states.get('lesson-a')!.status).toBe('AVAILABLE'); // first lesson never locked
    expect(states.get('lesson-b')).toMatchObject({
      status: 'LOCKED',
      lockReasonCode: 'PREVIOUS_LESSON_NOT_COMPLETED',
    });
    // Chain stays locked until prerequisites complete
    expect(states.get('lesson-c')).toMatchObject({ status: 'LOCKED' });
  });

  it('watched but not completed previous lesson → IN_PROGRESS, next still LOCKED', async () => {
    setState([{ lessonId: 'lesson-a', isCompleted: false, watchedPercentage: 60 }], []);

    const states = await service.getCourseLessonStates('course-1', 'student-1');

    expect(states.get('lesson-a')!.status).toBe('IN_PROGRESS');
    expect(states.get('lesson-b')!.status).toBe('LOCKED');
  });

  it('lessons without published quizzes are never gated', async () => {
    mockPrismaService.quiz.findMany.mockResolvedValue([]);
    setState([{ lessonId: 'lesson-a', isCompleted: true, watchedPercentage: 90 }], []);

    const states = await service.getCourseLessonStates('course-1', 'student-1');

    expect(states.get('lesson-a')!.quizCompleted).toBe(true);
    expect(states.get('lesson-b')!.status).toBe('AVAILABLE');
    expect(mockPrismaService.quizAttempt.findMany).not.toHaveBeenCalled();
  });

  it('isLessonQuizCompleted returns true when no published quiz exists', async () => {
    mockPrismaService.quiz.findMany.mockReset();
    // Direct method uses quiz.findFirst — emulate via casting
    (service as any).prisma.quiz.findFirst = jest.fn().mockResolvedValue(null);

    await expect(
      service.isLessonQuizCompleted('student-1', 'lesson-a'),
    ).resolves.toBe(true);
  });
});
