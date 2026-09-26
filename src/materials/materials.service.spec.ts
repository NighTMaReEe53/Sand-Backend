import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EnrollmentStatus, MaterialType, Role } from '@prisma/client';
import { MaterialsService } from './materials.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { StorageService } from '../shared/storage/storage.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('MaterialsService', () => {
  let service: MaterialsService;
  let prisma: PrismaService;
  let storageService: StorageService;

  const mockTeacherUser: AuthenticatedUser = {
    id: 'teacher-user-1',
    role: Role.TEACHER,
    email: 'teacher@test.com',
    phone: '01000000001',
    isVerified: true,
  };

  const mockNonOwnerTeacher: AuthenticatedUser = {
    id: 'teacher-user-2',
    role: Role.TEACHER,
    email: 'otherteacher@test.com',
    phone: '01000000002',
    isVerified: true,
  };

  const mockStudentUser: AuthenticatedUser = {
    id: 'student-user-1',
    role: Role.STUDENT,
    email: 'student@test.com',
    phone: '01000000003',
    isVerified: true,
  };

  const mockPrismaService = {
    course: {
      findUnique: jest.fn(),
    },
    section: {
      findFirst: jest.fn().mockResolvedValue({ id: 'section-uuid' }),
      create: jest.fn().mockResolvedValue({ id: 'section-uuid' }),
    },
    courseMaterial: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    studentProfile: {
      findUnique: jest.fn(),
    },
    enrollment: {
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  const mockStorageService = {
    uploadFile: jest.fn().mockResolvedValue('courses/course-1/materials/test.pdf'),
    generateSignedDownloadUrl: jest.fn().mockResolvedValue('https://storage.local/stream?key=abc&token=xyz'),
    deleteFile: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaterialsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    service = module.get<MaterialsService>(MaterialsService);
    prisma = module.get<PrismaService>(PrismaService);
    storageService = module.get<StorageService>(StorageService);
    jest.clearAllMocks();
  });

  describe('Magic Bytes & File Validation', () => {
    const courseId = 'course-uuid-1';

    beforeEach(() => {
      mockPrismaService.course.findUnique.mockResolvedValue({
        id: courseId,
        isDeleted: false,
        teacher: { userId: mockTeacherUser.id },
      });
    });

    it('should reject executable file (.exe) disguised as .pdf', async () => {
      // MZ header for PE/EXE
      const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
      const fakePdf = {
        originalname: 'malicious.pdf',
        buffer: exeBuffer,
        mimetype: 'application/pdf',
      } as Express.Multer.File;

      await expect(
        service.uploadMaterial(courseId, mockTeacherUser, { title: 'Chapter 1' }, fakePdf),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject executable file (.exe) disguised as .pptx', async () => {
      const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
      const fakePptx = {
        originalname: 'presentation.pptx',
        buffer: exeBuffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      } as Express.Multer.File;

      await expect(
        service.uploadMaterial(courseId, mockTeacherUser, { title: 'Slides' }, fakePptx),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject plain text file (.txt) disguised as .doc', async () => {
      const txtBuffer = Buffer.from('This is a plain text file, not a doc');
      const fakeDoc = {
        originalname: 'notes.doc',
        buffer: txtBuffer,
        mimetype: 'application/msword',
      } as Express.Multer.File;

      await expect(
        service.uploadMaterial(courseId, mockTeacherUser, { title: 'Notes' }, fakeDoc),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept valid PDF file (%PDF- header)', async () => {
      const validPdfBuffer = Buffer.from('%PDF-1.5 fake pdf content data stream');
      const realPdf = {
        originalname: 'summary.pdf',
        buffer: validPdfBuffer,
        mimetype: 'application/pdf',
      } as Express.Multer.File;

      mockPrismaService.courseMaterial.create.mockResolvedValue({
        id: 'mat-1',
        courseId,
        title: 'Summary PDF',
        fileType: MaterialType.PDF,
        fileSizeBytes: validPdfBuffer.length,
      });

      const result = await service.uploadMaterial(
        courseId,
        mockTeacherUser,
        { title: 'Summary PDF' },
        realPdf,
      );

      expect(result.id).toBe('mat-1');
      expect(mockPrismaService.courseMaterial.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fileType: MaterialType.PDF,
            fileSizeBytes: validPdfBuffer.length,
          }),
        }),
      );
    });

    it('should accept valid PPTX file (Zip PK header)', async () => {
      const validPptxBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
      const realPptx = {
        originalname: 'lecture1.pptx',
        buffer: validPptxBuffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      } as Express.Multer.File;

      mockPrismaService.courseMaterial.create.mockResolvedValue({
        id: 'mat-pptx',
        courseId,
        title: 'Lecture 1 Slides',
        fileType: MaterialType.PPTX,
      });

      const result = await service.uploadMaterial(
        courseId,
        mockTeacherUser,
        { title: 'Lecture 1 Slides' },
        realPptx,
      );

      expect(result.id).toBe('mat-pptx');
      expect(mockPrismaService.courseMaterial.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fileType: MaterialType.PPTX,
          }),
        }),
      );
    });

    it('should accept valid DOCX file (Zip PK header)', async () => {
      const validDocxBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
      const realDocx = {
        originalname: 'homework.docx',
        buffer: validDocxBuffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      } as Express.Multer.File;

      mockPrismaService.courseMaterial.create.mockResolvedValue({
        id: 'mat-docx',
        courseId,
        title: 'Homework 1',
        fileType: MaterialType.DOC,
      });

      const result = await service.uploadMaterial(
        courseId,
        mockTeacherUser,
        { title: 'Homework 1' },
        realDocx,
      );

      expect(result.id).toBe('mat-docx');
      expect(mockPrismaService.courseMaterial.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fileType: MaterialType.DOC,
          }),
        }),
      );
    });
  });

  describe('Course Ownership Verification', () => {
    const courseId = 'course-uuid-1';

    it('should throw ForbiddenException if teacher is not the owner on upload', async () => {
      mockPrismaService.course.findUnique.mockResolvedValue({
        id: courseId,
        isDeleted: false,
        teacher: { userId: 'different-teacher-id' },
      });
      mockPrismaService.user.findUnique.mockResolvedValue({ role: Role.TEACHER });

      const validPdfBuffer = Buffer.from('%PDF-1.5 test');
      const file = {
        originalname: 'test.pdf',
        buffer: validPdfBuffer,
        mimetype: 'application/pdf',
      } as Express.Multer.File;

      await expect(
        service.uploadMaterial(courseId, mockNonOwnerTeacher, { title: 'Test' }, file),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if teacher is not the owner on delete', async () => {
      mockPrismaService.courseMaterial.findUnique.mockResolvedValue({
        id: 'mat-1',
        deletedAt: null,
        course: {
          id: courseId,
          isDeleted: false,
          teacher: { userId: 'different-teacher-id' },
        },
      });

      await expect(service.deleteMaterial('mat-1', mockNonOwnerTeacher)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getCourseMaterials (Explicit Guard)', () => {
    const courseId = 'course-uuid-1';

    beforeEach(() => {
      mockPrismaService.course.findUnique.mockResolvedValue({
        id: courseId,
        isDeleted: false,
        teacher: { userId: mockTeacherUser.id },
      });
    });

    it('should return materials without raw fileUrl for teacher owner', async () => {
      mockPrismaService.courseMaterial.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          title: 'Notes',
          description: 'Desc',
          fileType: MaterialType.PDF,
          fileSizeBytes: 1024,
          createdAt: new Date(),
        },
      ]);

      const result = await service.getCourseMaterials(courseId, mockTeacherUser);
      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('fileUrl');
    });

    it('should return materials for active enrolled student', async () => {
      mockPrismaService.studentProfile.findUnique.mockResolvedValue({
        id: 'student-profile-1',
        userId: mockStudentUser.id,
      });
      mockPrismaService.enrollment.findFirst.mockResolvedValue({
        id: 'enroll-1',
        status: EnrollmentStatus.ACTIVE,
      });
      mockPrismaService.courseMaterial.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          title: 'Notes',
          fileType: MaterialType.PDF,
          fileSizeBytes: 1024,
        },
      ]);

      const result = await service.getCourseMaterials(courseId, mockStudentUser);
      expect(result).toHaveLength(1);
    });

    it('should throw ForbiddenException for non-enrolled student or pending enrollment', async () => {
      mockPrismaService.studentProfile.findUnique.mockResolvedValue({
        id: 'student-profile-1',
        userId: mockStudentUser.id,
      });
      mockPrismaService.enrollment.findFirst.mockResolvedValue(null); // Not active

      await expect(service.getCourseMaterials(courseId, mockStudentUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException for non-owner teacher', async () => {
      await expect(service.getCourseMaterials(courseId, mockNonOwnerTeacher)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getSecureDownloadUrl', () => {
    const materialId = 'mat-uuid-1';
    const courseId = 'course-uuid-1';

    beforeEach(() => {
      mockPrismaService.courseMaterial.findUnique.mockResolvedValue({
        id: materialId,
        title: 'ملخص الباب الأول',
        fileUrl: 'courses/course-uuid-1/materials/uuid-123.pdf',
        fileType: MaterialType.PDF,
        deletedAt: null,
        course: {
          id: courseId,
          isDeleted: false,
          teacher: { userId: mockTeacherUser.id },
        },
      });
    });

    it('should generate signed download URL for teacher owner', async () => {
      const result = await service.getSecureDownloadUrl(materialId, mockTeacherUser);
      expect(result.downloadUrl).toBeDefined();
      expect(result.expiresInSeconds).toBe(300);
      expect(result.fileName).toContain('.pdf');
      expect(mockStorageService.generateSignedDownloadUrl).toHaveBeenCalledWith(
        'courses/course-uuid-1/materials/uuid-123.pdf',
        300,
      );
    });

    it('should generate signed download URL for active enrolled student', async () => {
      mockPrismaService.studentProfile.findUnique.mockResolvedValue({
        id: 'student-profile-1',
        userId: mockStudentUser.id,
      });
      mockPrismaService.enrollment.findFirst.mockResolvedValue({
        id: 'enroll-1',
        status: EnrollmentStatus.ACTIVE,
      });

      const result = await service.getSecureDownloadUrl(materialId, mockStudentUser);
      expect(result.downloadUrl).toBeDefined();
      expect(result.expiresInSeconds).toBe(300);
    });

    it('should throw ForbiddenException if student is NOT active', async () => {
      mockPrismaService.studentProfile.findUnique.mockResolvedValue({
        id: 'student-profile-1',
        userId: mockStudentUser.id,
      });
      mockPrismaService.enrollment.findFirst.mockResolvedValue(null);

      await expect(service.getSecureDownloadUrl(materialId, mockStudentUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException if material is soft-deleted', async () => {
      mockPrismaService.courseMaterial.findUnique.mockResolvedValue({
        id: materialId,
        deletedAt: new Date(),
      });

      await expect(service.getSecureDownloadUrl(materialId, mockTeacherUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteMaterial (Soft Delete)', () => {
    it('should soft delete material by setting deletedAt', async () => {
      mockPrismaService.courseMaterial.findUnique.mockResolvedValue({
        id: 'mat-1',
        deletedAt: null,
        course: {
          id: 'course-1',
          isDeleted: false,
          teacher: { userId: mockTeacherUser.id },
        },
      });

      const result = await service.deleteMaterial('mat-1', mockTeacherUser);
      expect(result.message).toBe('Material deleted successfully.');
      expect(mockPrismaService.courseMaterial.update).toHaveBeenCalledWith({
        where: { id: 'mat-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });
});
