-- Phase 3: prevent taxonomy/link duplication recurrence
-- Plain UNIQUE on (subject_id, grade_id, track_id): covers trackId IS NOT NULL
ALTER TABLE "subject_assignments"
  ADD CONSTRAINT "subject_assignments_subject_id_grade_id_track_id_key"
  UNIQUE ("subject_id", "grade_id", "track_id");

-- Partial unique index: duplicates where track_id IS NULL (NULLs are never equal, so the constraint above cannot catch them)
CREATE UNIQUE INDEX "subject_assignments_subject_grade_null_track_key"
  ON "subject_assignments" ("subject_id", "grade_id")
  WHERE "track_id" IS NULL;

ALTER TABLE "course_targets"
  ADD CONSTRAINT "course_targets_course_id_grade_id_track_id_key"
  UNIQUE ("course_id", "grade_id", "track_id");

CREATE UNIQUE INDEX "course_targets_course_grade_null_track_key"
  ON "course_targets" ("course_id", "grade_id")
  WHERE "track_id" IS NULL;
