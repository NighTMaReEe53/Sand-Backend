/* Phase 2 — Migration: merge "الثانوية العامة" duplicates into canonical grades.
 * Order: backup -> re-point -> de-dup -> verify zero refs -> delete (tracks, grades, stage, system).
 * Run with --execute to actually apply; without it, dry-run only.
 */
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const EXECUTE = process.argv.includes("--execute");

const DUP_SYSTEM_CODE = "SECONDARY_GENERAL";
// SG_SEC_X -> canonical SEC_X
const gradeCodeMap = { SG_SEC_1: "SEC_1", SG_SEC_2: "SEC_2", SG_SEC_3: "SEC_3" };
const trackSuffix = (code) => code.split(":")[1]; // e.g. "SG_SEC_3:MATH" -> "MATH"

async function backup() {
  const dupGrades = await prisma.grade.findMany({
    where: { code: { in: Object.keys(gradeCodeMap) } },
  });
  const dupGradeIds = dupGrades.map((g) => g.id);
  const dupStage = await prisma.educationalStage.findFirst({ where: { code: "SG_SECONDARY" } });
  const dupSystem = await prisma.educationSystem.findFirst({ where: { code: DUP_SYSTEM_CODE } });

  const payload = {
    backedUpAt: new Date().toISOString(),
    educationSystems: dupSystem ? [dupSystem] : [],
    educationalStages: dupStage ? [dupStage] : [],
    grades: dupGrades,
    tracks: await prisma.track.findMany({ where: { gradeId: { in: dupGradeIds } } }),
    subjectAssignments: await prisma.subjectAssignment.findMany({
      where: { gradeId: { in: dupGradeIds } },
    }),
    courseTargets: await prisma.courseTarget.findMany({
      where: { gradeId: { in: dupGradeIds } },
    }),
    studentEducationProfiles: await prisma.studentEducationProfile.findMany({
      where: { OR: [{ gradeId: { in: dupGradeIds } }, { stageId: dupStage?.id }, { educationSystemId: dupSystem?.id }] },
    }),
  };

  const dir = path.join(__dirname, "backup_dup_cleanup");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `backup_${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  console.log(`Backup written: ${file}`);
  return payload;
}

async function main() {
  console.log(`MODE: ${EXECUTE ? "EXECUTE" : "DRY-RUN"}\n`);
  const dupGrades = await prisma.grade.findMany({
    where: { code: { in: Object.keys(gradeCodeMap) } },
    include: { tracks: true },
  });
  if (dupGrades.length !== 3) throw new Error(`Expected 3 duplicate grades, found ${dupGrades.length}`);
  const canon = {};
  for (const c of Object.values(gradeCodeMap)) {
    canon[c] = await prisma.grade.findUnique({ where: { code: c }, include: { tracks: true } });
    if (!canon[c]) throw new Error(`Canonical grade ${c} missing!`);
  }

  await backup();

  // --- Step 1: re-point CourseTargets ---
  console.log("\n--- Step 1: CourseTargets ---");
  for (const dg of dupGrades) {
    const targets = await prisma.courseTarget.findMany({
      where: { gradeId: dg.id },
      include: { track: true },
    });
    for (const t of targets) {
      const targetCode = gradeCodeMap[dg.code];
      let newTrackId = null;
      if (t.trackId && t.track) {
        const suffix = trackSuffix(t.track.code);
        const ct = canon[targetCode].tracks.find((tr) => tr.code.endsWith(`:${suffix}`));
        if (!ct) throw new Error(`No canonical track ${targetCode}:${suffix} for target ${t.id}`);
        newTrackId = ct.id;
      }
      const collision = await prisma.courseTarget.findFirst({
        where: {
          courseId: t.courseId,
          gradeId: canon[targetCode].id,
          ...(t.trackId ? { trackId: newTrackId } : { trackId: null }),
        },
      });
      if (collision) {
        console.log(
          `[${EXECUTE ? "DELETE" : "WOULD DELETE"}] duplicate CourseTarget ${t.id} (course=${t.courseId}, ${dg.code}${t.track ? ":" + trackSuffix(t.track.code) : ""}) — canonical already exists (${collision.id})`
        );
        if (EXECUTE) await prisma.courseTarget.delete({ where: { id: t.id } });
      } else {
        console.log(
          `[${EXECUTE ? "UPDATE" : "WOULD UPDATE"}] CourseTarget ${t.id}: ${dg.code} -> ${targetCode}${newTrackId ? " + track re-pointed" : ""}`
        );
        if (EXECUTE)
          await prisma.courseTarget.update({
            where: { id: t.id },
            data: { gradeId: canon[targetCode].id, ...(t.trackId ? { trackId: newTrackId } : {}) },
          });
      }
    }
  }

  // --- Step 2: delete duplicate tracks ---
  console.log("\n--- Step 2: duplicate Tracks ---");
  for (const dg of dupGrades) {
    for (const tr of dg.tracks) {
      console.log(`[${EXECUTE ? "DELETE" : "WOULD DELETE"}] Track ${tr.code} (${tr.name})`);
      if (EXECUTE) await prisma.track.delete({ where: { id: tr.id } });
    }
  }

  // --- Step 3: verify zero remaining references to duplicate grades ---
  console.log("\n--- Step 3: reference verification ---");
  const dupIds = dupGrades.map((g) => g.id);
  const refs = {
    tracks: await prisma.track.count({ where: { gradeId: { in: dupIds } } }),
    subjectAssignments: await prisma.subjectAssignment.count({ where: { gradeId: { in: dupIds } } }),
    courseTargets: await prisma.courseTarget.count({ where: { gradeId: { in: dupIds } } }),
    studentProfiles: await prisma.studentEducationProfile.count({ where: { gradeId: { in: dupIds } } }),
  };
  const totalRefs = Object.values(refs).reduce((a, b) => a + b, 0);
  console.log("Remaining references to duplicate grades:", JSON.stringify(refs), `total=${totalRefs}`);
  if (totalRefs > 0) throw new Error("ABORT: references remain — nothing will be deleted.");

  // --- Step 4: delete duplicate grades, stage, system ---
  console.log("\n--- Step 4: delete grades / stage / system ---");
  for (const dg of dupGrades) {
    console.log(`[${EXECUTE ? "DELETE" : "WOULD DELETE"}] Grade ${dg.code} ("${dg.name}")`);
    if (EXECUTE) await prisma.grade.delete({ where: { id: dg.id } });
  }
  const stage = await prisma.educationalStage.findFirst({ where: { code: "SG_SECONDARY" } });
  if (stage) {
    const stillGrades = await prisma.grade.count({ where: { stageId: stage.id } });
    if (stillGrades > 0) throw new Error(`Stage SG_SECONDARY still has ${stillGrades} grades`);
    const profRefs = await prisma.studentEducationProfile.count({ where: { stageId: stage.id } });
    if (profRefs > 0) throw new Error(`Stage SG_SECONDARY referenced by ${profRefs} student profiles`);
    console.log(`[${EXECUTE ? "DELETE" : "WOULD DELETE"}] Stage SG_SECONDARY ("${stage.name}")`);
    if (EXECUTE) await prisma.educationalStage.delete({ where: { id: stage.id } });
  }
  const sys = await prisma.educationSystem.findFirst({
    where: { code: DUP_SYSTEM_CODE },
    include: { stages: true, studentProfiles: true },
  });
  if (sys) {
    if (sys.stages.length > 0) throw new Error(`System SECONDARY_GENERAL still has ${sys.stages.length} stages`);
    if (sys.studentProfiles.length > 0)
      throw new Error(`System SECONDARY_GENERAL referenced by ${sys.studentProfiles.length} student profiles`);
    console.log(`[${EXECUTE ? "DELETE" : "WOULD DELETE"}] System SECONDARY_GENERAL ("${sys.name}")`);
    if (EXECUTE) await prisma.educationSystem.delete({ where: { id: sys.id } });
  }

  // --- Step 5: post-verification ---
  console.log("\n--- Step 5: post-verification ---");
  const remain = await Promise.all([
    prisma.educationSystem.count({ where: { code: DUP_SYSTEM_CODE } }),
    prisma.educationalStage.count({ where: { code: "SG_SECONDARY" } }),
    prisma.grade.count({ where: { code: { in: Object.keys(gradeCodeMap) } } }),
    prisma.track.count({ where: { code: { contains: "SG_SEC_" } } }),
    prisma.subjectAssignment.count({ where: { grade: { code: { startsWith: "SEC_" } }, isActive: true } }),
  ]);
  console.log(
    `systems="${remain[0]}" stages="${remain[1]}" dupGrades="${remain[2]}" sgTracks="${remain[3]}" secSubjectAssignments="${remain[4]}"`
  );
  const finalTree = await prisma.educationSystem.findMany({
    where: { code: "EDUCATION_GENERAL" },
    include: { stages: { include: { grades: { include: { tracks: true } } } } },
  });
  for (const s of finalTree)
    for (const st of s.stages)
      for (const g of st.grades)
        console.log(`${s.code} > ${st.code} > ${g.code} "${g.name}" tracks=[${g.tracks.map((t) => t.code).join(", ")}]`);

  console.log(`\nDone (${EXECUTE ? "applied" : "dry-run — rerun with --execute to apply"}).`);
}

main()
  .catch((e) => {
    console.error("\nMIGRATION FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
