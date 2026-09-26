ALTER TABLE "courses"
ADD COLUMN "grade_levels" "GradeLevel"[] NOT NULL DEFAULT ARRAY[]::"GradeLevel"[];

UPDATE "courses"
SET "grade_levels" = ARRAY["grade_level"];
