const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.lesson.findMany({ select: { id: true, title: true, videoUrl: true, isPreview: true, isDeleted: true }, take: 20 })
  .then(rows => { console.log(JSON.stringify(rows, null, 1)); return p.$disconnect(); })
  .catch(e => { console.error('ERR', e.message); process.exit(1); });
