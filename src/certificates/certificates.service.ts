import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../shared/prisma/prisma.service';

@Injectable()
export class CertificatesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issue a certificate for a completed course. Idempotent — one certificate
   * per student per course. Called from the course-completion flow.
   */
  async issue(studentId: string, courseId: string) {
    try {
      const existing = await this.prisma.certificate.findUnique({
        where: { studentId_courseId: { studentId, courseId } },
      });
      if (existing) return existing;

      return await this.prisma.certificate.create({
        data: {
          certificateCode: this.generateCode(),
          studentId,
          courseId,
          completedAt: new Date(),
        },
      });
    } catch {
      // Unique-race safety: re-read
      return this.prisma.certificate.findUnique({
        where: { studentId_courseId: { studentId, courseId } },
      });
    }
  }

  /** Public verification — returns only non-sensitive display fields. */
  async verify(certificateCode: string) {
    const cert = await this.prisma.certificate.findUnique({
      where: { certificateCode: certificateCode.trim().toUpperCase() },
      include: {
        student: { select: { fullName: true } },
        course: { select: { title: true, teacher: { select: { fullName: true } } } },
      },
    });

    if (!cert) {
      throw new NotFoundException('شهادة غير موجودة. تأكد من رقم الشهادة.');
    }

    return {
      valid: true,
      certificateCode: cert.certificateCode,
      studentName: cert.student.fullName,
      courseTitle: cert.course.title,
      teacherName: cert.course.teacher.fullName,
      completedAt: cert.completedAt,
      issuedAt: cert.createdAt,
    };
  }

  async getMyCertificates(userId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ForbiddenException('Student profile not found.');

    const certificates = await this.prisma.certificate.findMany({
      where: { studentId: student.id },
      include: { course: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      certificates: certificates.map((c) => ({
        id: c.id,
        certificateCode: c.certificateCode,
        courseId: c.course.id,
        courseTitle: c.course.title,
        completedAt: c.completedAt,
      })),
    };
  }

  private generateCode(): string {
    // Human-readable unique code: CERT-XXXX-XXXX
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const pick = (n: number) =>
      Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    return `CERT-${pick(4)}-${pick(4)}`;
  }
}
