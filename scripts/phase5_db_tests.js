/* Phase 5 — DB-level test suite for the duplicate cleanup */
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? " | " + detail : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? " | " + detail : ""}`); }
}

(async () => {
  // T1: no SECONDARY_GENERAL remnants anywhere
  const sys = await p.educationSystem.count({ where: { code: "SECONDARY_GENERAL" } });
  const stg = await p.educationalStage.count({ where: { code: { startsWith: "SG_" } } });
  const grd = await p.grade.count({ where: { code: { startsWith: "SG_SEC" } } });
  const trk = await p.track.count({ where: { code: { contains: "SG_SEC" } } });
  check("T1 no duplicate system/stage/grade/track rows", sys + stg + grd + trk === 0, `sys=${sys} stg=${stg} grd=${grd} trk=${trk}`);

  // T2: exactly one row per secondary grade name under GENERAL > SECONDARY
  const secGrades = await p.grade.findMany({
    where: { stage: { code: "SECONDARY" } },
    include: { stage: true },
    orderBy: { code: "asc" },
  });
  check("T2 exactly 3 grades under SECONDARY stage", secGrades.length === 3, secGrades.map((g) => g.code).join(","));
  const names = new Set(secGrades.map((g) => g.name));
  check("T2b grade names unique", names.size === 3);

  // T3: GradeTrack — exactly one track per track-code per grade
  const dupTracks = await p.$queryRaw`
    SELECT g.code AS grade_code, split_part(t.code, ':', 2) AS suffix, COUNT(*)::int AS n
    FROM tracks t JOIN grades g ON g.id = t.grade_id
    GROUP BY g.code, split_part(t.code, ':', 2)
    HAVING COUNT(*) > 1`;
  check("T3 no duplicated track per grade", dupTracks.length === 0);
  const t2 = await p.track.findMany({ where: { grade: { code: "SEC_2" } } });
  const t3 = await p.track.findMany({ where: { grade: { code: "SEC_3" } } });
  check("T3b SEC_2 has exactly 3 tracks", t2.length === 3, t2.map((x) => x.code).join(","));
  check("T3c SEC_3 has exactly 3 tracks", t3.length === 3, t3.map((x) => x.code).join(","));

  // T4: no duplicate SubjectAssignment combos
  const dupSA = await p.$queryRaw`
    SELECT subject_id, grade_id, COALESCE(track_id::text,'NULL') AS track, COUNT(*)::int AS n
    FROM subject_assignments GROUP BY 1,2,3 HAVING COUNT(*) > 1`;
  check("T4 no duplicate SubjectAssignment rows", dupSA.length === 0);

  // T5: no duplicate CourseTarget combos
  const dupCT = await p.$queryRaw`
    SELECT course_id, grade_id, COALESCE(track_id::text,'NULL') AS track, COUNT(*)::int AS n
    FROM course_targets GROUP BY 1,2,3 HAVING COUNT(*) > 1`;
  check("T5 no duplicate CourseTarget rows", dupCT.length === 0);

  // T6: all courses resolve to canonical grades only
  const badTargets = await p.courseTarget.count({ where: { grade: { code: { startsWith: "SG_" } } } });
  check("T6 zero CourseTargets on retired grades", badTargets === 0);
  const courseTargets = await p.courseTarget.findMany({
    include: { grade: true, track: true, course: { select: { title: true, status: true, isDeleted: true } } },
  });
  for (const ct of courseTargets) {
    check(
      `T7 course "${ct.course.title}" target resolves to live canonical grade`,
      !ct.course.isDeleted && ct.grade.isActive && (!ct.track || ct.track.isActive),
      `${ct.grade.code}:${ct.track ? ct.track.code : "-"} (${ct.course.status})`
    );
  }

  // T8: student education profiles all reference existing taxonomy rows with valid chains
  const profiles = await p.studentEducationProfile.findMany({
    include: { system: true, stage: true, grade: true, track: true },
  });
  let chainOk = true;
  for (const pr of profiles) {
    if (
      pr.stage.educationSystemId !== pr.system.id ||
      pr.grade.stageId !== pr.stage.id ||
      (pr.track && pr.track.gradeId !== pr.grade.id)
    )
      chainOk = false;
  }
  check(`T8 ${profiles.length} student profile(s) have consistent system>stage>grade>track chains`, chainOk);

  // T9: exams unaffected — every exam belongs to a non-deleted course
  const orphanExams = await p.exam.count({ where: { course: { isDeleted: true } } });
  check("T9 no exams on deleted courses", orphanExams === 0, `orphans=${orphanExams}`);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exitCode = fail > 0 ? 1 : 0;
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => p.$disconnect());
