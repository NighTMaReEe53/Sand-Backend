-- Course access type: LIFETIME (forever lessons) vs LIMITED (timed bouquet)
-- Idempotent: columns may already exist in environments where the schema
-- was applied via `prisma db push` before this migration was authored.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccessType') THEN
    CREATE TYPE "AccessType" AS ENUM ('LIFETIME', 'LIMITED');
  END IF;
END
$$;

ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "access_type" "AccessType" NOT NULL DEFAULT 'LIFETIME';
ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "duration_months" INTEGER;
