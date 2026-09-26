-- CreateEnum
CREATE TYPE "QuestionDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "BadgeCode" AS ENUM ('FIRST_COURSE_ENROLLED', 'FIRST_EXAM_COMPLETED', 'STREAK_7_DAYS', 'EXAM_SCORE_90', 'COURSE_COMPLETED');

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "subject" TEXT;

-- AlterTable
ALTER TABLE "exam_attempts" ADD COLUMN     "question_snapshots" JSONB;

-- AlterTable
ALTER TABLE "exams" ADD COLUMN     "bank_easy_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bank_hard_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bank_medium_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shuffle_options" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "use_question_bank" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "question_bank" (
    "id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "course_id" UUID,
    "section_id" UUID,
    "lesson_id" UUID,
    "text" TEXT NOT NULL,
    "image_url" TEXT,
    "options" JSONB NOT NULL,
    "correct_option_index" INTEGER NOT NULL,
    "explanation" TEXT,
    "marks" INTEGER NOT NULL DEFAULT 1,
    "difficulty" "QuestionDifficulty" NOT NULL DEFAULT 'MEDIUM',
    "topic" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_streaks" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "current_streak" INTEGER NOT NULL DEFAULT 0,
    "longest_streak" INTEGER NOT NULL DEFAULT 0,
    "last_active_date" DATE NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_streaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_badges" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "badgeCode" "BadgeCode" NOT NULL,
    "awarded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_plan_tasks" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_date" TIMESTAMP(3) NOT NULL,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "course_id" UUID,
    "lesson_id" UUID,
    "exam_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_plan_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_reviews" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "question_bank_teacher_id_difficulty_idx" ON "question_bank"("teacher_id", "difficulty");

-- CreateIndex
CREATE INDEX "question_bank_course_id_idx" ON "question_bank"("course_id");

-- CreateIndex
CREATE INDEX "question_bank_lesson_id_idx" ON "question_bank"("lesson_id");

-- CreateIndex
CREATE INDEX "question_bank_topic_idx" ON "question_bank"("topic");

-- CreateIndex
CREATE INDEX "question_bank_is_deleted_idx" ON "question_bank"("is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "student_streaks_student_id_key" ON "student_streaks"("student_id");

-- CreateIndex
CREATE INDEX "student_badges_student_id_idx" ON "student_badges"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_badges_student_id_badgeCode_key" ON "student_badges"("student_id", "badgeCode");

-- CreateIndex
CREATE INDEX "study_plan_tasks_student_id_due_date_idx" ON "study_plan_tasks"("student_id", "due_date");

-- CreateIndex
CREATE INDEX "study_plan_tasks_student_id_is_completed_idx" ON "study_plan_tasks"("student_id", "is_completed");

-- CreateIndex
CREATE INDEX "course_reviews_course_id_is_hidden_idx" ON "course_reviews"("course_id", "is_hidden");

-- CreateIndex
CREATE UNIQUE INDEX "course_reviews_student_id_course_id_key" ON "course_reviews"("student_id", "course_id");

-- CreateIndex
CREATE INDEX "courses_subject_idx" ON "courses"("subject");

-- AddForeignKey
ALTER TABLE "question_bank" ADD CONSTRAINT "question_bank_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teacher_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_bank" ADD CONSTRAINT "question_bank_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_streaks" ADD CONSTRAINT "student_streaks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_badges" ADD CONSTRAINT "student_badges_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_plan_tasks" ADD CONSTRAINT "study_plan_tasks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_reviews" ADD CONSTRAINT "course_reviews_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_reviews" ADD CONSTRAINT "course_reviews_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
