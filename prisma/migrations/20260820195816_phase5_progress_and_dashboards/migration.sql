-- CreateTable
CREATE TABLE "progresses" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "watched_percentage" INTEGER NOT NULL DEFAULT 0,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "last_watched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "progresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "progresses_student_id_idx" ON "progresses"("student_id");

-- CreateIndex
CREATE INDEX "progresses_lesson_id_idx" ON "progresses"("lesson_id");

-- CreateIndex
CREATE INDEX "progresses_is_completed_idx" ON "progresses"("is_completed");

-- CreateIndex
CREATE UNIQUE INDEX "progresses_student_id_lesson_id_key" ON "progresses"("student_id", "lesson_id");

-- AddForeignKey
ALTER TABLE "progresses" ADD CONSTRAINT "progresses_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progresses" ADD CONSTRAINT "progresses_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
