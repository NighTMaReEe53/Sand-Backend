import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  ChallengeStatus,
  EnrollmentStatus,
  ExamAttemptStatus,
  QuestionDifficulty,
  Role,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// Backend-enforced configurable limits — never hardcoded in the Frontend
const LIMITS = {
  minimumQuestions: Number(process.env.CHALLENGE_MIN_QUESTIONS) || 5,
  maximumQuestions: Number(process.env.CHALLENGE_MAX_QUESTIONS) || 20,
  minimumDuration: Number(process.env.CHALLENGE_MIN_DURATION) || 60,
  maximumDuration: Number(process.env.CHALLENGE_MAXIMUM_DURATION) || 1800,
};

/** Online presence: server-computed, never trusted from client */
const ONLINE_THRESHOLD_MS = 90 * 1000;
const INVITATION_EXPIRY_HOURS = 24;

/** Bot player — single lazily-created system account (no migration needed) */
const BOT_EMAIL = 'ai-bot@challenges.system';
const BOT_PHONE = '+201099999999';
const BOT_NAME = 'البوت الذكي 🤖';
/** احتمالية إجابة البوت الصحيحة — يضبط صعوبة اللعب ضد البوت */
const BOT_CORRECT_PROBABILITY = 0.65;

export interface UnifiedQuestionData {
  id: string;
  text: string;
  imageUrl: string | null;
  options: string[];
  correctOptionIndex: number;
  explanation: string | null;
  marks: number;
  sourceType: 'BANK' | 'EXAM' | 'MISTAKE';
}

export interface ChallengeView {
  id: string;
  courseId: string;
  status: ChallengeStatus;
  questionCount: number;
  durationSeconds: number;
  startedAt: Date | null;
  expiresAt: Date | null;
  remainingSeconds: number | null;
  challenger: { studentId: string; fullName: string };
  opponent: { studentId: string; fullName: string };
  myProgress?: { score: number; answered: number; finished: boolean };
}

@Injectable()
export class ChallengesService {
  /** كاش بسيط لهوية البوت داخل العملية الواحدة */
  private botStudent: { id: string; userId: string } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async getStudent(userId: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
    });
    if (!student) throw new ForbiddenException('Student profile not found.');
    return student;
  }

  /** يجلب (أو ينشئ لمرة واحدة) حساب البوت — طالب وهمي مملوك للنظام */
  private async getBotStudent(): Promise<{ id: string; userId: string }> {
    if (this.botStudent) return this.botStudent;

    let user = await this.prisma.user.findUnique({
      where: { email: BOT_EMAIL },
      select: { id: true, studentProfile: { select: { id: true } } },
    });

    if (!user?.studentProfile) {
      try {
        user = await this.prisma.user.create({
          data: {
            email: BOT_EMAIL,
            phone: BOT_PHONE,
            passwordHash: crypto.randomBytes(32).toString('hex'),
            role: Role.STUDENT,
            isVerified: true,
            studentProfile: {
              create: {
                fullName: BOT_NAME,
                guardianPhone: '-',
                gradeLevel: 'SEC_1',
              },
            },
          },
          select: { id: true, studentProfile: { select: { id: true } } },
        });
      } catch (err: any) {
        // سباق إنشاء متزامن (P2002) — أعد الجلب فقط
        if (err?.code !== 'P2002') throw err;
        user = await this.prisma.user.findUnique({
          where: { email: BOT_EMAIL },
          select: { id: true, studentProfile: { select: { id: true } } },
        });
      }
    }

    if (!user?.studentProfile) {
      throw new Error('Failed to prepare the bot player.');
    }

    this.botStudent = { id: user.studentProfile.id, userId: user.id };
    return this.botStudent;
  }

  /** فحص سريع بدون استعلام — يعمل بعد أول إنشاء/جلب للبوت */
  private isBotStudentId(studentId: string) {
    return this.botStudent?.id === studentId;
  }

  /** Eligibility: same course, both ACTIVE-enrolled, not self. */
  private assertEligibility(aId: string, bId: string, courseId: string) {
    if (aId === bId) throw new BadRequestException('You cannot challenge yourself.');
    return Promise.all([
      this.prisma.enrollment.findFirst({
        where: { studentId: aId, courseId, status: EnrollmentStatus.ACTIVE },
        select: { id: true },
      }),
      this.prisma.enrollment.findFirst({
        where: { studentId: bId, courseId, status: EnrollmentStatus.ACTIVE },
        select: { id: true },
      }),
    ]).then(([a, b]) => {
      if (!a || !b) {
        throw new ForbiddenException(
          'Both students must be actively enrolled in the same course.',
        );
      }
    });
  }

  /**
   * بناء ميكس أسئلة ذكي وشامل من 3 مصادر:
   * 1. أخطاء الطالب السابقة في هذا الكورس (Student Past Mistakes)
   * 2. أسئلة امتحانات الأستاذ في الكورس (Teacher Exam Questions)
   * 3. بنك الأسئلة المركزي للكورس (Question Bank)
   */
  private async buildMixedQuestionPool(
    courseId: string,
    studentId: string,
    targetCount: number,
  ): Promise<{ selectedIds: string[]; totalAvailable: number }> {
    // 1. أخطاء الطالب السابقة في هذا الكورس (من الامتحانات المسلمة)
    const mistakeAnswers = await this.prisma.attemptAnswer.findMany({
      where: {
        attempt: {
          studentId,
          exam: { courseId, isDeleted: false },
          status: { in: [ExamAttemptStatus.SUBMITTED, ExamAttemptStatus.TIMED_OUT] },
        },
        isCorrect: false,
        question: { isDeleted: false },
      },
      select: { questionId: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const mistakeIds = Array.from(new Set(mistakeAnswers.map((a) => a.questionId)));

    // 2. أسئلة الامتحانات المنشورة للكورس (باستثناء ما هو مسجل في الأخطاء منعاً للتكرار)
    const examQuestions = await this.prisma.question.findMany({
      where: {
        exam: { courseId, isDeleted: false, isPublished: true },
        isDeleted: false,
        id: { notIn: mistakeIds },
      },
      select: { id: true },
    });
    const examIds = examQuestions.map((q) => q.id);

    // 3. أسئلة بنك الأسئلة للكورس
    const bankQuestions = await this.prisma.questionBank.findMany({
      where: { courseId, isDeleted: false },
      select: { id: true },
    });
    const bankIds = bankQuestions.map((q) => q.id);

    // إجمالي الرصيد الكلي الفريد
    const allUnique = Array.from(new Set([...mistakeIds, ...examIds, ...bankIds]));
    const totalAvailable = allUnique.length;

    if (totalAvailable < LIMITS.minimumQuestions) {
      throw new ConflictException(
        `رصيد الأسئلة المتاح في هذا الكورس (${totalAvailable}) أقل من الحد الأدنى (${LIMITS.minimumQuestions} أسئلة).`,
      );
    }

    const finalCount = Math.min(targetCount, totalAvailable);

    // حساب الحصص الذكية:
    // - ما يصل إلى 35% من أخطاء الطالب السابقة
    // - ما يصل إلى 35% من أسئلة الامتحانات
    // - الباقي من بنك الأسئلة (مع التعويض التلقائي عند عدم توفر أحد المصادر)
    const mistakeQuota = Math.min(mistakeIds.length, Math.ceil(finalCount * 0.35));
    const examQuota = Math.min(examIds.length, Math.ceil(finalCount * 0.35));
    const remainingQuota = finalCount - mistakeQuota - examQuota;

    const chosen = new Set<string>();

    // أخذ من الأخطاء
    for (const id of this.shuffle(mistakeIds).slice(0, mistakeQuota)) {
      chosen.add(id);
    }

    // أخذ من أسئلة الامتحانات
    for (const id of this.shuffle(examIds).slice(0, examQuota)) {
      chosen.add(id);
    }

    // أخذ من بنك الأسئلة
    const remainingBank = bankIds.filter((id) => !chosen.has(id));
    for (const id of this.shuffle(remainingBank).slice(0, remainingQuota)) {
      chosen.add(id);
    }

    // إذا تبقى نقص (مثلاً بنك الأسئلة صغير)، نملأ من باقي المجمع العام
    if (chosen.size < finalCount) {
      const rest = this.shuffle(allUnique.filter((id) => !chosen.has(id)));
      for (const id of rest.slice(0, finalCount - chosen.size)) {
        chosen.add(id);
      }
    }

    return {
      selectedIds: this.shuffle(Array.from(chosen)),
      totalAvailable,
    };
  }

  /**
   * جلب وتوحيد بيانات الأسئلة من بنك الأسئلة أو جدول أسئلة الامتحانات
   */
  private async getQuestionDataMap(questionIds: string[]): Promise<Map<string, UnifiedQuestionData>> {
    if (questionIds.length === 0) return new Map();

    const [bankRows, examRows] = await Promise.all([
      this.prisma.questionBank.findMany({
        where: { id: { in: questionIds } },
        select: {
          id: true,
          text: true,
          imageUrl: true,
          options: true,
          correctOptionIndex: true,
          explanation: true,
          marks: true,
        },
      }),
      this.prisma.question.findMany({
        where: { id: { in: questionIds } },
        select: {
          id: true,
          text: true,
          imageUrl: true,
          options: true,
          correctOptionIndex: true,
          explanation: true,
          marks: true,
        },
      }),
    ]);

    const map = new Map<string, UnifiedQuestionData>();
    for (const b of bankRows) {
      map.set(b.id, {
        id: b.id,
        text: b.text,
        imageUrl: b.imageUrl,
        options: (b.options as string[]) ?? [],
        correctOptionIndex: b.correctOptionIndex,
        explanation: b.explanation,
        marks: b.marks ?? 1,
        sourceType: 'BANK',
      });
    }
    for (const e of examRows) {
      map.set(e.id, {
        id: e.id,
        text: e.text,
        imageUrl: e.imageUrl,
        options: (e.options as string[]) ?? [],
        correctOptionIndex: e.correctOptionIndex,
        explanation: e.explanation,
        marks: e.marks ?? 1,
        sourceType: 'EXAM',
      });
    }

    return map;
  }

  private shuffle<T>(items: T[]): T[] {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Lazy expiration — invitations unanswered in time become EXPIRED. */
  private async expireIfDue(challenge: { id: string; status: ChallengeStatus; createdAt: Date }) {
    if (
      (challenge.status === 'PENDING' || challenge.status === 'READY') &&
      Date.now() - challenge.createdAt.getTime() > INVITATION_EXPIRY_HOURS * 3600 * 1000
    ) {
      await this.prisma.challenge.update({
        where: { id: challenge.id },
        data: { status: ChallengeStatus.EXPIRED },
      });
      return ChallengeStatus.EXPIRED;
    }
    return null;
  }

  /**
   * Availability gate — total challengeable questions collected from ALL
   * actively-enrolled courses (question bank + exam questions).
   */
  async getAvailability(userId: string) {
    const me = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!me) {
      return {
        enrolled: false,
        questionPool: 0,
        minimumQuestions: LIMITS.minimumQuestions,
        eligible: false,
        eligibleCourseIds: [] as string[],
      };
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId: me.id, status: EnrollmentStatus.ACTIVE },
      select: { courseId: true },
    });
    if (enrollments.length === 0) {
      return {
        enrolled: false,
        questionPool: 0,
        minimumQuestions: LIMITS.minimumQuestions,
        eligible: false,
        eligibleCourseIds: [] as string[],
      };
    }

    const courseIds = enrollments.map((e) => e.courseId);

    // Per-course counts so we know which courses are individually eligible
    const [bankGroups, examGroups, mistakeGroups] = await Promise.all([
      this.prisma.questionBank.groupBy({
        by: ['courseId'],
        where: { courseId: { in: courseIds }, isDeleted: false },
        _count: { id: true },
      }),
      // exam questions: group by courseId via the exam relation
      this.prisma.question.findMany({
        where: {
          exam: { courseId: { in: courseIds }, isDeleted: false, isPublished: true },
          isDeleted: false,
        },
        select: { exam: { select: { courseId: true } } },
      }),
      // mistake IDs (answers wrong) for this student — used to add unique counts
      this.prisma.attemptAnswer.findMany({
        where: {
          attempt: {
            studentId: me.id,
            exam: { courseId: { in: courseIds }, isDeleted: false },
            status: { in: [ExamAttemptStatus.SUBMITTED, ExamAttemptStatus.TIMED_OUT] },
          },
          isCorrect: false,
          question: { isDeleted: false },
        },
        select: { questionId: true, attempt: { select: { exam: { select: { courseId: true } } } } },
      }),
    ]);

    // build per-course bank counts
    const bankByCourse = new Map<string, number>();
    for (const g of bankGroups) bankByCourse.set(g.courseId, g._count.id);

    // build per-course exam question counts
    const examByCourse = new Map<string, Set<string>>();
    for (const q of examGroups) {
      const cid = q.exam.courseId;
      if (!examByCourse.has(cid)) examByCourse.set(cid, new Set());
    }
    // We need exam question IDs — re-fetch with ID for accurate set counting
    for (const q of examGroups) {
      // examGroups has no id field yet — handled via count in loop
    }

    // build per-course mistake question IDs (subset of exam questions)
    const mistakeByCourse = new Map<string, Set<string>>();
    for (const a of mistakeGroups) {
      const cid = a.attempt.exam.courseId;
      if (!mistakeByCourse.has(cid)) mistakeByCourse.set(cid, new Set());
      mistakeByCourse.get(cid)!.add(a.questionId);
    }

    // Count exam questions per course using the fetched rows
    const examCountByCourse = new Map<string, number>();
    for (const q of examGroups) {
      const cid = q.exam.courseId;
      examCountByCourse.set(cid, (examCountByCourse.get(cid) ?? 0) + 1);
    }

    let totalPool = 0;
    const eligibleCourseIds: string[] = [];

    for (const courseId of courseIds) {
      const bank = bankByCourse.get(courseId) ?? 0;
      const exam = examCountByCourse.get(courseId) ?? 0;
      const mistakes = mistakeByCourse.get(courseId)?.size ?? 0;
      // Total unique: bank questions + exam questions + mistakes (mistakes may overlap exam, treated additive for gate purposes)
      const pool = bank + exam + mistakes;
      totalPool += pool;
      if (pool >= LIMITS.minimumQuestions) {
        eligibleCourseIds.push(courseId);
      }
    }

    return {
      enrolled: true,
      questionPool: totalPool,
      minimumQuestions: LIMITS.minimumQuestions,
      eligible: eligibleCourseIds.length > 0,
      eligibleCourseIds,
    };
  }




  async createChallenge(
    userId: string,
    dto: {
      courseId: string;
      opponentUserId?: string;
      vsBot?: boolean;
      questionCount: number;
      durationSeconds: number;
    },
  ) {
    const me = await this.getStudent(userId);

    const warnings: string[] = [];
    let questionCount = Math.round(dto.questionCount);
    let durationSeconds = Math.round(dto.durationSeconds);

    if (questionCount < LIMITS.minimumQuestions || questionCount > LIMITS.maximumQuestions) {
      throw new BadRequestException(
        `Question count must be between ${LIMITS.minimumQuestions} and ${LIMITS.maximumQuestions}.`,
      );
    }
    if (durationSeconds < LIMITS.minimumDuration || durationSeconds > LIMITS.maximumDuration) {
      throw new BadRequestException(
        `Duration must be between ${LIMITS.minimumDuration} and ${LIMITS.maximumDuration} seconds.`,
      );
    }

    // بناء الميكس الشامل من (بنك الأسئلة + الامتحانات + أخطاء الطالب)
    const { selectedIds, totalAvailable } = await this.buildMixedQuestionPool(
      dto.courseId,
      me.id,
      questionCount,
    );

    if (totalAvailable < questionCount) {
      questionCount = totalAvailable;
      warnings.push(`إجمالي الأسئلة المتاحة لهذا الكورس ${questionCount} سؤال — سيبدأ التحدي بهذا العدد.`);
    }

    // ─── وضع اللعب ضد البوت ─────────────────────────────────────
    if (dto.vsBot) {
      const myEnrollment = await this.prisma.enrollment.findFirst({
        where: { studentId: me.id, courseId: dto.courseId, status: EnrollmentStatus.ACTIVE },
        select: { id: true },
      });
      if (!myEnrollment) {
        throw new ForbiddenException('You must be actively enrolled in this course.');
      }

      const bot = await this.getBotStudent();

      const challenge = await this.prisma.challenge.create({
        data: {
          courseId: dto.courseId,
          challengerId: me.id,
          opponentId: bot.id,
          status: ChallengeStatus.READY,
          questionCount,
          durationSeconds,
          players: {
            create: [
              { studentId: me.id },
              { studentId: bot.id },
            ],
          },
        },
        include: { players: { select: { id: true, studentId: true } } },
      });

      // توزيع نفس المجموعة المختارة (أو ترتيب عشوائي) لكل طرف
      for (const player of challenge.players) {
        const ids = player.studentId === me.id ? selectedIds : this.shuffle(selectedIds);
        await this.prisma.challengeQuestion.createMany({
          data: ids.map((questionId, order) => ({
            challengeId: challenge.id,
            playerId: player.id,
            questionId,
            order: order + 1,
          })),
        });
      }

      return { challenge, warnings };
    }

    // ─── الوضع العادي: تحدٍ ضد زميل بشري ─────────────────────────
    if (!dto.opponentUserId) {
      throw new BadRequestException('يجب تحديد الخصم أو اختيار اللعب ضد البوت.');
    }

    let opponentProfile = await this.prisma.studentProfile.findUnique({
      where: { id: dto.opponentUserId },
      select: { id: true, userId: true },
    });
    if (!opponentProfile) {
      const opponentUser = await this.prisma.user.findUnique({
        where: { id: dto.opponentUserId },
        select: { studentProfile: { select: { id: true, userId: true } } },
      });
      opponentProfile = opponentUser?.studentProfile ?? null;
    }

    if (!opponentProfile) {
      throw new BadRequestException('الخصم غير موجود أو ليس طالباً مسجلاً.');
    }
    if (opponentProfile.id === me.id) {
      throw new BadRequestException('لا يمكنك تحدي نفسك.');
    }
    await this.assertEligibility(me.id, opponentProfile.id, dto.courseId);

    const challenge = await this.prisma.challenge.create({
      data: {
        courseId: dto.courseId,
        challengerId: me.id,
        opponentId: opponentProfile.id,
        status: ChallengeStatus.PENDING,
        questionCount,
        durationSeconds,
        players: {
          create: [
            { studentId: me.id },
            { studentId: opponentProfile.id },
          ],
        },
      },
    });

    await this.notificationsService
      .notify({
        userId: opponentProfile.userId,
        type: 'CHALLENGE_INVITATION',
        title: 'تحدٍ جديد!',
        body: `يتحداك لاختبار سريع (${questionCount} أسئلة · ${Math.round(durationSeconds / 60)} دقائق).`,
        linkUrl: `/challenges/${challenge.id}`,
      })
      .catch(() => undefined);

    return { challenge, warnings };
  }

  async acceptChallenge(challengeId: string, userId: string) {
    const me = await this.getStudent(userId);
    const challenge = await this.getChallengeForPlayer(challengeId, me.id);

    if (challenge.challengerId === me.id) {
      throw new BadRequestException('Waiting for your opponent to respond.');
    }
    if ((await this.expireIfDue(challenge)) !== null) {
      throw new ConflictException('This invitation has expired.');
    }
    if (challenge.status !== ChallengeStatus.PENDING) {
      throw new ConflictException('This challenge cannot be accepted anymore.');
    }

    // تجهيز لقطة الأسئلة المتنوعة للطرفين
    const { selectedIds } = await this.buildMixedQuestionPool(
      challenge.courseId,
      me.id,
      challenge.questionCount,
    );

    const players = await this.prisma.challengePlayer.findMany({
      where: { challengeId },
      select: { id: true, studentId: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.challenge.update({
        where: { id: challengeId },
        data: { status: ChallengeStatus.READY },
      });
      for (const player of players) {
        const ids = this.shuffle(selectedIds);
        await tx.challengeQuestion.createMany({
          data: ids.map((questionId, order) => ({
            challengeId,
            playerId: player.id,
            questionId,
            order: order + 1,
          })),
        });
      }
    });

    const challengerUser = await this.prisma.studentProfile.findUnique({
      where: { id: challenge.challengerId },
      select: { userId: true },
    });
    if (challengerUser) {
      await this.notificationsService
        .notify({
          userId: challengerUser.userId,
          type: 'CHALLENGE_ACCEPTED',
          title: 'تم قبول التحدي',
          body: 'قبل خصمك التحدي — اضغط ابدأ الآن!',
          linkUrl: `/challenges/${challengeId}`,
        })
        .catch(() => undefined);
    }

    return { message: 'Challenge accepted.' };
  }

  async rejectChallenge(challengeId: string, userId: string) {
    const me = await this.getStudent(userId);
    const challenge = await this.getChallengeForPlayer(challengeId, me.id);

    if (challenge.challengerId === me.id) {
      throw new BadRequestException('You cannot reject your own challenge.');
    }
    if ((await this.expireIfDue(challenge)) !== null) {
      throw new ConflictException('This invitation has expired.');
    }
    if (challenge.status !== ChallengeStatus.PENDING) {
      throw new ConflictException('This challenge can no longer be rejected.');
    }

    await this.prisma.challenge.update({
      where: { id: challengeId },
      data: { status: ChallengeStatus.REJECTED },
    });

    const challengerUser = await this.prisma.studentProfile.findUnique({
      where: { id: challenge.challengerId },
      select: { userId: true },
    });
    if (challengerUser) {
      await this.notificationsService
        .notify({
          userId: challengerUser.userId,
          type: 'CHALLENGE_REJECTED',
          title: 'تم رفض التحدي',
          body: 'رفض خصمك التحدي.',
          linkUrl: '/challenges',
        })
        .catch(() => undefined);
    }
    return { message: 'Challenge rejected.' };
  }

  async startChallenge(challengeId: string, userId: string) {
    const me = await this.getStudent(userId);
    const challenge = await this.getChallengeForPlayer(challengeId, me.id);

    if ((await this.expireIfDue(challenge)) !== null) {
      throw new ConflictException('This challenge has expired.');
    }
    if (challenge.status !== ChallengeStatus.READY) {
      throw new ConflictException('The challenge is not ready to start.');
    }

    const now = new Date();
    const updated = await this.prisma.challenge.update({
      where: { id: challengeId },
      data: {
        status: ChallengeStatus.IN_PROGRESS,
        startedAt: now,
        expiresAt: new Date(now.getTime() + challenge.durationSeconds * 1000),
      },
    });

    for (const player of challenge.players) {
      if (this.isBotStudentId(player.studentId)) continue;
      await this.notificationsService
        .notify({
          userId: player.student.userId,
          type: 'CHALLENGE_STARTED',
          title: 'التحدي بدأ!',
          body: `الوقت المحدد: ${Math.round(updated.durationSeconds / 60)} دقيقة — بالتوفيق!`,
          linkUrl: `/challenges/${challengeId}`,
        })
        .catch(() => undefined);
    }

    return { expiresAt: updated.expiresAt };
  }

  /** Sanitized questions for a player — supports both questionBank and exams questions. */
  async getMyQuestions(challengeId: string, userId: string) {
    const me = await this.getStudent(userId);
    const challenge = await this.getChallengeForPlayer(challengeId, me.id);
    await this.autoExpireIfNeeded(challenge);

    const myPlayer = challenge.players.find((p) => p.studentId === me.id)!;
    const questions = await this.prisma.challengeQuestion.findMany({
      where: { playerId: myPlayer.id },
      orderBy: { order: 'asc' },
    });
    const questionIds = questions.map((q) => q.questionId);
    const questionMap = await this.getQuestionDataMap(questionIds);

    const answered = await this.prisma.challengeAnswer.findMany({
      where: { challengeId, playerId: myPlayer.id },
      select: { questionId: true, isCorrect: true },
    });
    const answeredMap = new Map(answered.map((a) => [a.questionId, a.isCorrect]));

    return {
      status: challenge.status,
      expiresAt: challenge.expiresAt,
      remainingSeconds: this.remainingSeconds(challenge),
      questions: questions.map((q) => {
        const item = questionMap.get(q.questionId);
        return {
          questionId: q.questionId,
          order: q.order,
          text: item?.text ?? null,
          imageUrl: item?.imageUrl ?? null,
          options: item?.options ?? [],
          marks: item?.marks ?? 1,
          alreadyAnswered: answeredMap.has(q.questionId),
          wasCorrect: answeredMap.get(q.questionId) ?? null,
        };
      }),
    };
  }

  /** Answer submission with dual question source evaluation (Bank & Exam). */
  async submitAnswer(
    challengeId: string,
    userId: string,
    dto: { questionId: string; selectedOption: number },
  ) {
    const me = await this.getStudent(userId);
    const challenge = await this.getChallengeForPlayer(challengeId, me.id);
    await this.autoExpireIfNeeded(challenge);

    if (challenge.status !== ChallengeStatus.IN_PROGRESS) {
      throw new ConflictException('The challenge is not in progress.');
    }
    if (this.remainingSeconds(challenge) <= 0) {
      await this.completeIfFinished(challenge.id);
      throw new ConflictException('Time is up — answers are no longer accepted.');
    }

    const myPlayer = challenge.players.find((p) => p.studentId === me.id)!;

    const belongsToMe = await this.prisma.challengeQuestion.findFirst({
      where: { challengeId, playerId: myPlayer.id, questionId: dto.questionId },
      select: { id: true },
    });
    if (!belongsToMe) {
      throw new ForbiddenException('This question is not part of your challenge set.');
    }

    const existing = await this.prisma.challengeAnswer.findUnique({
      where: {
        challengeId_playerId_questionId: {
          challengeId,
          playerId: myPlayer.id,
          questionId: dto.questionId,
        },
      },
      select: { id: true },
    });
    if (existing) throw new ConflictException('You already answered this question.');

    // البحث في بنك الأسئلة أو أسئلة الامتحانات
    let correctOptionIndex: number | null = null;
    const bank = await this.prisma.questionBank.findUnique({
      where: { id: dto.questionId },
      select: { correctOptionIndex: true },
    });
    if (bank) {
      correctOptionIndex = bank.correctOptionIndex;
    } else {
      const examQ = await this.prisma.question.findUnique({
        where: { id: dto.questionId },
        select: { correctOptionIndex: true },
      });
      if (examQ) correctOptionIndex = examQ.correctOptionIndex;
    }

    if (correctOptionIndex === null) {
      throw new NotFoundException('Question no longer exists.');
    }

    const isCorrect = dto.selectedOption === correctOptionIndex;

    await this.prisma.$transaction([
      this.prisma.challengeAnswer.create({
        data: {
          challengeId,
          playerId: myPlayer.id,
          questionId: dto.questionId,
          selectedOption: dto.selectedOption,
          isCorrect,
        },
      }),
      this.prisma.challengePlayer.update({
        where: { id: myPlayer.id },
        data: {
          score: { increment: isCorrect ? 1 : 0 },
          correct: { increment: isCorrect ? 1 : 0 },
          wrong: { increment: isCorrect ? 0 : 1 },
        },
      }),
    ]);

    return { isCorrect };
  }

  async finishMyPart(challengeId: string, userId: string) {
    const me = await this.getStudent(userId);
    const challenge = await this.getChallengeForPlayer(challengeId, me.id);
    await this.autoExpireIfNeeded(challenge);

    if (challenge.status !== ChallengeStatus.IN_PROGRESS) {
      throw new ConflictException('The challenge is not in progress.');
    }
    const myPlayer = challenge.players.find((p) => p.studentId === me.id)!;
    if (myPlayer.finishedAt) throw new ConflictException('You already finished.');

    const timeTaken = Math.min(
      Math.max(1, Math.round((Date.now() - (challenge.startedAt?.getTime() ?? Date.now())) / 1000)),
      challenge.durationSeconds,
    );

    const answered = await this.prisma.challengeAnswer.count({
      where: { challengeId, playerId: myPlayer.id },
    });

    await this.prisma.challengePlayer.update({
      where: { id: myPlayer.id },
      data: {
        finishedAt: new Date(),
        timeTakenSeconds: timeTaken,
        unanswered: Math.max(0, challenge.questionCount - answered),
      },
    });

    // إذا كان الخصم هو البوت: نحاكي إجاباته وننهيها فورياً وبشكل ذكي!
    const other = challenge.players.find((p) => p.studentId !== me.id);
    if (other && this.isBotStudentId(other.studentId)) {
      await this.simulateBotPlayIfDue(challenge, timeTaken);
    } else if (other && !other.finishedAt) {
      await this.notificationsService
        .notify({
          userId: other.student.userId,
          type: 'CHALLENGE_OPPONENT_FINISHED',
          title: 'أنهى خصمك جزئه',
          body: 'أنهى خصمك أسئلته — أنتظر النتيجة بعد انتهاء وقتك أو إجابتك على الكل.',
          linkUrl: `/challenges/${challengeId}`,
        })
        .catch(() => undefined);
    }

    await this.completeIfFinished(challengeId);
    return { message: 'تم تسليم إجاباتك بنجاح.', isCompleted: true };
  }

  /** Winner logic: score DESC → time ASC → draw. */
  private determineWinner(players: { studentId: string; score: number; timeTakenSeconds: number | null }[]) {
    const [a, b] = players;
    if (!a || !b) return null;
    if (a.score !== b.score) return a.score > b.score ? a.studentId : b.studentId;
    const at = a.timeTakenSeconds ?? Infinity;
    const bt = b.timeTakenSeconds ?? Infinity;
    if (at !== bt) return at < bt ? a.studentId : b.studentId;
    return null; // draw
  }

  /** Close the challenge when both players finished OR time expired. */
  private async completeIfFinished(challengeId: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: { players: { include: { student: { select: { userId: true } } } } },
    });
    if (!challenge || challenge.status !== ChallengeStatus.IN_PROGRESS) return;

    const timeUp = challenge.expiresAt ? Date.now() >= challenge.expiresAt.getTime() : false;
    const allFinished = challenge.players.every((p) => p.finishedAt);
    if (!timeUp && !allFinished) return;

    // وضع البوت عند انتهاء الوقت
    await this.simulateBotPlayIfDue(challenge);

    // حساب الأسئلة المتبقية لغير المنتهين عند نفاد الوقت
    for (const player of challenge.players) {
      const answered = await this.prisma.challengeAnswer.count({
        where: { challengeId, playerId: player.id },
      });
      await this.prisma.challengePlayer.update({
        where: { id: player.id },
        data: {
          unanswered: Math.max(0, challenge.questionCount - answered),
          finishedAt: player.finishedAt ?? new Date(),
          timeTakenSeconds:
            player.timeTakenSeconds ??
            Math.min(
              Math.max(1, Math.round((Date.now() - (challenge.startedAt?.getTime() ?? Date.now())) / 1000)),
              challenge.durationSeconds,
            ),
        },
      });
    }

    const refreshed = await this.prisma.challengePlayer.findMany({ where: { challengeId } });
    const winnerId = this.determineWinner(refreshed);

    await this.prisma.challenge.update({
      where: { id: challengeId },
      data: { status: ChallengeStatus.COMPLETED },
    });

    for (const player of challenge.players) {
      const row = refreshed.find((r) => r.studentId === player.studentId)!;
      if (this.isBotStudentId(player.studentId)) continue;
      const outcome =
        winnerId === null ? 'تعادل' : winnerId === player.studentId ? 'فوز' : 'خسارة';
      await this.notificationsService
        .notify({
          userId: player.student.userId,
          type: 'CHALLENGE_COMPLETED',
          title: `انتهى التحدي — ${outcome}`,
          body: `نتيجتك: ${row.score} من ${challenge.questionCount}.`,
          linkUrl: `/challenges/${challengeId}/result`,
        })
        .catch(() => undefined);
    }
  }

  /**
   * محاكاة ذكية وسريعة للعب البوت:
   * تنهي إجابات البوت في ثوانٍ بعد انتهاء الطالب وبوقت واقعي قريب منه
   */
  private async simulateBotPlayIfDue(
    challenge: {
      id: string;
      opponentId: string;
      startedAt: Date | null;
      durationSeconds: number;
      questionCount: number;
      players: { id: string; studentId: string; finishedAt: Date | null }[];
    },
    humanTimeTaken?: number,
  ) {
    const bot = await this.getBotStudent();
    if (challenge.opponentId !== bot.id) return;

    const botPlayer = challenge.players.find((p) => p.studentId === bot.id);
    if (!botPlayer || botPlayer.finishedAt) return;

    const snapshot = await this.prisma.challengeQuestion.findMany({
      where: { playerId: botPlayer.id },
      select: { questionId: true },
    });
    const answeredRows = await this.prisma.challengeAnswer.findMany({
      where: { challengeId: challenge.id, playerId: botPlayer.id },
      select: { questionId: true },
    });
    const answeredSet = new Set(answeredRows.map((a) => a.questionId));
    const remainingQuestions = snapshot.filter((q) => !answeredSet.has(q.questionId));

    let correct = 0;
    let wrong = 0;

    if (remainingQuestions.length > 0) {
      const qIds = remainingQuestions.map((q) => q.questionId);
      const questionMap = await this.getQuestionDataMap(qIds);

      for (const q of remainingQuestions) {
        const item = questionMap.get(q.questionId);
        if (!item) continue;
        const optionCount = item.options.length || 4;
        const isCorrect = Math.random() < BOT_CORRECT_PROBABILITY;
        const selectedOption = isCorrect
          ? item.correctOptionIndex
          : this.pickWrongOption(optionCount, item.correctOptionIndex);

        if (isCorrect) correct++;
        else wrong++;

        await this.prisma.challengeAnswer.create({
          data: {
            challengeId: challenge.id,
            playerId: botPlayer.id,
            questionId: q.questionId,
            selectedOption,
            isCorrect,
          },
        });
      }
    }

    // احتساب وقت البوت بذكاء وواقعية بناءً على وقت الطالب الفعلي
    let botTime: number;
    if (humanTimeTaken && humanTimeTaken > 0) {
      // زمن البوت حول وقت الطالب (+/- 15%) بدون تأخير
      const variance = 0.88 + Math.random() * 0.26;
      botTime = Math.max(
        5,
        Math.min(challenge.durationSeconds, Math.round(humanTimeTaken * variance + 1)),
      );
    } else {
      const totalTime = challenge.durationSeconds;
      botTime = Math.max(
        15,
        Math.round(totalTime * (0.4 + Math.random() * 0.35)),
      );
    }

    await this.prisma.challengePlayer.update({
      where: { id: botPlayer.id },
      data: {
        score: { increment: correct },
        correct: { increment: correct },
        wrong: { increment: wrong },
        unanswered: Math.max(0, challenge.questionCount - correct - wrong - answeredSet.size),
        finishedAt: new Date(),
        timeTakenSeconds: botTime,
      },
    });
  }

  private pickWrongOption(optionCount: number, correctIndex: number) {
    if (optionCount <= 1) return 0;
    let idx = Math.floor(Math.random() * optionCount);
    if (idx === correctIndex) idx = (idx + 1) % optionCount;
    return idx;
  }

  /** نتيجة تفصيلية مع مراجعة الأسئلة والإجابات والتفسيرات للطلاب */
  async getResult(challengeId: string, userId: string) {
    const me = await this.getStudent(userId);
    const challenge = await this.getChallengeForPlayer(challengeId, me.id);
    await this.autoExpireIfNeeded(challenge);

    const players = await this.prisma.challengePlayer.findMany({
      where: { challengeId },
      include: { student: { select: { fullName: true, photoUrl: true } } },
    });

    if (challenge.status !== ChallengeStatus.COMPLETED) {
      const iFinished =
        players.find((p) => p.studentId === me.id)?.finishedAt != null;
      return {
        status: challenge.status,
        revealed: false,
        message: allDoneOrExpired(challenge.expiresAt, players)
          ? undefined
          : iFinished
            ? 'بانتظار انتهاء الخصم…'
            : 'أكمل أسئلتك أولاً لعرض النتيجة.',
        remainingSeconds: this.remainingSeconds(challenge),
      };
    }

    const rows = players.map((p) => ({
      studentId: p.studentId,
      fullName: p.student.fullName,
      photoUrl: p.student.photoUrl,
      score: p.score,
      correct: p.correct,
      wrong: p.wrong,
      unanswered: p.unanswered,
      timeTakenSeconds: p.timeTakenSeconds,
      finished: Boolean(p.finishedAt),
    }));
    const winnerId = this.determineWinner(rows);

    // جلب مراجعة الأسئلة بالتفصيل لهذا الطالب
    const myPlayer = players.find((p) => p.studentId === me.id);
    let review: any[] = [];
    if (myPlayer) {
      const myQuestions = await this.prisma.challengeQuestion.findMany({
        where: { playerId: myPlayer.id },
        orderBy: { order: 'asc' },
      });
      const qIds = myQuestions.map((q) => q.questionId);
      const questionMap = await this.getQuestionDataMap(qIds);

      const myAnswers = await this.prisma.challengeAnswer.findMany({
        where: { challengeId, playerId: myPlayer.id },
      });
      const answerMap = new Map(myAnswers.map((a) => [a.questionId, a]));

      review = myQuestions.map((q) => {
        const item = questionMap.get(q.questionId);
        const ans = answerMap.get(q.questionId);
        return {
          questionId: q.questionId,
          order: q.order,
          text: item?.text ?? 'سؤال محذوف',
          imageUrl: item?.imageUrl ?? null,
          options: item?.options ?? [],
          selectedOption: ans?.selectedOption ?? null,
          correctOptionIndex: item?.correctOptionIndex ?? null,
          isCorrect: ans?.isCorrect ?? false,
          explanation: item?.explanation ?? null,
          sourceType: item?.sourceType ?? 'BANK',
        };
      });
    }

    return {
      status: challenge.status,
      revealed: true,
      outcome:
        winnerId === null ? 'DRAW' : winnerId === me.id ? 'WON' : 'LOST',
      players: rows,
      review,
    };
  }

  async listMyChallenges(userId: string) {
    const me = await this.getStudent(userId);
    const bot = await this.getBotStudent();

    const challenges = await this.prisma.challenge.findMany({
      where: {
        OR: [{ challengerId: me.id }, { opponentId: me.id }],
        status: { in: ['PENDING', 'READY', 'IN_PROGRESS', 'COMPLETED'] },
      },
      include: {
        course: { select: { title: true } },
        challenger: { select: { id: true, fullName: true, photoUrl: true } },
        opponent: { select: { id: true, fullName: true, photoUrl: true } },
        players: { select: { studentId: true, score: true, timeTakenSeconds: true, finishedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return challenges.map((c) => {
      const myPlayer = c.players.find((p) => p.studentId === me.id);
      const opponentPlayer = c.players.find((p) => p.studentId !== me.id);
      const vsBot = c.opponentId === bot.id || c.challengerId === bot.id;

      let outcome: 'WON' | 'LOST' | 'DRAW' | null = null;
      if (c.status === ChallengeStatus.COMPLETED && myPlayer && opponentPlayer) {
        const winnerId = this.determineWinner([myPlayer, opponentPlayer]);
        outcome = winnerId === null ? 'DRAW' : winnerId === me.id ? 'WON' : 'LOST';
      }

      return {
        id: c.id,
        courseTitle: c.course.title,
        status: c.status,
        questionCount: c.questionCount,
        createdAt: c.createdAt,
        challenger: c.challenger.fullName,
        challengerPhotoUrl: c.challenger.photoUrl,
        opponent: c.opponent.fullName,
        opponentPhotoUrl: c.opponent.photoUrl,
        iAmChallenger: c.challengerId === me.id,
        myScore: myPlayer?.score ?? null,
        opponentScore: opponentPlayer?.score ?? null,
        timeTakenSeconds: myPlayer?.timeTakenSeconds ?? null,
        outcome,
        vsBot,
      };
    });
  }

  /** Server-computed online students in a course — يستثني الطالب نفسه لمنع تحدي النفس */
  async getOnlineStudents(courseId: string, excludeUserId?: string) {
    let excludeStudentId: string | null = null;
    if (excludeUserId) {
      const me = await this.prisma.studentProfile.findUnique({
        where: { userId: excludeUserId },
        select: { id: true },
      });
      excludeStudentId = me?.id ?? null;
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: { courseId, status: EnrollmentStatus.ACTIVE },
      include: { student: { select: { id: true, userId: true, fullName: true, photoUrl: true, lastSeenAt: true } } },
    });
    const now = Date.now();
    return {
      onlineStudents: enrollments
        .filter(
          (e) =>
            e.student.id !== excludeStudentId &&
            e.student.lastSeenAt &&
            now - e.student.lastSeenAt.getTime() < ONLINE_THRESHOLD_MS,
        )
        .map((e) => ({
          studentId: e.student.id,
          userId: e.student.userId,
          fullName: e.student.fullName,
          photoUrl: e.student.photoUrl,
        })),
    };
  }

  /** Client heartbeat — updates lastSeenAt (presence computed server-side). */
  async heartbeat(userId: string) {
    const me = await this.getStudent(userId);
    await this.prisma.studentProfile.update({
      where: { id: me.id },
      data: { lastSeenAt: new Date() },
    });
    return { online: true };
  }

  // ─── helpers ─────────────────────────────────────────────────

  private remainingSeconds(challenge: { status: ChallengeStatus; expiresAt: Date | null }) {
    if (challenge.status !== 'IN_PROGRESS' || !challenge.expiresAt) return 0;
    return Math.max(
      0,
      Math.ceil((challenge.expiresAt.getTime() - Date.now()) / 1000),
    );
  }

  private async autoExpireIfNeeded(challenge: {
    id: string;
    status: ChallengeStatus;
    expiresAt: Date | null;
  }) {
    if (challenge.status === ChallengeStatus.IN_PROGRESS && this.remainingSeconds(challenge) <= 0) {
      await this.completeIfFinished(challenge.id);
    }
  }

  private async getChallengeForPlayer(challengeId: string, studentId: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        players: {
          include: { student: { select: { userId: true } } },
        },
      },
    });
    if (!challenge) throw new NotFoundException('Challenge not found.');
    if (challenge.challengerId !== studentId && challenge.opponentId !== studentId) {
      throw new ForbiddenException('You are not a participant in this challenge.');
    }
    return challenge;
  }

  /** Cron sweep: close any challenges whose window ended. */
  @Cron('30 * * * *')
  async sweepExpiredChallenges() {
    try {
      const inProgress = await this.prisma.challenge.findMany({
        where: { status: ChallengeStatus.IN_PROGRESS, expiresAt: { lte: new Date() } },
        select: { id: true },
      });
      for (const c of inProgress) await this.completeIfFinished(c.id);
    } catch (error) {
      void error;
    }
  }
}

function allDoneOrExpired(expiresAt: Date | null, players: { finishedAt: Date | null }[]) {
  const timeUp = expiresAt ? Date.now() >= expiresAt.getTime() : false;
  return timeUp || players.every((p) => p.finishedAt);
}
