import { LeaderboardService } from './leaderboard.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { GamificationService } from '../gamification/gamification.service';

describe('LeaderboardService (Unit Tests)', () => {
  let service: LeaderboardService;

  const createdRows: any[] = [];

  const mockPrismaService = {
    exam: { findUnique: jest.fn() },
    examAttempt: { findMany: jest.fn() },
    examAchievement: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn((args: any) => {
        createdRows.push(args.data);
        return Promise.resolve(args.data);
      }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    studentProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    notification: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
  };

  const secondsAfter = (base: Date, seconds: number) =>
    new Date(base.getTime() + seconds * 1000);

  beforeEach(() => {
    jest.clearAllMocks();
    createdRows.length = 0;
    service = new LeaderboardService(
      mockPrismaService as unknown as PrismaService,
      { awardBadge: jest.fn(), recordActivity: jest.fn() } as unknown as GamificationService,
    );
    mockPrismaService.exam.findUnique.mockResolvedValue({ totalMarks: 100 });
    mockPrismaService.examAttempt.findMany.mockResolvedValue([]);
  });

  it('higher score → higher rank', async () => {
    const start = new Date('2026-01-01T10:00:00Z');
    mockPrismaService.examAttempt.findMany.mockResolvedValue([
      { studentId: 'a', score: 70, startedAt: start, submittedAt: secondsAfter(start, 120) },
      { studentId: 'b', score: 95, startedAt: start, submittedAt: secondsAfter(start, 500) },
    ]);

    await service.recomputeExamAchievements('exam-1');

    expect(createdRows[0]).toMatchObject({ rank: 1, medal: 'GOLD', studentId: 'b' });
    expect(createdRows[1]).toMatchObject({ rank: 2, medal: 'SILVER', studentId: 'a' });
  });

  it('same score + faster time → higher rank', async () => {
    const start = new Date('2026-01-01T10:00:00Z');
    mockPrismaService.examAttempt.findMany.mockResolvedValue([
      // same score 80 — 'fast' finished quicker
      { studentId: 'slow', score: 80, startedAt: start, submittedAt: secondsAfter(start, 700) },
      { studentId: 'fast', score: 80, startedAt: start, submittedAt: secondsAfter(start, 200) },
    ]);

    await service.recomputeExamAchievements('exam-1');

    expect(createdRows[0]).toMatchObject({ rank: 1, medal: 'GOLD', studentId: 'fast' });
    expect(createdRows[1]).toMatchObject({ rank: 2, medal: 'SILVER', studentId: 'slow' });
  });

  it('same score and time → earlier submission wins', async () => {
    const start = new Date('2026-01-01T10:00:00Z');
    mockPrismaService.examAttempt.findMany.mockResolvedValue([
      { studentId: 'late', score: 80, startedAt: start, submittedAt: secondsAfter(start, 300) },
      { studentId: 'early', score: 80, startedAt: start, submittedAt: secondsAfter(start, 300) },
    ].map((r) => ({ ...r })));

    // Force identical times by using same timestamps; 'early' has an earlier submittedAt
    mockPrismaService.examAttempt.findMany.mockResolvedValue([
      { studentId: 'late', score: 80, startedAt: start, submittedAt: new Date(start.getTime() + 400000) },
      { studentId: 'early', score: 80, startedAt: start, submittedAt: new Date(start.getTime() + 400000 - 100000) },
    ]);

    await service.recomputeExamAchievements('exam-1');

    expect(createdRows[0]).toMatchObject({ rank: 1, studentId: 'early' });
    expect(createdRows[1]).toMatchObject({ rank: 2, studentId: 'late' });
  });

  it('rank 4–10 appear without medals; only best attempt per student counts', async () => {
    const start = new Date('2026-01-01T10:00:00Z');
    const students = ['s1', 's2', 's3', 's4'];
    const attempts = [
      ...students.map((s, i) => ({
        studentId: s,
        score: 60 - i,
        startedAt: start,
        submittedAt: secondsAfter(start, 100 + i),
      })),
      // duplicate attempt for s1 with worse score — must be ignored
      { studentId: 's1', score: 10, startedAt: start, submittedAt: secondsAfter(start, 50) },
    ];
    mockPrismaService.examAttempt.findMany.mockResolvedValue(attempts);

    await service.recomputeExamAchievements('exam-1');

    expect(createdRows).toHaveLength(4);
    expect(createdRows[3]).toMatchObject({ rank: 4, medal: null, studentId: 's4' });
    expect(createdRows[0]).toMatchObject({ rank: 1, studentId: 's1', score: 60 });
  });

  it('percentage is clamped against exam totalMarks', async () => {
    const start = new Date('2026-01-01T10:00:00Z');
    mockPrismaService.examAttempt.findMany.mockResolvedValue([
      { studentId: 'a', score: 105, startedAt: start, submittedAt: secondsAfter(start, 60) },
    ]);

    await service.recomputeExamAchievements('exam-1');

    expect(createdRows[0]).toMatchObject({ percentage: 100, medal: 'GOLD' });
  });
});
