-- Exam exit tracking is additive: all historic attempts remain eligible with
-- zero recorded exits, so no score/rank/result needs a backfill.
CREATE TYPE "ExamAttemptExitType" AS ENUM ('TAB_HIDDEN', 'PAGE_EXIT', 'ROUTE_CHANGE', 'PAGE_UNLOAD');

ALTER TABLE "exam_attempts"
  ADD COLUMN "exit_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "is_eligible_for_leaderboard" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "exam_attempt_exits" (
  "id" UUID NOT NULL,
  "attempt_id" UUID NOT NULL,
  "event_id" TEXT NOT NULL,
  "exit_type" "ExamAttemptExitType" NOT NULL,
  "exited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "returned_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exam_attempt_exits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exam_attempt_exits_attempt_id_event_id_key"
  ON "exam_attempt_exits"("attempt_id", "event_id");
CREATE INDEX "exam_attempt_exits_attempt_id_created_at_idx"
  ON "exam_attempt_exits"("attempt_id", "created_at");
CREATE INDEX "exam_attempts_exam_id_is_eligible_for_leaderboard_score_idx"
  ON "exam_attempts"("exam_id", "is_eligible_for_leaderboard", "score");

ALTER TABLE "exam_attempt_exits"
  ADD CONSTRAINT "exam_attempt_exits_attempt_id_fkey"
  FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
