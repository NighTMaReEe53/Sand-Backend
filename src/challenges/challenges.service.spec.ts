import { ChallengesService } from './challenges.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('ChallengesService — winner logic (Unit Tests)', () => {
  let service: ChallengesService;

  beforeEach(() => {
    service = new ChallengesService(
      {} as unknown as PrismaService,
      {} as unknown as NotificationsService,
    );
  });

  const p = (studentId: string, score: number, timeTakenSeconds: number | null) => ({
    studentId,
    score,
    timeTakenSeconds,
  });

  it('highest score wins', () => {
    expect(
      (service as any).determineWinner([p('a', 8, 300), p('b', 6, 100)]),
    ).toBe('a');
  });

  it('tied scores → lowest time wins', () => {
    expect(
      (service as any).determineWinner([p('a', 7, 400), p('b', 7, 250)]),
    ).toBe('b');
  });

  it('tied scores and times → draw (null)', () => {
    expect(
      (service as any).determineWinner([p('a', 7, 300), p('b', 7, 300)]),
    ).toBeNull();
  });
});
