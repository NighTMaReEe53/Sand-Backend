import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import {
  CreateBankQuestionDto,
  ListBankQuestionsQueryDto,
  UpdateBankQuestionDto,
} from './dtos/question-bank.dtos';

interface AuthUser {
  id: string;
  role: string;
}

@Injectable()
export class QuestionBankService {
  constructor(private readonly prisma: PrismaService) {}

  private async getTeacher(userId: string) {
    const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId } });
    if (!teacher) throw new ForbiddenException('Teacher profile not found.');
    return teacher;
  }

  private async assertOwnership(questionId: string, user: AuthUser) {
    const question = await this.prisma.questionBank.findFirst({
      where: { id: questionId, isDeleted: false },
    });
    if (!question) throw new NotFoundException('Question not found.');

    if (user.role === 'ADMIN') return question;

    const teacher = await this.getTeacher(user.id);
    if (question.teacherId !== teacher.id) {
      throw new ForbiddenException('You do not own this question.');
    }
    return { question, teacher };
  }

  private validateOptions(dto: { options?: string[]; correctOptionIndex?: number }, current?: { options: unknown; correctOptionIndex: number }) {
    const options = dto.options ?? (current ? (current.options as string[]) : undefined);
    const correctIdx = dto.correctOptionIndex ?? current?.correctOptionIndex;
    if (options && correctIdx !== undefined && correctIdx >= options.length) {
      throw new BadRequestException(
        `correctOptionIndex (${correctIdx}) exceeds the number of options (${options.length}).`,
      );
    }
  }

  private async resolveLinks(teacherId: string, dto: { courseId?: string | null; sectionId?: string | null; lessonId?: string | null }) {
    if (dto.courseId) {
      const course = await this.prisma.course.findFirst({
        where: { id: dto.courseId, teacherId, isDeleted: false },
        select: { id: true },
      });
      if (!course) throw new NotFoundException('Course not found or access denied.');

      if (dto.lessonId) {
        const lesson = await this.prisma.lesson.findFirst({
          where: { id: dto.lessonId, courseId: dto.courseId, isDeleted: false },
          select: { id: true },
        });
        if (!lesson) throw new NotFoundException('Lesson not found in this course.');
      }
      if (dto.sectionId) {
        const section = await this.prisma.section.findFirst({
          where: { id: dto.sectionId, courseId: dto.courseId },
          select: { id: true },
        });
        if (!section) throw new NotFoundException('Section not found in this course.');
      }
    }
  }

  async create(dto: CreateBankQuestionDto, user: AuthUser) {
    const teacher = await this.getTeacher(user.id);
    this.validateOptions(dto);
    await this.resolveLinks(teacher.id, dto);

    const question = await this.prisma.questionBank.create({
      data: {
        teacherId: teacher.id,
        text: dto.text.trim(),
        imageUrl: dto.imageUrl ?? null,
        options: dto.options,
        correctOptionIndex: dto.correctOptionIndex,
        explanation: dto.explanation ?? null,
        marks: dto.marks ?? 1,
        difficulty: dto.difficulty ?? 'MEDIUM',
        topic: dto.topic ?? null,
        tags: dto.tags ?? [],
        courseId: dto.courseId ?? null,
        sectionId: dto.sectionId ?? null,
        lessonId: dto.lessonId ?? null,
      },
    });

    return { message: 'Question added to the bank.', question };
  }

  async list(query: ListBankQuestionsQueryDto, user: AuthUser) {
    let teacherId: string | undefined;
    if (user.role !== 'ADMIN') {
      const teacher = await this.getTeacher(user.id);
      teacherId = teacher.id;
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 20, 100);

    const where: Prisma.QuestionBankWhereInput = {
      isDeleted: false,
      ...(teacherId && { teacherId }),
      ...(query.difficulty && { difficulty: query.difficulty }),
      ...(query.topic && { topic: { contains: query.topic } }),
      ...(query.courseId && { courseId: query.courseId }),
      ...(query.lessonId && { lessonId: query.lessonId }),
      ...(query.tag && { tags: { has: query.tag } }),
      ...(query.search && {
        OR: [
          { text: { contains: query.search } },
          { topic: { contains: query.search } },
          { explanation: { contains: query.search } },
        ],
      }),
    };

    const orderBy: Prisma.QuestionBankOrderByWithRelationInput =
      query.sortBy === 'difficulty'
        ? { difficulty: query.sortOrder ?? 'desc' }
        : query.sortBy === 'marks'
          ? { marks: query.sortOrder ?? 'desc' }
          : { createdAt: query.sortOrder ?? 'desc' };

    const [questions, total] = await Promise.all([
      this.prisma.questionBank.findMany({
        where,
        include: { course: { select: { id: true, title: true } } },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.questionBank.count({ where }),
    ]);

    return {
      questions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async update(questionId: string, dto: UpdateBankQuestionDto, user: AuthUser) {
    const result = await this.assertOwnership(questionId, user);
    const question = 'question' in result ? result.question : (result as any);
    const teacherId = 'teacher' in result ? (result as any).teacher.id : undefined;

    this.validateOptions(dto, question);
    if (teacherId) {
      await this.resolveLinks(
        teacherId,
        dto as { courseId?: string | null; sectionId?: string | null; lessonId?: string | null },
      );
    }

    const updated = await this.prisma.questionBank.update({
      where: { id: questionId },
      data: {
        ...(dto.text !== undefined && { text: dto.text.trim() }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.options !== undefined && { options: dto.options }),
        ...(dto.correctOptionIndex !== undefined && { correctOptionIndex: dto.correctOptionIndex }),
        ...(dto.explanation !== undefined && { explanation: dto.explanation }),
        ...(dto.marks !== undefined && { marks: dto.marks }),
        ...(dto.difficulty !== undefined && { difficulty: dto.difficulty }),
        ...(dto.topic !== undefined && { topic: dto.topic }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.courseId !== undefined && { courseId: dto.courseId }),
        ...(dto.sectionId !== undefined && { sectionId: dto.sectionId }),
        ...(dto.lessonId !== undefined && { lessonId: dto.lessonId }),
      },
    });

    return { message: 'Question updated successfully.', question: updated };
  }

  async delete(questionId: string, user: AuthUser) {
    await this.assertOwnership(questionId, user);
    await this.prisma.questionBank.update({
      where: { id: questionId },
      data: { isDeleted: true },
    });
    return { message: 'Question deleted successfully.' };
  }

  async bulkDelete(ids: string[], user: AuthUser) {
    const where: Prisma.QuestionBankWhereInput = { id: { in: ids }, isDeleted: false };

    if (user.role !== 'ADMIN') {
      const teacher = await this.getTeacher(user.id);
      where.teacherId = teacher.id;
    }

    const result = await this.prisma.questionBank.updateMany({
      where,
      data: { isDeleted: true },
    });

    return {
      message: `${result.count} question(s) deleted successfully.`,
      deletedCount: result.count,
    };
  }

  async getTopics(user: AuthUser) {
    let teacherId: string | undefined;
    if (user.role !== 'ADMIN') {
      const teacher = await this.getTeacher(user.id);
      teacherId = teacher.id;
    }

    const topics = await this.prisma.questionBank.findMany({
      where: { isDeleted: false, topic: { not: null }, ...(teacherId && { teacherId }) },
      select: { topic: true },
      distinct: ['topic'],
    });

    return { topics: topics.map((t) => t.topic).filter(Boolean) };
  }
}
