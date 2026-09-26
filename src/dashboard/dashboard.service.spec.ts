import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { GradeLevel, Role } from '@prisma/client';

describe('DashboardService (Unit Tests)', () => {
  let service: DashboardService;

  const mockPrismaService = {
    studentProfile: { findUnique: jest.fn() },
    teacherProfile: { findUnique: jest.fn() },
    user: { count: jest.fn(), findMany: jest.fn() },
    course: { count: jest.fn(), findMany: jest.fn() },
    enrollment: { findMany: jest.fn() },
    payment: { aggregate: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    progress: { findMany: jest.fn() },
    exam: { count: jest.fn() },
    examAttempt: { aggregate: jest.fn(), count: jest.fn(), findMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    jest.clearAllMocks();
  });

  describe('getStudentDashboard', () => {
    it('should aggregate enrolled courses and progress percentage accurately', async () => {
      mockPrismaService.studentProfile.findUnique.mockResolvedValue({
        id: 's-1',
        fullName: 'طالب اختباري',
        gradeLevel: GradeLevel.SEC_1,
        user: { email: 'student@test.com', phone: '01011111111' },
      });

      mockPrismaService.enrollment.findMany.mockResolvedValue([
        {
          enrolledAt: new Date(),
          course: {
            id: 'c-1',
            title: 'فيزياء',
            gradeLevel: GradeLevel.SEC_1,
            thumbnailUrl: null,
            teacher: { id: 't-1', fullName: 'مستر أحمد', specialization: 'فيزياء', photoUrl: null },
            lessons: [{ id: 'l-1', title: 'الدرس 1' }, { id: 'l-2', title: 'الدرس 2' }],
          },
        },
      ]);

      mockPrismaService.progress.findMany.mockResolvedValue([
        { lessonId: 'l-1', watchedPercentage: 100, isCompleted: true, lastWatchedAt: new Date(), lesson: { id: 'l-1', title: 'الدرس 1', courseId: 'c-1' } },
        { lessonId: 'l-2', watchedPercentage: 100, isCompleted: true, lastWatchedAt: new Date(), lesson: { id: 'l-2', title: 'الدرس 2', courseId: 'c-1' } },
      ]);

      mockPrismaService.examAttempt.findMany.mockResolvedValue([]);
      mockPrismaService.examAttempt.aggregate.mockResolvedValue({
        _avg: { score: 85 },
        _count: { id: 2 },
      });

      const result = await service.getStudentDashboard('user-id');

      expect(result.stats.totalEnrolledCourses).toBe(1);
      expect(result.stats.completedCourses).toBe(1); // 2/2 lessons completed = 100%
      expect(result.enrolledCourses[0].progressPercentage).toBe(100);
      expect(result.stats.averageExamScore).toBe(85);
    });
  });

  describe('getTeacherDashboard', () => {
    it('should aggregate total students, total revenue, and pending receipts', async () => {
      mockPrismaService.teacherProfile.findUnique.mockResolvedValue({ id: 't-prof-1' });
      mockPrismaService.course.findMany.mockResolvedValue([
        {
          id: 'c-1',
          title: 'كورس الكيمياء',
          status: 'PUBLISHED',
          price: 300,
          isFree: false,
          gradeLevel: GradeLevel.SEC_2,
          _count: { lessons: 5, enrollments: 12, exams: 2 },
        },
      ]);
      mockPrismaService.enrollment.findMany.mockImplementation((args?: any) => {
        if (args?.distinct) {
          return [{ studentId: 's-1' }, { studentId: 's-2' }];
        }
        return [
          {
            enrolledAt: new Date(),
            student: { fullName: 'طالب 1', gradeLevel: GradeLevel.SEC_2 },
            course: { title: 'كورس الكيمياء' },
          },
        ];
      });
      mockPrismaService.payment.aggregate.mockResolvedValue({
        _sum: { amount: 3600 },
        _count: { id: 12 },
      });
      mockPrismaService.payment.count.mockResolvedValue(3); // 3 pending receipts
      mockPrismaService.examAttempt.aggregate.mockResolvedValue({ _avg: { score: 78.5 } });
      mockPrismaService.payment.findMany.mockResolvedValue([]);
      mockPrismaService.examAttempt.findMany.mockResolvedValue([]);

      const result = await service.getTeacherDashboard('user-id');

      expect(result.overview.totalUniqueStudents).toBe(2);
      expect(result.overview.totalCourses).toBe(1);
      expect(result.overview.publishedCourses).toBe(1);
      expect(result.overview.totalGrossRevenue).toBe(3600);
      expect(result.overview.pendingReceiptsCount).toBe(3);
    });
  });

  describe('getAdminDashboard', () => {
    it('should aggregate platform-wide counts for users, courses, and finances', async () => {
      mockPrismaService.user.count.mockImplementation((args?: any) => {
        if (!args) return 150; // total users
        if (args.where?.role === Role.STUDENT && args.where?.isVerified) return 120;
        if (args.where?.role === Role.STUDENT) return 130;
        if (args.where?.role === Role.TEACHER) return 15;
        if (args.where?.role === Role.ADMIN) return 5;
        return 0;
      });

      mockPrismaService.course.count.mockResolvedValue(25);
      mockPrismaService.payment.aggregate.mockResolvedValue({
        _sum: { amount: 45000 },
        _count: { id: 180 },
      });
      mockPrismaService.payment.count.mockResolvedValue(5);
      mockPrismaService.exam.count.mockResolvedValue(10);
      mockPrismaService.examAttempt.count.mockResolvedValue(50);
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await service.getAdminDashboard();

      expect(result.users.total).toBe(150);
      expect(result.users.verifiedStudents).toBe(120);
      expect(result.users.teachers).toBe(15);
      expect(result.users.admins).toBe(5);
      expect(result.financials.totalPlatformGrossRevenue).toBe(45000);
    });
  });
});
