import {
  Controller,
  Put,
  Get,
  Req,
  Res,
  Query,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import { Public } from '../../common/decorators/public.decorator';
import { LocalDiskStorageService } from './local-disk-storage.service';

@ApiTags('Storage')
@Controller('storage')
export class StorageController {
  private readonly uploadDir: string;

  constructor(private readonly localDiskService: LocalDiskStorageService) {
    this.uploadDir = path.resolve(process.cwd(), 'uploads');
  }

  @Public()
  @Put('direct-upload')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Simulate Presigned direct file upload in local development' })
  async handleDirectUpload(
    @Query('key') key: string,
    @Query('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!key || !token) {
      throw new BadRequestException('بيانات رفع الملف غير مكتملة.');
    }

    const isValid = this.localDiskService.verifyToken(key, token);
    if (!isValid) {
      throw new UnauthorizedException('انتهت صلاحية رابط رفع الملف. يرجى المحاولة مرة أخرى.');
    }

    const targetPath = path.join(this.uploadDir, key);
    const targetFolder = path.dirname(targetPath);

    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }

    const writeStream = fs.createWriteStream(targetPath);
    req.pipe(writeStream);

    writeStream.on('finish', () => {
      res.status(200).json({ success: true, message: 'Direct upload completed successfully.' });
    });

    writeStream.on('error', (err) => {
      res.status(500).json({ success: false, message: err.message });
    });
  }

  @Public()
  @Get('stream')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Stream protected video or file via signed token' })
  async handleStream(
    @Query('key') key: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    if (!key || !token) {
      throw new BadRequestException('بيانات تحميل الملف غير مكتملة.');
    }

    const isValid = this.localDiskService.verifyToken(key, token);
    if (!isValid) {
      throw new UnauthorizedException('انتهت صلاحية رابط تحميل الملف. يرجى طلب رابط جديد.');
    }

    const filePath = path.join(this.uploadDir, key);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('الملف غير موجود على الخادم. يرجى إعادة رفعه من صفحة إدارة المنهج.');
    }

    res.sendFile(filePath);
  }
}
