import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';
import * as path from 'path';
import { IStorageService, PresignedUploadResult } from './storage.interface';

@Injectable()
export class S3StorageService implements IStorageService {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly publicUrl: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION', 'us-east-1');
    const endpoint = this.configService.get<string>('AWS_ENDPOINT'); // for MinIO/R2/Backblaze
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID', 'test');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY', 'test');

    this.bucketName = this.configService.get<string>('AWS_S3_BUCKET', 'elearning-bucket');
    this.publicUrl = this.configService.get<string>(
      'AWS_S3_PUBLIC_URL',
      `https://${this.bucketName}.s3.${region}.amazonaws.com`,
    );

    this.s3Client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: !!endpoint,
    });
  }

  async uploadFile(
    file: { originalname: string; buffer: Buffer; mimetype: string },
    folder: string,
  ): Promise<string> {
    const fileExt = path.extname(file.originalname);
    const uniqueKey = `${folder}/${crypto.randomUUID()}${fileExt}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: uniqueKey,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await this.s3Client.send(command);
    this.logger.log(`[S3Storage] Uploaded file to S3: ${uniqueKey}`);

    return `${this.publicUrl}/${uniqueKey}`;
  }

  async generatePresignedUploadUrl(
    fileName: string,
    contentType: string,
    folder: string,
    expiresInSeconds = 900, // 15 mins
  ): Promise<PresignedUploadResult> {
    const fileExt = path.extname(fileName);
    const uniqueKey = `${folder}/${crypto.randomUUID()}${fileExt}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: uniqueKey,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds,
    });

    const fileUrl = `${this.publicUrl}/${uniqueKey}`;

    return {
      uploadUrl,
      fileUrl,
      key: uniqueKey,
      expiresInSeconds,
    };
  }

  async generateSignedDownloadUrl(
    fileUrlOrKey: string,
    expiresInSeconds = 600, // 10 mins
  ): Promise<string> {
    if (!fileUrlOrKey) return '';

    if (this.isExternalVideoUrl(fileUrlOrKey)) {
      return fileUrlOrKey;
    }

    const key = this.extractKey(fileUrlOrKey);

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    return getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds,
    });
  }

  async deleteFile(fileUrlOrKey: string): Promise<boolean> {
    try {
      const key = this.extractKey(fileUrlOrKey);
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      this.logger.log(`[S3Storage] Deleted S3 object: ${key}`);
      return true;
    } catch (err: any) {
      this.logger.error(`[S3Storage] Failed to delete S3 object: ${err.message}`);
      return false;
    }
  }

  async fileExists(fileUrlOrKey: string): Promise<boolean> {
    try {
      const key = this.extractKey(fileUrlOrKey);
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      await this.s3Client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  private extractKey(urlOrKey: string): string {
    if (urlOrKey.startsWith(this.publicUrl)) {
      return urlOrKey.replace(`${this.publicUrl}/`, '');
    }
    return urlOrKey.replace(/^https?:\/\/[^/]+\//, '');
  }

  /** URLs issued by this storage service (including a custom R2 domain) stay signed. */
  private isExternalVideoUrl(url: string): boolean {
    const knownEmbed = ['youtube.com', 'youtu.be', 'vimeo.com'].some((host) => url.includes(host));
    return (
      knownEmbed ||
      (url.startsWith('http') && !url.startsWith(this.publicUrl) && !url.includes(this.bucketName))
    );
  }
}
