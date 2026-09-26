import { BadRequestException } from '@nestjs/common';
import { MaterialType } from '@prisma/client';
import * as path from 'path';

export interface ValidatedMaterialFile {
  fileType: MaterialType;
  detectedMime: string;
}

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
]);

/**
 * فحص الـ Magic Bytes للتحقق من النوع الحقيقي للملف ومنع الملفات التنفيذية المتنكرة
 */
export function validateAndDetectMaterialFile(
  file: Express.Multer.File | { originalname: string; buffer: Buffer; mimetype?: string },
): ValidatedMaterialFile {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new BadRequestException('No file provided or file is empty.');
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new BadRequestException(
      `File extension "${ext}" is not supported. Allowed extensions: .pdf, .doc, .docx, .ppt, .pptx`,
    );
  }

  const buffer = file.buffer;

  // 1. فحص توقيع الملفات التنفيذية (MZ / PE أو ELF) ومنعها فوراً
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    throw new BadRequestException(
      'Executable files (.exe / DLL) disguised with document extensions are strictly prohibited.',
    );
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  ) {
    throw new BadRequestException('Executable binary files are strictly prohibited.');
  }

  // 2. التحقق من PDF: يبدأ بـ %PDF- (0x25, 0x50, 0x44, 0x46)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    if (ext !== '.pdf') {
      throw new BadRequestException(`File is a PDF but has extension "${ext}". Extension must be .pdf`);
    }
    return { fileType: MaterialType.PDF, detectedMime: 'application/pdf' };
  }

  // 3. التحقق من ZIP Container (DOCX أو PPTX): يبدأ بـ PK.. (0x50, 0x4B, 0x03, 0x04 أو 0x50, 0x4B, 0x05, 0x06 أو 0x50, 0x4B, 0x07, 0x08)
  const isZip =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08);

  if (isZip) {
    if (ext === '.pptx') {
      return {
        fileType: MaterialType.PPTX,
        detectedMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      };
    }
    if (ext === '.docx') {
      return {
        fileType: MaterialType.DOC,
        detectedMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
    }
    throw new BadRequestException(
      `ZIP-based document detected but extension "${ext}" is neither .pptx nor .docx.`,
    );
  }

  // 4. التحقق من ملفات مايكروسوفت الثنائية القديمة (OLE2 compound binary: DOC / PPT)
  // Magic bytes: 0xD0 0xCF 0x11 0xE0 0xA1 0xB1 0x1A 0xE1
  const isOle2 =
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1;

  if (isOle2) {
    if (ext === '.ppt') {
      return { fileType: MaterialType.PPTX, detectedMime: 'application/vnd.ms-powerpoint' };
    }
    if (ext === '.doc') {
      return { fileType: MaterialType.DOC, detectedMime: 'application/msword' };
    }
    throw new BadRequestException(`OLE2 document detected but extension "${ext}" is not .doc or .ppt.`);
  }

  // 5. التحقق من الصور: JPEG / PNG / WEBP عبر الـ Magic Bytes
  // JPEG: FF D8 FF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    if (ext === '.jpg' || ext === '.jpeg') {
      return { fileType: MaterialType.IMAGE, detectedMime: 'image/jpeg' };
    }
    throw new BadRequestException(`File is a JPEG image but has extension "${ext}".`);
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    if (ext === '.png') {
      return { fileType: MaterialType.IMAGE, detectedMime: 'image/png' };
    }
    throw new BadRequestException(`File is a PNG image but has extension "${ext}".`);
  }
  // WEBP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    if (ext === '.webp') {
      return { fileType: MaterialType.IMAGE, detectedMime: 'image/webp' };
    }
    throw new BadRequestException(`File is a WEBP image but has extension "${ext}".`);
  }

  // إذا وصل إلى هنا: الملف لا يطابق أي توقيع ثنائي مسموح (مثلاً ملف نصي عادي .txt متنكر بامتداد .doc أو .pdf أو ملف غير صالح)
  throw new BadRequestException(
    `Invalid file content: The file header does not match valid PDF, Word, PowerPoint, or image files.`,
  );
}
