-- AlterTable
ALTER TABLE "progresses" ADD COLUMN     "last_position_seconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "video_duration_seconds" INTEGER;
