import { Role, EnrollmentStatus } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * دالة موحدة للتحقق مما إذا كان المستخدم يملك صلاحية إدارة الكورس
 * (أدمن أو المدرس صاحب الكورس)
 */
export async function canManageCourse(
  prisma: PrismaService,
  userId: string,
  courseId: string,
  role?: Role,
): Promise<boolean> {
  if (!userId || !courseId) return false;

  // إذا تم تمرير الـ role وكان ADMIN، يُسمح له مباشرة
  if (role === Role.ADMIN) return true;

  // جلب الكورس مع بيانات المدرس المالك
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      teacherId: true,
      isDeleted: true,
      teacher: {
        select: {
          id: true,
          userId: true,
        },
      },
    },
  });

  if (!course || course.isDeleted) return false;

  // 1. التحقق المباشر مما إذا كان المستخدم هو المدرس صاحب الكورس
  if (course.teacher?.userId === userId) {
    return true;
  }

  // 2. التحقق مما إذا كان المستخدم أدمن عبر قاعدة البيانات
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  return user?.role === Role.ADMIN;
}

/**
 * دالة موحدة لإضافة حقول isOwner و isEnrolled لجميع الكورسات المعروضة في القوائم
 * تستخدم استعلاماً واحداً مجمعاً (Batch Query) لمنع مشكلة N+1
 */
export async function attachCourseOwnershipAndEnrollment(
  prisma: PrismaService,
  courses: any[],
  user?: AuthenticatedUser,
): Promise<any[]> {
  if (!courses || courses.length === 0) return [];

  // إذا كان الزائر غير مسجل (Guest)
  if (!user) {
    return courses.map((course) => ({
      ...course,
      isOwner: false,
      isEnrolled: false,
    }));
  }

  // إذا كان المستخدم أدمن (له كامل الصلاحيات)
  if (user.role === Role.ADMIN) {
    return courses.map((course) => ({
      ...course,
      isOwner: true,
      isEnrolled: true,
    }));
  }

  // إذا كان المستخدم مدرساً (TEACHER)
  if (user.role === Role.TEACHER) {
    // جلب بروفايل المدرس مرة واحدة
    const teacherProfile = await prisma.teacherProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });

    return courses.map((course) => {
      const isOwner =
        (teacherProfile && course.teacherId === teacherProfile.id) ||
        (course.teacher && course.teacher.userId === user.id);

      return {
        ...course,
        isOwner: !!isOwner,
        isEnrolled: false,
      };
    });
  }

  // إذا كان المستخدم طالباً (STUDENT)
  if (user.role === Role.STUDENT) {
    const student = await prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });

    if (!student) {
      return courses.map((course) => ({
        ...course,
        isOwner: false,
        isEnrolled: false,
      }));
    }

    // جلب كل اشتراكات الطالب في هذه الكورسات دفعة واحدة (بكل الحالات)
    // حتى نستطيع تمييز الاشتراكات قيد المراجعة (PENDING) من النشطة (ACTIVE)
    const courseIds = courses.map((c) => c.id).filter(Boolean);
    const enrollments = await prisma.enrollment.findMany({
      where: {
        studentId: student.id,
        courseId: { in: courseIds },
      },
      select: { courseId: true, status: true },
    });

    const enrollmentStatusByCourseId = new Map(
      enrollments.map((e) => [e.courseId, e.status]),
    );
    const enrolledCourseIds = new Set(
      enrollments
        .filter((e) => e.status === EnrollmentStatus.ACTIVE)
        .map((e) => e.courseId),
    );

    return courses.map((course) => ({
      ...course,
      isOwner: false,
      isEnrolled: enrolledCourseIds.has(course.id),
      enrollmentStatus: enrollmentStatusByCourseId.get(course.id) ?? null,
    }));
  }

  return courses.map((course) => ({
    ...course,
    isOwner: false,
    isEnrolled: false,
  }));
}
