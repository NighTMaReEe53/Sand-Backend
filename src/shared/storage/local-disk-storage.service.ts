import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { IStorageService, PresignedUploadResult } from './storage.interface';

@Injectable()
export class LocalDiskStorageService implements IStorageService {
  private readonly logger = new Logger(LocalDiskStorageService.name);
  private readonly uploadDir: string;
  private readonly baseUrl: string;
  private readonly secretKey: string;

  constructor(private readonly configService: ConfigService) {
    this.uploadDir = path.resolve(process.cwd(), 'uploads');
    const port = this.configService.get<number>('PORT', 3000);
    this.baseUrl = this.configService.get<string>('STORAGE_BASE_URL', `http://localhost:${port}/uploads`);
    this.secretKey = this.configService.get<string>('JWT_ACCESS_SECRET', 'secret_storage_key_123');

    // Ensure uploads directory exists
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async uploadFile(
    file: { originalname: string; buffer: Buffer; mimetype: string },
    folder: string,
  ): Promise<string> {
    const targetFolder = path.join(this.uploadDir, folder);
    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }

    // ✅ استخدام الاسم المرسل مباشرةً (المحدد مسبقاً بـ UUID من المتصل)
    // بدل توليد UUID جديد يختلف عن المفتاح المحفوظ في DB
    const uniqueName = file.originalname;
    const fullPath = path.join(targetFolder, uniqueName);

    await fs.promises.writeFile(fullPath, file.buffer);
    this.logger.log(`[LocalStorage] File saved successfully: ${folder}/${uniqueName}`);

    return `${this.baseUrl}/${folder}/${uniqueName}`;
  }

  async generatePresignedUploadUrl(
    fileName: string,
    contentType: string,
    folder: string,
    expiresInSeconds = 900,
  ): Promise<PresignedUploadResult> {
    const fileExt = path.extname(fileName);
    const uniqueKey = `${folder}/${crypto.randomUUID()}${fileExt}`;
    const fileUrl = `${this.baseUrl}/${uniqueKey}`;

    // For local development, presigned upload endpoint simulated on local server
    const port = this.configService.get<number>('PORT', 3000);
    const token = this.generateToken(uniqueKey, expiresInSeconds);
    const uploadUrl = `http://localhost:${port}/api/v1/storage/direct-upload?key=${encodeURIComponent(uniqueKey)}&token=${token}`;

    return {
      uploadUrl,
      fileUrl,
      key: uniqueKey,
      expiresInSeconds,
    };
  }

  async generateSignedDownloadUrl(
    fileUrlOrKey: string,
    expiresInSeconds = 600, // 10 minutes default
  ): Promise<string> {
    if (!fileUrlOrKey) return '';

    // If it's a YouTube link, Vimeo, or external HTTP/HTTPS URL not hosted on local storage, return directly
    if (
      fileUrlOrKey.includes('youtube.com') ||
      fileUrlOrKey.includes('youtu.be') ||
      fileUrlOrKey.includes('vimeo.com') ||
      (fileUrlOrKey.startsWith('http') && !fileUrlOrKey.startsWith(this.baseUrl))
    ) {
      return fileUrlOrKey;
    }

    const key = this.extractKey(fileUrlOrKey);
    const token = this.generateToken(key, expiresInSeconds);
    const port = this.configService.get<number>('PORT', 3000);

    return `http://localhost:${port}/api/v1/storage/stream?key=${encodeURIComponent(key)}&token=${token}`;
  }

  async deleteFile(fileUrlOrKey: string): Promise<boolean> {
    try {
      const key = this.extractKey(fileUrlOrKey);
      const filePath = path.join(this.uploadDir, key);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        this.logger.log(`[LocalStorage] Deleted file: ${key}`);
        return true;
      }
      return false;
    } catch (err: any) {
      this.logger.error(`[LocalStorage] Failed to delete file: ${err.message}`);
      return false;
    }
  }

  async fileExists(fileUrlOrKey: string): Promise<boolean> {
    const key = this.extractKey(fileUrlOrKey);
    const filePath = path.join(this.uploadDir, key);
    return fs.existsSync(filePath);
  }

  verifyToken(key: string, token: string): boolean {
    try {
      const [expiresAtStr, hash] = token.split('.');
      const expiresAt = parseInt(expiresAtStr, 10);
      if (Date.now() > expiresAt) {
        return false;
      }
      const expectedHash = crypto
        .createHmac('sha256', this.secretKey)
        .update(`${key}:${expiresAtStr}`)
        .digest('hex');

      return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
    } catch {
      return false;
    }
  }

  private generateToken(key: string, expiresInSeconds: number): string {
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    const hash = crypto
      .createHmac('sha256', this.secretKey)
      .update(`${key}:${expiresAt}`)
      .digest('hex');

    return `${expiresAt}.${hash}`;
  }

  private extractKey(urlOrKey: string): string {
    if (urlOrKey.startsWith(this.baseUrl)) {
      return urlOrKey.replace(`${this.baseUrl}/`, '');
    }
    return urlOrKey.replace(/^https?:\/\/[^/]+\//, '').replace(/^uploads\//, '');
  }
}
