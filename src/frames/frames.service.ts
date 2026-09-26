import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../shared/prisma/prisma.service';
import { CoinsService } from '../coins/coins.service';

@Injectable()
export class FramesService {
  private readonly logger = new Logger(FramesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coinsService: CoinsService,
  ) {}

  async getShop() {
    return this.prisma.frame.findMany({
      where: { isPublished: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        cssStyle: true,
        price: true,
        sortOrder: true,
      },
    });
  }

  async buyFrame(userIdOrStudentId: string, frameId: string) {
    const studentId = await this.coinsService.resolveStudentId(userIdOrStudentId);
    const frame = await this.prisma.frame.findUnique({
      where: { id: frameId },
    });
    if (!frame || !frame.isPublished) {
      throw new NotFoundException('Frame not found.');
    }

    const existing = await this.prisma.studentFrame.findUnique({
      where: { studentId_frameId: { studentId, frameId } },
    });
    if (existing) {
      throw new ConflictException('You already own this frame.');
    }

    const success = await this.coinsService.spendCoins(
      studentId,
      frame.price,
      'SPEND_FRAME',
      frameId,
      `شراء إطار "${frame.name}"`,
    );
    if (!success) {
      throw new BadRequestException('Insufficient coins.');
    }

    await this.prisma.studentFrame.create({
      data: { studentId, frameId, isActive: false },
    });

    return {
      message: `تم شراء الإطار "${frame.name}" بنجاح.`,
      frame: {
        id: frame.id,
        name: frame.name,
        imageUrl: frame.imageUrl,
        cssStyle: frame.cssStyle,
        price: frame.price,
      },
    };
  }

  async getOwnedFrames(userIdOrStudentId: string) {
    const studentId = await this.coinsService.resolveStudentId(userIdOrStudentId);
    const owned = await this.prisma.studentFrame.findMany({
      where: { studentId },
      include: {
        frame: {
          select: { id: true, name: true, imageUrl: true, cssStyle: true, price: true },
        },
      },
      orderBy: { purchasedAt: 'desc' },
    });

    return owned.map((o) => ({
      ...o.frame,
      isOwned: true,
      isActive: o.isActive,
      purchasedAt: o.purchasedAt,
    }));
  }

  async setActiveFrame(userIdOrStudentId: string, frameId: string) {
    const studentId = await this.coinsService.resolveStudentId(userIdOrStudentId);
    const ownership = await this.prisma.studentFrame.findUnique({
      where: { studentId_frameId: { studentId, frameId } },
    });
    if (!ownership) {
      throw new NotFoundException('You do not own this frame.');
    }

    await this.prisma.$transaction([
      this.prisma.studentFrame.updateMany({
        where: { studentId },
        data: { isActive: false },
      }),
      this.prisma.studentFrame.update({
        where: { studentId_frameId: { studentId, frameId } },
        data: { isActive: true },
      }),
    ]);

    return { message: 'تم تفعيل الإطار بنجاح.' };
  }

  async removeActiveFrame(userIdOrStudentId: string) {
    const studentId = await this.coinsService.resolveStudentId(userIdOrStudentId);
    await this.prisma.studentFrame.updateMany({
      where: { studentId },
      data: { isActive: false },
    });
    return { message: 'تم إزالة الإطار.' };
  }

  // ─── Admin CRUD ───

  async createFrame(dto: { name: string; imageUrl?: string; cssStyle?: string; price: number; sortOrder?: number }) {
    return this.prisma.frame.create({
      data: {
        name: dto.name,
        imageUrl: dto.imageUrl ?? null,
        cssStyle: dto.cssStyle ?? null,
        price: dto.price,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateFrame(id: string, dto: Partial<{ name: string; imageUrl: string; cssStyle: string; price: number; isPublished: boolean; sortOrder: number }>) {
    const frame = await this.prisma.frame.findUnique({ where: { id } });
    if (!frame) throw new NotFoundException('Frame not found.');
    return this.prisma.frame.update({ where: { id }, data: dto });
  }

  async deleteFrame(id: string) {
    const frame = await this.prisma.frame.findUnique({ where: { id } });
    if (!frame) throw new NotFoundException('Frame not found.');
    return this.prisma.frame.update({ where: { id }, data: { isPublished: false } });
  }

  async getAllFrames() {
    return this.prisma.frame.findMany({ orderBy: { sortOrder: 'asc' } });
  }
}
