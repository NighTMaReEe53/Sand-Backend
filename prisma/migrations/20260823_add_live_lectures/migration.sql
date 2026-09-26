-- CreateEnum
CREATE TYPE "LiveLectureStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "live_lectures" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "status" "LiveLectureStatus" NOT NULL DEFAULT 'SCHEDULED',
    "room_name" TEXT NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_lectures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_lecture_attendances" (
    "id" UUID NOT NULL,
    "lecture_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_lecture_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "live_lectures_room_name_key" ON "live_lectures"("room_name");

-- CreateIndex
CREATE INDEX "live_lectures_course_id_idx" ON "live_lectures"("course_id");

-- CreateIndex
CREATE INDEX "live_lectures_teacher_id_idx" ON "live_lectures"("teacher_id");

-- CreateIndex
CREATE INDEX "live_lectures_status_idx" ON "live_lectures"("status");

-- CreateIndex
CREATE INDEX "live_lectures_scheduled_at_idx" ON "live_lectures"("scheduled_at");

-- CreateIndex
CREATE INDEX "live_lecture_attendances_student_id_idx" ON "live_lecture_attendances"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "live_lecture_attendances_lecture_id_student_id_key" ON "live_lecture_attendances"("lecture_id", "student_id");

-- AddForeignKey
ALTER TABLE "live_lectures" ADD CONSTRAINT "live_lectures_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_lectures" ADD CONSTRAINT "live_lectures_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teacher_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_lecture_attendances" ADD CONSTRAINT "live_lecture_attendances_lecture_id_fkey" FOREIGN KEY ("lecture_id") REFERENCES "live_lectures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_lecture_attendances" ADD CONSTRAINT "live_lecture_attendances_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;