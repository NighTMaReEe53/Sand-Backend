import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IStorageService, PresignedUploadResult } from './storage.interface';
import { LocalDiskStorageService } from './local-disk-storage.service';
import { S3StorageService } from './s3-storage.service';
import { CloudinaryStorageService } from './cloudinary-storage.service';

@Injectable()
export class StorageService implements IStorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly activeService: IStorageService;
  private readonly cloudinaryFallbackToLocal: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly localDiskService: LocalDiskStorageService,
    private readonly s3Service: S3StorageService,
    private readonly cloudinaryService: CloudinaryStorageService,
  ) {
    const driver = this.configService.get<string>('STORAGE_DRIVER', 'local').toLowerCase();
    this.cloudinaryFallbackToLocal =
      this.configService.get<string>('CLOUDINARY_FALLBACK_TO_LOCAL', 'true').toLowerCase() === 'true';

    if (driver === 's3') {
      this.logger.log('Active Storage Driver: S3 / Cloud Object Storage');
      this.activeService = this.s3Service;
    } else {
      this.logger.log('Active Storage Driver: Local Disk Storage');
      this.activeService = this.localDiskService;
    }
  }

  async uploadFile(
    file: { originalname: string; buffer: Buffer; mimetype: string },
    folder: string,
  ): Promise<string> {
    if (file.mimetype.startsWith('image/') && this.cloudinaryService.isEnabled()) {
      try {
        return await this.cloudinaryService.uploadFile(file, folder);
      } catch (error) {
        // CLOUDINARY_FALLBACK_TO_LOCAL is true by default — when Cloudinary is
        // unreachable or misconfigured (auth/quota/network), keep the upload
        // working by saving to the local disk instead of throwing.
        if (!this.cloudinaryFallbackToLocal) {
          throw error;
        }

        this.logger.warn(
          `Cloudinary image upload failed; falling back to local disk storage (${folder}). Reason: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return this.localDiskService.uploadFile(file, folder);
      }
    }
    return this.activeService.uploadFile(file, folder);
  }

  async generatePresignedUploadUrl(
    fileName: string,
    contentType: string,
    folder: string,
    expiresInSeconds = 900,
  ): Promise<PresignedUploadResult> {
    return this.activeService.generatePresignedUploadUrl(fileName, contentType, folder, expiresInSeconds);
  }

  async generateSignedDownloadUrl(
    fileUrlOrKey: string,
    expiresInSeconds = 600,
  ): Promise<string> {
    if (this.cloudinaryService.isManagedUrl(fileUrlOrKey)) {
      return this.cloudinaryService.generateSignedDownloadUrl(fileUrlOrKey, expiresInSeconds);
    }
    return this.activeService.generateSignedDownloadUrl(fileUrlOrKey, expiresInSeconds);
  }

  async deleteFile(fileUrlOrKey: string): Promise<boolean> {
    if (this.cloudinaryService.isManagedUrl(fileUrlOrKey)) {
      return this.cloudinaryService.deleteFile(fileUrlOrKey);
    }
    return this.activeService.deleteFile(fileUrlOrKey);
  }

  async fileExists(fileUrlOrKey: string): Promise<boolean> {
    if (this.cloudinaryService.isManagedUrl(fileUrlOrKey)) {
      return this.cloudinaryService.fileExists(fileUrlOrKey);
    }
    return this.activeService.fileExists(fileUrlOrKey);
  }
}
