export interface PresignedUploadResult {
  uploadUrl: string;
  fileUrl: string;
  key: string;
  expiresInSeconds: number;
}

export interface IStorageService {
  /**
   * رفع ملف مباشر (للصور والمستندات الصغيرة)
   */
  uploadFile(
    file: { originalname: string; buffer: Buffer; mimetype: string },
    folder: string,
  ): Promise<string>;

  /**
   * توليد Presigned URL للرفع المباشر من المتصفح (للفيديوهات الكبيرة حتى 500MB)
   */
  generatePresignedUploadUrl(
    fileName: string,
    contentType: string,
    folder: string,
    expiresInSeconds?: number,
  ): Promise<PresignedUploadResult>;

  /**
   * توليد رابط موقّع مؤقت للتحميل أو تشغيل الفيديو (Signed Streaming / Download URL)
   */
  generateSignedDownloadUrl(
    fileUrlOrKey: string,
    expiresInSeconds?: number,
  ): Promise<string>;

  /**
   * التحقق من وجود ملف وحذفه
   */
  deleteFile(fileUrlOrKey: string): Promise<boolean>;

  /**
   * التحقق من وجود الملف في وحدة التخزين
   */
  fileExists(fileUrlOrKey: string): Promise<boolean>;
}
