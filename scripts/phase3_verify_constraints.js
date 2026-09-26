const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const rows = await p.$queryRaw`
    SELECT conname FROM pg_constraint
    WHERE conname IN ('subject_assignments_subject_id_grade_id_track_id_key','course_targets_course_id_grade_id_track_id_key')
    UNION ALL
    SELECT indexname FROM pg_indexes
    WHERE indexname IN ('subject_assignments_subject_grade_null_track_key','course_targets_course_grade_null_track_key')`;
  console.log(rows);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => p.$disconnect());
