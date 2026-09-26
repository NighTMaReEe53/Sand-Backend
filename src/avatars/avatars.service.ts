import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { CoinsService } from '../coins/coins.service';

@Injectable()
export class AvatarsService {
  private readonly logger = new Logger(AvatarsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coinsService: CoinsService,
  ) {}

  /**
   * Get all published avatars (shop)
   */
  async getShop() {
    return this.prisma.avatar.findMany({
      where: { isPublished: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        price: true,
        sortOrder: true,
      },
    });
  }

  /**
   * Buy an avatar
   */
  async buyAvatar(userIdOrStudentId: string, avatarId: string) {
    const studentId = await this.coinsService.resolveStudentId(userIdOrStudentId);
    const avatar = await this.prisma.avatar.findUnique({
      where: { id: avatarId },
    });
    if (!avatar || !avatar.isPublished) {
      throw new NotFoundException('Avatar not found.');
    }

    // Check if already owned
    const existing = await this.prisma.studentAvatar.findUnique({
      where: { studentId_avatarId: { studentId, avatarId } },
    });
    if (existing) {
      throw new ConflictException('You already own this avatar.');
    }

    // Try to spend coins
    const success = await this.coinsService.spendCoins(
      studentId,
      avatar.price,
      'SPEND_AVATAR',
      avatarId,
      `شراء أفاتار "${avatar.name}"`,
    );
    if (!success) {
      throw new BadRequestException('Insufficient coins.');
    }

    // Grant avatar
    await this.prisma.studentAvatar.create({
      data: { studentId, avatarId, isActive: false },
    });

    return {
      message: `تم شراء أفاتار "${avatar.name}" بنجاح.`,
      avatar: {
        id: avatar.id,
        name: avatar.name,
        imageUrl: avatar.imageUrl,
        price: avatar.price,
      },
    };
  }

  /**
   * Get student's owned avatars with active status
   */
  async getOwnedAvatars(userIdOrStudentId: string) {
    const studentId = await this.coinsService.resolveStudentId(userIdOrStudentId);
    const owned = await this.prisma.studentAvatar.findMany({
      where: { studentId },
      include: {
        avatar: {
          select: { id: true, name: true, imageUrl: true, price: true },
        },
      },
      orderBy: { purchasedAt: 'desc' },
    });

    return owned.map((o) => ({
      ...o.avatar,
      isOwned: true,
      isActive: o.isActive,
      purchasedAt: o.purchasedAt,
    }));
  }

  /**
   * Set active avatar
   */
  async setActiveAvatar(userIdOrStudentId: string, avatarId: string) {
    const studentId = await this.coinsService.resolveStudentId(userIdOrStudentId);
    // Verify ownership
    const ownership = await this.prisma.studentAvatar.findUnique({
      where: { studentId_avatarId: { studentId, avatarId } },
    });
    if (!ownership) {
      throw new NotFoundException('You do not own this avatar.');
    }

    // Deactivate all current avatars, activate the selected one
    await this.prisma.$transaction([
      this.prisma.studentAvatar.updateMany({
        where: { studentId },
        data: { isActive: false },
      }),
      this.prisma.studentAvatar.update({
        where: { studentId_avatarId: { studentId, avatarId } },
        data: { isActive: true },
      }),
    ]);

    // Update the student profile photoUrl to the avatar's imageUrl
    const avatar = await this.prisma.avatar.findUnique({
      where: { id: avatarId },
      select: { imageUrl: true },
    });
    if (avatar?.imageUrl) {
      await this.prisma.studentProfile.update({
        where: { id: studentId },
        data: { photoUrl: avatar.imageUrl },
      });
    }

    return {
      message: 'تم تفعيل الأفاتار بنجاح.',
      photoUrl: avatar?.imageUrl ?? null,
      avatarId,
    };
  }

  /**
   * Remove active avatar (go back to default)
   */
  async removeActiveAvatar(userIdOrStudentId: string) {
    const studentId = await this.coinsService.resolveStudentId(userIdOrStudentId);
    await this.prisma.studentAvatar.updateMany({
      where: { studentId },
      data: { isActive: false },
    });
    await this.prisma.studentProfile.update({
      where: { id: studentId },
      data: { photoUrl: null },
    });
    return { message: 'تم إزالة الأفاتار.', photoUrl: null };
  }

  // ─── Admin CRUD ───

  async createAvatar(dto: { name: string; imageUrl?: string; imageKey?: string; price: number; sortOrder?: number }) {
    return this.prisma.avatar.create({
      data: {
        name: dto.name,
        imageUrl: dto.imageUrl ?? null,
        imageKey: dto.imageKey ?? null,
        price: dto.price,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateAvatar(id: string, dto: Partial<{ name: string; imageUrl: string; imageKey: string; price: number; isPublished: boolean; sortOrder: number }>) {
    const avatar = await this.prisma.avatar.findUnique({ where: { id } });
    if (!avatar) throw new NotFoundException('Avatar not found.');
    return this.prisma.avatar.update({ where: { id }, data: dto });
  }

  async deleteAvatar(id: string) {
    const avatar = await this.prisma.avatar.findUnique({ where: { id } });
    if (!avatar) throw new NotFoundException('Avatar not found.');
    // Soft: just unpublish
    return this.prisma.avatar.update({ where: { id }, data: { isPublished: false } });
  }

  async getAllAvatars() {
    return this.prisma.avatar.findMany({ orderBy: { sortOrder: 'asc' } });
  }
}
