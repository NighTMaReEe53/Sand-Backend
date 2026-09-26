-- Customize Video: one custom video per course, owned by the course teacher
CREATE TABLE "course_videos" (
    "id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "video_url" TEXT NOT NULL,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_videos_pkey" PRIMARY KEY ("id")
);

-- Enforce that a video is always tied to exactly one existing teacher and one existing course
ALTER TABLE "course_videos" ADD CONSTRAINT "course_videos_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teacher_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_videos" ADD CONSTRAINT "course_videos_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One video per course; fast lookups by teacher
CREATE UNIQUE INDEX "course_videos_course_id_key" ON "course_videos"("course_id");
CREATE INDEX "course_videos_teacher_id_idx" ON "course_videos"("teacher_id");
