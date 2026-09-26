const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

function findDupes(rows, keyFn, label) {
  const seen = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (seen.has(k)) console.log(`DUPLICATE ${label}: ${k} (${seen.get(k)} vs ${r.id})`);
    else seen.set(k, r.id);
  }
  console.log(`${label}: ${rows.length} rows checked`);
}

(async () => {
  await p.subjectAssignment.findMany().then((rows) =>
    findDupes(rows, (r) => `${r.subjectId}|${r.gradeId}|${r.trackId || "NULL"}`, "SubjectAssignment")
  );
  await p.courseTarget.findMany().then((rows) =>
    findDupes(rows, (r) => `${r.courseId}|${r.gradeId}|${r.trackId || "NULL"}`, "CourseTarget")
  );
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => p.$disconnect());
