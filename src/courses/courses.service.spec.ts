import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CourseStatus, GradeLevel, Role } from '@prisma/client';
import { CoursesService } from './courses.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { StorageService } from '../shared/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TaxonomyService } from '../taxonomy/taxonomy.service';

describe('CoursesService (Unit Tests)', () => {
  let service: CoursesService;
  let prisma: PrismaService;

  const mockPrismaService = {
    teacherProfile: {
      findUnique: jest.fn(),
    },
    studentProfile: {
      findUnique: jest.fn(),
    },
    course: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    lesson: {
      updateMany: jest.fn(),
    },
    courseMaterial: {
      updateMany: jest.fn(),
    },
    enrollment: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoursesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: { uploadFile: jest.fn().mockResolvedValue('url'), deleteFile: jest.fn().mockResolvedValue(undefined), getSignedUrl: jest.fn().mockResolvedValue('signed') } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifyMany: jest.fn().mockResolvedValue(undefined) } },
        { provide: TaxonomyService, useValue: { validateGradeLevel: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    service = module.get<CoursesService>(CoursesService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('createCourse', () => {
    it('should create a course with DRAFT status by default', async () => {
      mockPrismaService.teacherProfile.findUnique.mockResolvedValue({ id: 'teacher-1' });
      mockPrismaService.course.create.mockResolvedValue({
        id: 'course-1',
        title: 'Biology 101',
        status: CourseStatus.DRAFT,
      });

      const result = await service.createCourse('user-teacher-id', {
        title: 'Biology 101',
        description: 'Comprehensive biology course for secondary school.',
        gradeLevel: GradeLevel.SEC_3_SCIENTIFIC,
      });

      expect(mockPrismaService.teacherProfile.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-teacher-id' },
      });
      expect(result.id).toBe('course-1');
    });

    it('should throw ForbiddenException if teacher profile does not exist', async () => {
      mockPrismaService.teacherProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.createCourse('non-teacher-id', {
          title: 'Math',
          description: 'Math course description here.',
          gradeLevel: GradeLevel.SEC_1,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('enrollFreeCourse', () => {
    const courseId = 'course-free-1';
    const studentUserId = 'user-student-1';

    it('should enroll student in free published course successfully', async () => {
      mockPrismaService.course.findUnique.mockResolvedValue({
        id: courseId,
        status: CourseStatus.PUBLISHED,
        isFree: true,
        price: 0,
        isDeleted: false,
      });
      mockPrismaService.studentProfile.findUnique.mockResolvedValue({ id: 'student-profile-1' });
      mockPrismaService.enrollment.create.mockResolvedValue({
        id: 'enrollment-1',
        studentId: 'student-profile-1',
        courseId,
        status: 'ACTIVE',
      });

      const result = await service.enrollFreeCourse(courseId, studentUserId);

      expect(result.message).toContain('Successfully enrolled');
      expect(mockPrismaService.enrollment.create).toHaveBeenCalled();
    });

    it('should reject enrollment if course is NOT published (DRAFT or ARCHIVED)', async () => {
      mockPrismaService.course.findUnique.mockResolvedValue({
        id: courseId,
        status: CourseStatus.DRAFT, // NOT PUBLISHED
        isFree: true,
        price: 0,
        isDeleted: false,
      });

      await expect(service.enrollFreeCourse(courseId, studentUserId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject enrollment if course is NOT free', async () => {
      mockPrismaService.course.findUnique.mockResolvedValue({
        id: courseId,
        status: CourseStatus.PUBLISHED,
        isFree: false,
        price: 150,
        isDeleted: false,
      });

      await expect(service.enrollFreeCourse(courseId, studentUserId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ConflictException (409) if student is already enrolled (P2002)', async () => {
      mockPrismaService.course.findUnique.mockResolvedValue({
        id: courseId,
        status: CourseStatus.PUBLISHED,
        isFree: true,
        price: 0,
        isDeleted: false,
      });
      mockPrismaService.studentProfile.findUnique.mockResolvedValue({ id: 'student-profile-1' });
      mockPrismaService.enrollment.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.enrollFreeCourse(courseId, studentUserId)).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
