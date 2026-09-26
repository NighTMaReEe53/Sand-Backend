import { Injectable, Logger } from '@nestjs/common';
import { CoinTxType } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class CoinsService {
  private readonly logger = new Logger(CoinsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Resolves a userId or studentProfileId to the actual studentProfile.id
   */
  async resolveStudentId(userIdOrStudentId: string): Promise<string> {
    const profile = await this.prisma.studentProfile.findFirst({
      where: {
        OR: [{ id: userIdOrStudentId }, { userId: userIdOrStudentId }],
      },
      select: { id: true },
    });
    return profile ? profile.id : userIdOrStudentId;
  }

  /**
   * Get or create coin wallet for a student
   */
  async getOrCreateWallet(studentId: string) {
    const resolvedId = await this.resolveStudentId(studentId);
    return this.prisma.studentCoin.upsert({
      where: { studentId: resolvedId },
      create: { studentId: resolvedId, balance: 0 },
      update: {},
    });
  }

  /**
   * Get coin balance for a student
   */
  async getBalance(studentId: string) {
    const wallet = await this.getOrCreateWallet(studentId);
    return { balance: wallet.balance };
  }

  /** Human-readable label for each coin transaction type */
  private coinLabel(type: CoinTxType): string {
    switch (type) {
      case 'EARN_LESSON': return 'مشاهدة درس';
      case 'EARN_QUIZ': return 'اجتياز كويز';
      case 'EARN_HOMEWORK': return 'حل واجب';
      case 'EARN_EXAM': return 'اجتياز امتحان';
      case 'SPEND_AVATAR': return 'شراء أفاتار';
      case 'SPEND_FRAME': return 'شراء إطار';
      default: return 'عملة';
    }
  }

  /**
   * Add coins to a student (fire-and-forget, never breaks main flow).
   * Also sends a notification to the student so they know they earned coins.
   */
  async addCoins(
    studentId: string,
    amount: number,
    type: CoinTxType,
    referenceId?: string,
    description?: string,
  ) {
    if (amount <= 0) return;
    try {
      const resolvedId = await this.resolveStudentId(studentId);
      await this.prisma.$transaction([
        this.prisma.studentCoin.upsert({
          where: { studentId: resolvedId },
          create: { studentId: resolvedId, balance: amount },
          update: { balance: { increment: amount } },
        }),
        this.prisma.coinTransaction.create({
          data: {
            studentId: resolvedId,
            amount,
            type,
            referenceId: referenceId ?? null,
            description: description ?? null,
          },
        }),
      ]);
      this.logger.log(`+${amount} coins for student ${resolvedId} (${type})`);

      // Send a notification to the student about the earned coins
      const profile = await this.prisma.studentProfile.findUnique({
        where: { id: resolvedId },
        select: { userId: true },
      });
      if (profile) {
        const label = this.coinLabel(type);
        await this.notificationsService.notify({
          userId: profile.userId,
          type: 'ACHIEVEMENT_EARNED',
          title: `حصلت على ${amount} عملة ${label}`,
          body: description
            ? `حصلت على ${amount} عملة مقابل ${description}. ${label} ✓`
            : `حصلت على ${amount} عملة مقابل ${label}.`,
          linkUrl: '/profile',
        }).catch(() => undefined);
      }
    } catch (error) {
      this.logger.error(`addCoins failed: ${error}`);
    }
  }

  /**
   * Spend coins (buy avatar etc.)
   */
  async spendCoins(
    studentId: string,
    amount: number,
    type: CoinTxType,
    referenceId?: string,
    description?: string,
  ) {
    if (amount <= 0) return false;
    try {
      const resolvedId = await this.resolveStudentId(studentId);
      const wallet = await this.getOrCreateWallet(resolvedId);
      if (wallet.balance < amount) return false;

      await this.prisma.$transaction([
        this.prisma.studentCoin.update({
          where: { studentId: resolvedId },
          data: { balance: { decrement: amount } },
        }),
        this.prisma.coinTransaction.create({
          data: {
            studentId: resolvedId,
            amount: -amount,
            type,
            referenceId: referenceId ?? null,
            description: description ?? null,
          },
        }),
      ]);
      this.logger.log(`-${amount} coins for student ${resolvedId} (${type})`);
      return true;
    } catch (error) {
      this.logger.error(`spendCoins failed: ${error}`);
      return false;
    }
  }

  /**
   * Get coin transaction history
   */
  async getTransactions(studentId: string, page = 1, limit = 20) {
    const resolvedId = await this.resolveStudentId(studentId);
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      this.prisma.coinTransaction.findMany({
        where: { studentId: resolvedId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.coinTransaction.count({
        where: { studentId: resolvedId },
      }),
    ]);

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
