import { Injectable, NotFoundException } from '@nestjs/common';
import { DuaSubCategory } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

const DISMISSAL_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

/** Page-facing Dua sub-categories (post-activity pools are reserved for the Toast). */
const PAGE_DUA_SUBCATEGORIES: DuaSubCategory[] = [
  'EXAM',
  'STUDY',
  'GENERAL',
  'RELIEF',
];

const CONTEXT_POOLS: Record<string, DuaSubCategory[]> = {
  general: ['GENERAL', 'STUDY'],
  exam: ['EXAM'],
  'post-exam': ['POST_EXAM', 'RELIEF'],
  'post-lecture': ['POST_LECTURE'],
};

@Injectable()
export class AdhkarService {
  constructor(private readonly prisma: PrismaService) {}

  async getContent(category?: 'morning' | 'evening' | 'dua') {
    if (!category) {
      const [items, duas] = await Promise.all([
        this.prisma.adhkarItem.findMany({
          where: { isDeleted: false },
          orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
        }),
        this.prisma.duaItem.findMany({
          where: {
            isDeleted: false,
            subCategory: { in: PAGE_DUA_SUBCATEGORIES },
          },
          orderBy: [{ subCategory: 'asc' }, { sortOrder: 'asc' }],
        }),
      ]);
      return { items, duas };
    }

    if (category === 'dua') {
      const duas = await this.prisma.duaItem.findMany({
        where: {
          isDeleted: false,
          subCategory: { in: PAGE_DUA_SUBCATEGORIES },
        },
        orderBy: [{ subCategory: 'asc' }, { sortOrder: 'asc' }],
      });
      return { category, duas };
    }

    const where = category
      ? { isDeleted: false, category: category.toUpperCase() as 'MORNING' | 'EVENING' }
      : { isDeleted: false };

    const items = await this.prisma.adhkarItem.findMany({
      where,
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });

    return { items };
  }

  async getRandomDua(
    context: 'general' | 'exam' | 'post-exam' | 'post-lecture',
    excludeCodesCsv?: string,
  ) {
    const pool = CONTEXT_POOLS[context] ?? CONTEXT_POOLS.general;

    const excludeCodes = (excludeCodesCsv ?? '')
      .split(',')
      .map((code) => code.trim())
      .filter(Boolean);

    const duas = await this.prisma.duaItem.findMany({
      where: {
        isDeleted: false,
        subCategory: { in: pool },
        ...(excludeCodes.length > 0 ? { code: { notIn: excludeCodes } } : {}),
      },
    });

    // Fallback: if everything is excluded, retry without exclusions.
    const candidates =
      duas.length > 0
        ? duas
        : await this.prisma.duaItem.findMany({
            where: { isDeleted: false, subCategory: { in: pool } },
          });

    if (candidates.length === 0) {
      throw new NotFoundException('No Duas available for this context.');
    }

    const dua = candidates[Math.floor(Math.random() * candidates.length)];
    return { dua };
  }

  async getActiveDismissals(userId: string) {
    // Housekeeping: drop expired dismissals so the table stays small.
    await this.prisma.adhkarDismissal.deleteMany({
      where: { userId, reappearsAt: { lte: new Date() } },
    });

    const dismissals = await this.prisma.adhkarDismissal.findMany({
      where: { userId, reappearsAt: { gt: new Date() } },
      select: { itemId: true, dismissedAt: true, reappearsAt: true },
    });

    return { dismissals };
  }

  async dismiss(userId: string, itemId: string) {
    const item = await this.prisma.adhkarItem.findFirst({
      where: { id: itemId, isDeleted: false },
    });
    if (!item) {
      throw new NotFoundException('Adhkar item not found.');
    }

    const now = new Date();
    const reappearsAt = new Date(now.getTime() + DISMISSAL_DURATION_MS);

    await this.prisma.adhkarDismissal.upsert({
      where: { userId_itemId: { userId, itemId } },
      update: { dismissedAt: now, reappearsAt },
      create: { userId, itemId, dismissedAt: now, reappearsAt },
    });

    return { message: 'تم إخفاء الذكر لمدة 24 ساعة.', reappearsAt };
  }
}
