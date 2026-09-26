-- AlterTable
ALTER TABLE "exam_attempts" ADD COLUMN "question_order" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "exam_attempts" ADD COLUMN "current_index" INTEGER NOT NULL DEFAULT 0;