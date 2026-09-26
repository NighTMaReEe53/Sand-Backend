import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { LocalDiskStorageService } from './local-disk-storage.service';
import { S3StorageService } from './s3-storage.service';
import { CloudinaryStorageService } from './cloudinary-storage.service';
import { StorageController } from './storage.controller';

@Global()
@Module({
  controllers: [StorageController],
  providers: [StorageService, LocalDiskStorageService, S3StorageService, CloudinaryStorageService],
  exports: [StorageService, LocalDiskStorageService, S3StorageService, CloudinaryStorageService],
})
export class StorageModule {}
