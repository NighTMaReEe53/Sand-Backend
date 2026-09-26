const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const exams = await p.exam.findMany({
    where: { course: { isDeleted: true } },
    select: { id: true, title: true, createdAt: true, course: { select: { title: true, updatedAt: true } } },
  });
  console.log(JSON.stringify(exams, null, 1));
})()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
