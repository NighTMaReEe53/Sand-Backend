const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.courseTarget
  .findMany({
    include: {
      course: { select: { id: true, title: true, status: true, isDeleted: true } },
      grade: { select: { code: true, name: true } },
      track: { select: { code: true, name: true } },
    },
  })
  .then((rows) => {
    for (const r of rows)
      console.log(
        `target=${r.id} | course="${r.course.title}" (${r.course.status}, deleted=${r.course.isDeleted}) | grade=${r.grade.code} "${r.grade.name}" | track=${r.track ? r.track.code : "-"}`
      );
  })
  .catch((e) => console.error(e))
  .finally(() => p.$disconnect());
