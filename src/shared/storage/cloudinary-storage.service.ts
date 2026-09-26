import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import * as path from 'path';
import { IStorageService, PresignedUploadResult } from './storage.interface';

/**
 * Stores image assets in Cloudinary. Videos deliberately stay on the active
 * object-storage driver (R2/S3), where the existing direct-upload flow is
 * supported and large uploads do not pass through the API server.
 */
@Injectable()
export class CloudinaryStorageService implements IStorageService {
  private readonly logger = new Logger(CloudinaryStorageService.name);
  private readonly enabled: boolean;
  private readonly cloudName: string;
  private readonly rootFolder: string;

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get<string>('CLOUDINARY_ENABLED', 'false').toLowerCase() === 'true';
    this.cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME', '');
    this.rootFolder = this.configService.get<string>('CLOUDINARY_FOLDER', 'elearning').replace(/^\/+|\/+$/g, '');

    if (!this.enabled) return;

    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY', '');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET', '');
    if (!this.cloudName || !apiKey || !apiSecret) {
      throw new Error('Cloudinary is enabled but CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, or CLOUDINARY_API_SECRET is missing.');
    }

    cloudinary.config({ cloud_name: this.cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    this.logger.log('Cloudinary image storage is enabled.');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isManagedUrl(fileUrl: string): boolean {
    return Boolean(fileUrl && this.cloudName && fileUrl.includes(`res.cloudinary.com/${this.cloudName}/`));
  }

  /** Only quota/plan exhaustion may safely fall back to local storage. */
  isCapacityError(error: unknown): boolean {
    const candidate = error as { message?: unknown; error?: { message?: unknown } } | undefined;
    const message = String(candidate?.error?.message ?? candidate?.message ?? '').toLowerCase();
    return [
      'quota',
      'credit',
      'storage quota',
      'bandwidth',
      'plan limit',
      'limit exceeded',
    ].some((phrase) => message.includes(phrase));
  }

  async uploadFile(
    file: { originalname: string; buffer: Buffer; mimetype: string },
    folder: string,
  ): Promise<string> {
    if (!this.enabled) throw new Error('Cloudinary image storage is not enabled.');

    const targetFolder = [this.rootFolder, folder].filter(Boolean).join('/');
    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: targetFolder,
          resource_type: 'image',
          use_filename: false,
          unique_filename: true,
          overwrite: false,
        },
        (error, uploadResult) => {
          if (error || !uploadResult) return reject(error ?? new Error('Cloudinary returned no upload result.'));
          resolve({ secure_url: uploadResult.secure_url });
        },
      );
      stream.end(file.buffer);
    });

    return result.secure_url;
  }

  async generatePresignedUploadUrl(): Promise<PresignedUploadResult> {
    throw new Error('Cloudinary is used for images only. Use R2/S3 direct upload for videos.');
  }

  async generateSignedDownloadUrl(
    fileUrlOrKey: string,
    _expiresInSeconds = 600,
  ): Promise<string> {
    return fileUrlOrKey;
  }

  async deleteFile(fileUrlOrKey: string): Promise<boolean> {
    try {
      const publicId = this.extractPublicId(fileUrlOrKey);
      if (!publicId) return false;
      const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
      return result.result === 'ok' || result.result === 'not found';
    } catch (error: any) {
      this.logger.error(`Failed to delete Cloudinary asset: ${error?.message ?? 'unknown error'}`);
      return false;
    }
  }

  async fileExists(fileUrlOrKey: string): Promise<boolean> {
    try {
      const publicId = this.extractPublicId(fileUrlOrKey);
      if (!publicId) return false;
      await cloudinary.api.resource(publicId, { resource_type: 'image' });
      return true;
    } catch {
      return false;
    }
  }

  private extractPublicId(fileUrlOrKey: string): string | null {
    if (!this.isManagedUrl(fileUrlOrKey)) return null;
    const marker = '/image/upload/';
    const markerIndex = fileUrlOrKey.indexOf(marker);
    if (markerIndex < 0) return null;

    let assetPath = fileUrlOrKey.slice(markerIndex + marker.length).split('?')[0];
    assetPath = assetPath.replace(/^v\d+\//, '');
    return assetPath ? assetPath.slice(0, -path.extname(assetPath).length) : null;
  }
}
