-- Add video_url to lesson_answers (teacher video replies on student questions)
ALTER TABLE "lesson_answers" ADD COLUMN "video_url" TEXT;
