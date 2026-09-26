ALTER TABLE "courses"
ADD COLUMN "learning_outcomes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
