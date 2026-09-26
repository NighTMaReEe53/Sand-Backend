-- Extend legacy GradeLevel enum so taxonomy grades without a GENERAL-system
-- equivalent (Azhar / Baccalaureate) can still populate the NOT NULL
-- student_profiles.grade_level compatibility column.
ALTER TYPE "GradeLevel" ADD VALUE IF NOT EXISTS 'AZHAR_PREP';
ALTER TYPE "GradeLevel" ADD VALUE IF NOT EXISTS 'AZHAR_SEC';
ALTER TYPE "GradeLevel" ADD VALUE IF NOT EXISTS 'BAC';
