import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@elearning.com';
  const adminPhone = process.env.DEFAULT_ADMIN_PHONE || '01000000000';
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@Password123';

  console.log(`[Seed] Checking for default admin user (${adminEmail})...`);

  const existingAdmin = await prisma.user.findFirst({
    where: {
      OR: [{ email: adminEmail }, { phone: adminPhone }],
    },
  });

  if (existingAdmin) {
    console.log(`[Seed] Admin user already exists with ID: ${existingAdmin.id}`);
    return;
  }

  const saltRounds = 12;
  const passwordHash = await bcrypt.hash(adminPassword, saltRounds);

  const admin = await prisma.user.create({
    data: {
      email: adminEmail,
      phone: adminPhone,
      passwordHash,
      role: Role.ADMIN,
      isVerified: true,
      isActive: true,
    },
  });

  console.log(`[Seed] Default admin created successfully!`);
  console.log(`[Seed] Email: ${admin.email}`);
  console.log(`[Seed] Role: ${admin.role}`);
  console.log(`[Seed] ID: ${admin.id}`);
}

main()
  .catch((e) => {
    console.error('[Seed] Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
