import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class OrphanedFilesCleanupService {
  private readonly logger = new Logger(OrphanedFilesCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * يعمل يومياً عند منتصف الليل لتنظيف الملفات اليتيمة المحذوفة منذ أكثر من 30 يوماً
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupOrphanedFiles() {
    this.logger.log('Starting scheduled orphaned files cleanup job...');

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    try {
      // 1. تنظيف ملفات المواد المحذوفة
      const deletedMaterials = await this.prisma.courseMaterial.findMany({
        where: {
          deletedAt: { not: null, lt: thirtyDaysAgo },
        },
      });

      for (const material of deletedMaterials) {
        if (material.fileUrl) {
          await this.storageService.deleteFile(material.fileUrl);
          this.logger.log(`Deleted orphaned material file: ${material.fileUrl}`);
        }
      }

      // 2. تنظيف فيديوهات الدروس المحذوفة
      const deletedLessons = await this.prisma.lesson.findMany({
        where: {
          isDeleted: true,
          updatedAt: { lt: thirtyDaysAgo },
        },
      });

      for (const lesson of deletedLessons) {
        if (lesson.videoUrl) {
          await this.storageService.deleteFile(lesson.videoUrl);
          this.logger.log(`Deleted orphaned lesson video: ${lesson.videoUrl}`);
        }
      }

      this.logger.log('Orphaned files cleanup completed successfully.');
    } catch (err: any) {
      this.logger.error(`Error during orphaned files cleanup: ${err.message}`);
    }
  }
}
