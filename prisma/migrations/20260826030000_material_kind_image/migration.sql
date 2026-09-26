-- Materials library: IMAGE file type + homework/material kind
-- Idempotent: enum values/column may already exist via `prisma db push`.

ALTER TYPE "MaterialType" ADD VALUE IF NOT EXISTS 'IMAGE';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MaterialKind') THEN
    CREATE TYPE "MaterialKind" AS ENUM ('MATERIAL', 'HOMEWORK');
  END IF;
END
$$;

ALTER TABLE "course_materials" ADD COLUMN IF NOT EXISTS "kind" "MaterialKind" NOT NULL DEFAULT 'MATERIAL';
