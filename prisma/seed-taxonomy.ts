/**
 * Education Taxonomy seed — idempotent (safe to re-run), keyed by `code`.
 * Run: npm run prisma:seed:taxonomy
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type TrackSeed = { code: string; name: string };
type GradeSeed = {
  code: string;
  name: string;
  hasTracks?: boolean;
  tracks?: TrackSeed[];
};
type StageSeed = { code: string; name: string; grades: GradeSeed[] };
type SystemSeed = { code: string; name: string; stages: StageSeed[] };

const SYSTEMS: SystemSeed[] = [
  {
    code: 'EDUCATION_GENERAL',
    name: 'التعليم العام',
    stages: [
      {
        code: 'PREP',
        name: 'الإعدادية',
        grades: [
          { code: 'PREP_1', name: 'الأول الإعدادي' },
          { code: 'PREP_2', name: 'الثاني الإعدادي' },
          { code: 'PREP_3', name: 'الثالث الإعدادي' },
        ],
      },
      {
        code: 'SECONDARY',
        name: 'الثانوية',
        grades: [
          { code: 'SEC_1', name: 'الأول الثانوي' },
          {
            code: 'SEC_2',
            name: 'الثاني الثانوي',
            hasTracks: true,
            tracks: [
              { code: 'SCIENCE', name: 'علمي علوم' },
              { code: 'MATH', name: 'علمي رياضة' },
              { code: 'LITERARY', name: 'أدبي' },
            ],
          },
          {
            code: 'SEC_3',
            name: 'الثالث الثانوي',
            hasTracks: true,
            tracks: [
              { code: 'SCIENCE', name: 'علمي علوم' },
              { code: 'MATH', name: 'علمي رياضة' },
              { code: 'LITERARY', name: 'أدبي' },
            ],
          },
        ],
      },
    ],
  },
  {
    // NOTE: kept for data preservation only — deactivated below so the
    // visible hierarchy is exactly GENERAL / AZHAR / BACCALAUREATE.
    code: 'SECONDARY_GENERAL',
    name: 'الثانوية العامة',
    stages: [
      {
        code: 'SG_SECONDARY',
        name: 'الثانوية العامة',
        grades: [
          { code: 'SG_SEC_1', name: 'الأول الثانوي' },
          {
            code: 'SG_SEC_2',
            name: 'الثاني الثانوي',
            hasTracks: true,
            tracks: [
              { code: 'SCIENCE', name: 'علمي علوم' },
              { code: 'MATH', name: 'علمي رياضة' },
              { code: 'LITERARY', name: 'أدبي' },
            ],
          },
          {
            code: 'SG_SEC_3',
            name: 'الثالث الثانوي',
            hasTracks: true,
            tracks: [
              { code: 'SCIENCE', name: 'علمي علوم' },
              { code: 'MATH', name: 'علمي رياضة' },
              { code: 'LITERARY', name: 'أدبي' },
            ],
          },
        ],
      },
    ],
  },
  {
    code: 'AZHAR_SECONDARY',
    name: 'الأزهرية',
    stages: [
      {
        code: 'AZHAR_PREP',
        name: 'الإعدادية الأزهرية',
        grades: [
          { code: 'AZHAR_PREP_1', name: 'الأول الإعدادي الأزهري' },
          { code: 'AZHAR_PREP_2', name: 'الثاني الإعدادي الأزهري' },
          { code: 'AZHAR_PREP_3', name: 'الثالث الإعدادي الأزهري' },
        ],
      },
      {
        code: 'AZHAR_SECONDARY_STAGE',
        name: 'الثانوية الأزهرية',
        grades: [
          { code: 'AZHAR_SEC_1', name: 'الأول الثانوي الأزهري' },
          {
            code: 'AZHAR_SEC_2',
            name: 'الثاني الثانوي الأزهري',
            hasTracks: true,
            tracks: [
              { code: 'LITERARY', name: 'أدبي' },
              { code: 'SCIENCE', name: 'علمي علوم' },
              { code: 'MATH', name: 'علمي رياضة' },
            ],
          },
          {
            code: 'AZHAR_SEC_3',
            name: 'الثالث الثانوي الأزهري',
            hasTracks: true,
            tracks: [
              { code: 'LITERARY', name: 'أدبي' },
              { code: 'SCIENCE', name: 'علمي علوم' },
              { code: 'MATH', name: 'علمي رياضة' },
            ],
          },
        ],
      },
    ],
  },
  {
    code: 'EGY_BACCALAUREATE',
    name: 'البكالوريا المصرية',
    stages: [
      {
        code: 'BAC_SECONDARY',
        name: 'البكالوريا',
        grades: [
          { code: 'BAC_1', name: 'البكالوريا الأول' },
          { code: 'BAC_2', name: 'البكالوري الثاني' },
        ],
      },
    ],
  },
];

const SUBJECTS: { code: string; name: string }[] = [
  { code: 'ARABIC', name: 'لغة عربية' },
  { code: 'ENGLISH', name: 'لغة إنجليزية' },
  { code: 'FRENCH', name: 'لغة فرنسية' },
  { code: 'GERMAN', name: 'لغة ألمانية' },
  { code: 'MATH', name: 'رياضيات' },
  { code: 'SCIENCE', name: 'علوم' },
  { code: 'SOCIAL_STUDIES', name: 'دراسات اجتماعية' },
  { code: 'INTEGRATED_SCIENCE', name: 'علوم متكاملة' },
  { code: 'PHYSICS', name: 'فيزياء' },
  { code: 'CHEMISTRY', name: 'كيمياء' },
  { code: 'BIOLOGY', name: 'أحياء' },
  { code: 'GEOLOGY', name: 'جيولوجيا' },
  { code: 'HISTORY', name: 'تاريخ' },
  { code: 'GEOGRAPHY', name: 'جغرافيا' },
  { code: 'PHILOSOPHY', name: 'فلسفة' },
  { code: 'PSYCHOLOGY', name: 'علم نفس' },
  { code: 'STATISTICS', name: 'إحصاء' },
  { code: 'RELIGIOUS_EDU', name: 'تربية إسلامية' },
  { code: 'QURAN', name: 'قرآن كريم' },
  { code: 'HADITH', name: 'حديث شريف' },
  { code: 'TAFSIR', name: 'تفسير' },
  { code: 'FIQH', name: 'فقه' },
  { code: 'TAWHEED', name: 'توحيد' },
  { code: 'PROGRAMMING', name: 'البرمجة' },
];

/** subject → grade codes (+ optional track codes restriction) */
const ASSIGNMENTS: { subjectCode: string; gradeCodes: string[]; trackCodes?: string[] }[] = [
  { subjectCode: 'ARABIC', gradeCodes: ['PREP_1', 'PREP_2', 'PREP_3', 'SEC_1'] },
  { subjectCode: 'ENGLISH', gradeCodes: ['PREP_1', 'PREP_2', 'PREP_3', 'SEC_1'] },
  { subjectCode: 'MATH', gradeCodes: ['PREP_1', 'PREP_2', 'PREP_3', 'SEC_1'], trackCodes: ['SCIENCE', 'MATH'] },
  { subjectCode: 'SCIENCE', gradeCodes: ['PREP_1', 'PREP_2', 'PREP_3'] },
  { subjectCode: 'SOCIAL_STUDIES', gradeCodes: ['PREP_1', 'PREP_2', 'PREP_3'] },
  { subjectCode: 'INTEGRATED_SCIENCE', gradeCodes: ['SEC_1'] },
  { subjectCode: 'PHYSICS', gradeCodes: ['SEC_2', 'SEC_3'], trackCodes: ['SCIENCE', 'MATH'] },
  { subjectCode: 'CHEMISTRY', gradeCodes: ['SEC_2', 'SEC_3'], trackCodes: ['SCIENCE', 'MATH'] },
  { subjectCode: 'BIOLOGY', gradeCodes: ['SEC_2', 'SEC_3'], trackCodes: ['SCIENCE'] },
  { subjectCode: 'GEOLOGY', gradeCodes: ['SEC_3'], trackCodes: ['SCIENCE'] },
  { subjectCode: 'HISTORY', gradeCodes: ['SEC_2', 'SEC_3'], trackCodes: ['LITERARY'] },
  { subjectCode: 'GEOGRAPHY', gradeCodes: ['SEC_2', 'SEC_3'], trackCodes: ['LITERARY'] },
  { subjectCode: 'PHILOSOPHY', gradeCodes: ['SEC_3'], trackCodes: ['LITERARY'] },
  { subjectCode: 'PSYCHOLOGY', gradeCodes: ['SEC_3'], trackCodes: ['LITERARY'] },
  { subjectCode: 'STATISTICS', gradeCodes: ['SEC_3'], trackCodes: ['MATH'] },
  { subjectCode: 'QURAN', gradeCodes: ['AZHAR_PREP_1', 'AZHAR_PREP_2', 'AZHAR_PREP_3', 'AZHAR_SEC_1', 'AZHAR_SEC_2', 'AZHAR_SEC_3'] },
  { subjectCode: 'HADITH', gradeCodes: ['AZHAR_SEC_1', 'AZHAR_SEC_2', 'AZHAR_SEC_3'] },
  { subjectCode: 'TAFSIR', gradeCodes: ['AZHAR_SEC_2', 'AZHAR_SEC_3'] },
  { subjectCode: 'FIQH', gradeCodes: ['AZHAR_SEC_2', 'AZHAR_SEC_3'] },
  { subjectCode: 'TAWHEED', gradeCodes: ['AZHAR_SEC_3'] },
  // Programming is a normal subject (§18) — admin can extend availability later.
  { subjectCode: 'PROGRAMMING', gradeCodes: ['BAC_1', 'BAC_2'] },
];

async function main() {
  console.log('[Taxonomy Seed] Starting idempotent seed…');

  for (const sys of SYSTEMS) {
    const system = await prisma.educationSystem.upsert({
      where: { code: sys.code },
      create: { code: sys.code, name: sys.name },
      update: { name: sys.name },
    });

    for (const stage of sys.stages) {
      const stageRow = await prisma.educationalStage.upsert({
        where: { code: stage.code },
        create: { code: stage.code, name: stage.name, educationSystemId: system.id },
        update: { name: stage.name, educationSystemId: system.id },
      });

      for (const grade of stage.grades) {
        const gradeRow = await prisma.grade.upsert({
          where: { code: grade.code },
          create: {
            code: grade.code,
            name: grade.name,
            stageId: stageRow.id,
            hasTracks: Boolean(grade.hasTracks),
          },
          update: { name: grade.name, stageId: stageRow.id, hasTracks: Boolean(grade.hasTracks) },
        });

        for (const track of grade.tracks ?? []) {
          await prisma.track.upsert({
            where: { code: `${grade.code}:${track.code}` },
            create: { code: `${grade.code}:${track.code}`, name: track.name, gradeId: gradeRow.id },
            update: { name: track.name, gradeId: gradeRow.id },
          });
        }
      }
    }
  }
  console.log(`[Taxonomy Seed] Systems/stages/grades/tracks done (${SYSTEMS.length} systems).`);

  // §3 — exactly three ACTIVE systems (general / azhar / baccalaureate).
  // The legacy duplicate system is deactivated, NOT deleted, so existing
  // courses/targets referencing it remain intact (§29 data preservation).
  const deactivated = await prisma.educationSystem.updateMany({
    where: { code: 'SECONDARY_GENERAL' },
    data: { isActive: false },
  });
  if (deactivated.count) {
    console.log('[Taxonomy Seed] Deactivated legacy SECONDARY_GENERAL system (records preserved).');
  }

  for (const subject of SUBJECTS) {
    await prisma.subject.upsert({
      where: { code: subject.code },
      create: subject,
      update: { name: subject.name },
    });
  }
  console.log(`[Taxonomy Seed] Subjects done (${SUBJECTS.length}).`);

  // Subject assignments — validate track belongs to the given grade
  let assignments = 0;
  for (const a of ASSIGNMENTS) {
    const subject = await prisma.subject.findUnique({ where: { code: a.subjectCode } });
    if (!subject) continue;

    for (const gradeCode of a.gradeCodes) {
      const grade = await prisma.grade.findUnique({
        where: { code: gradeCode },
        include: { tracks: true },
      });
      if (!grade) continue;

      const trackIds =
        grade.hasTracks && a.trackCodes?.length
          ? grade.tracks.filter((t) => a.trackCodes!.some((tc) => t.code.endsWith(`:${tc}`))).map((t) => t.id)
          : [null];

      for (const trackId of trackIds) {
        const existing = await prisma.subjectAssignment.findFirst({
          where: { subjectId: subject.id, gradeId: grade.id, trackId },
        });
        if (!existing) {
          await prisma.subjectAssignment.create({
            data: { subjectId: subject.id, gradeId: grade.id, trackId },
          });
          assignments++;
        }
      }
    }
  }
  console.log(`[Taxonomy Seed] SubjectAssignments created: ${assignments} new.`);

  // ─── Backfill: map legacy enum gradeLevels → normalized CourseTargets ───
  // The legacy GradeLevel enum values map 1:1 to seeded Grade codes.
  const LEGACY_TO_GRADE: Record<string, string> = {
    PREP_1: 'PREP_1',
    PREP_2: 'PREP_2',
    PREP_3: 'PREP_3',
    SEC_1: 'SEC_1',
    SEC_2: 'SEC_2',
    // Legacy SEC_3 splits carry explicit tracks → target the grade with its matching track
    SEC_3_SCIENTIFIC: 'SEC_3',
    SEC_3_LITERARY: 'SEC_3',
  };
  const LEGACY_TRACK: Record<string, string> = {
    SEC_3_SCIENTIFIC: ':SCIENCE',
    SEC_3_LITERARY: ':LITERARY',
  };

  const legacyCourses = await prisma.course.findMany({
    where: { isDeleted: false, targets: { none: {} } },
    select: { id: true, gradeLevels: true, gradeLevel: true },
    take: 5000,
  });

  let mapped = 0;
  let flagged = 0;
  for (const course of legacyCourses) {
    const levels = course.gradeLevels.length ? course.gradeLevels : [course.gradeLevel];
    let anyMapped = false;
    try {
      for (const level of levels) {
        const gradeCode = LEGACY_TO_GRADE[level];
        if (!gradeCode) continue;
        const grade = await prisma.grade.findUnique({ where: { code: gradeCode } });
        if (!grade) continue;

        const trackSuffix = LEGACY_TRACK[level];
        const track = trackSuffix
          ? await prisma.track.findFirst({ where: { code: { endsWith: trackSuffix }, gradeId: grade.id } })
          : null;

        if (grade.hasTracks && !track && !trackSuffix) continue; // ambiguous → flag

        await prisma.courseTarget.create({
          data: { courseId: course.id, gradeId: grade.id, trackId: track?.id ?? null },
        });
        anyMapped = true;
      }
    } catch {
      // duplicate race — ignore
    }

    if (anyMapped) {
      mapped++;
      // Keep the legacy label in sync for the compatibility read-path
      if (!course.gradeLevels.length) {
        await prisma.course.update({ where: { id: course.id }, data: { gradeLevels: [course.gradeLevel] } });
      }
    } else {
      flagged++;
      await prisma.course.update({ where: { id: course.id }, data: { needsReview: true } });
    }
  }
  console.log(
    `[Taxonomy Seed] Backfill: ${mapped} courses mapped to targets, ${flagged} flagged needsReview.`,
  );

  console.log('[Taxonomy Seed] Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
