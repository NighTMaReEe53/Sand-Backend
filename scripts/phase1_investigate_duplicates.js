/* Phase 1 — READ-ONLY investigation of "الثانوية العامة" duplication */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("=== 2.1 Education Systems ===");
  const systems = await prisma.educationSystem.findMany({
    include: { stages: { include: { grades: true } } },
  });
  for (const s of systems) {
    console.log(`\nSYSTEM ${s.code} | "${s.name}" | id=${s.id} | active=${s.isActive}`);
    for (const st of s.stages) {
      console.log(`  STAGE ${st.code} | "${st.name}" | id=${st.id} | active=${st.isActive}`);
      for (const g of st.grades) {
        console.log(`    GRADE ${g.code} | "${g.name}" | id=${g.id} | hasTracks=${g.hasTracks} | active=${g.isActive}`);
      }
    }
  }

  console.log("\n=== 2.1b Grades named اولى/تانية/تالتة ثانوي across all stages ===");
  const secGrades = await prisma.grade.findMany({
    where: { OR: [{ name: { contains: "ثانوي" } }, { code: { contains: "SEC" } }] },
    include: { stage: { include: { educationSystem: true } } },
    orderBy: { code: "asc" },
  });
  for (const g of secGrades) {
    console.log(
      `"${g.name}" | code=${g.code} | id=${g.id} | stage="${g.stage.name}" (${g.stage.code}) | system="${g.stage.educationSystem.name}" (${g.stage.educationSystem.code}) | hasTracks=${g.hasTracks}`
    );
  }

  console.log("\n=== 2.2 Dependent record counts per grade ===");
  const allSec = await prisma.grade.findMany({
    where: { OR: [{ name: { contains: "ثانوي" } }, { code: { contains: "SEC" } }] },
    select: { id: true, name: true, code: true },
  });
  for (const g of allSec) {
    const [tracks, assignments, courseTargets, profiles] = await Promise.all([
      prisma.track.count({ where: { gradeId: g.id } }),
      prisma.subjectAssignment.count({ where: { gradeId: g.id } }),
      prisma.courseTarget.count({ where: { gradeId: g.id } }),
      prisma.studentEducationProfile.count({ where: { gradeId: g.id } }),
    ]);
    console.log(
      `grade "${g.name}" (${g.code}, ${g.id}): tracks=${tracks}, subjectAssignments=${assignments}, courseTargets=${courseTargets}, studentProfiles=${profiles}`
    );
  }

  console.log("\n=== 2.3 Tracks per secondary grade ===");
  const trackRows = await prisma.track.findMany({
    where: { grade: { OR: [{ name: { contains: "ثانوي" } }, { code: { contains: "SEC" } }] } },
    include: { grade: true },
    orderBy: { gradeId: "asc" },
  });
  for (const t of trackRows) {
    console.log(`track "${t.name}" (${t.code}) -> grade "${t.grade.name}" (${t.grade.code}) | active=${t.isActive}`);
  }

  console.log("\n=== Orphan/duplicate check: same grade code appearing twice ===");
  const grouped = {};
  for (const g of allSec) {
    (grouped[g.code] = grouped[g.code] || []).push(g);
  }
  for (const [code, list] of Object.entries(grouped)) {
    if (list.length > 1) console.log(`DUPLICATE CODE ${code}: x${list.length}`);
  }

  console.log("\n=== Stage/system-level duplicates of الثانوية العامة ===");
  const thanaweyaStages = await prisma.educationalStage.findMany({
    where: { OR: [{ name: { contains: "الثانوية العامة" } }, { code: { contains: "THANAWEYA" } }] },
    include: { educationSystem: true, grades: true },
  });
  const thanaweyaSystems = await prisma.educationSystem.findMany({
    where: { OR: [{ name: { contains: "الثانوية العامة" } }, { code: { contains: "THANAWEYA" } }] },
    include: { stages: true },
  });
  console.log(`Stages matching: ${thanaweyaStages.length}`);
  for (const st of thanaweyaStages)
    console.log(`  stage "${st.name}" (${st.code}) under system "${st.educationSystem.name}", grades=${st.grades.length}`);
  console.log(`Systems matching: ${thanaweyaSystems.length}`);
  for (const sy of thanaweyaSystems)
    console.log(`  system "${sy.name}" (${sy.code}), stages=${sy.stages.length}`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
