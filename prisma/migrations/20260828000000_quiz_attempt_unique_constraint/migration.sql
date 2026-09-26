-- Step 1: Remove duplicate quiz attempts, keeping only the latest one per (quizId, studentId)
DELETE FROM quiz_attempt_answers
WHERE attempt_id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY quiz_id, student_id ORDER BY created_at DESC) as rn
    FROM quiz_attempts
  ) t
  WHERE rn > 1
);

DELETE FROM quiz_attempts
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY quiz_id, student_id ORDER BY created_at DESC) as rn
    FROM quiz_attempts
  ) t
  WHERE rn > 1
);

-- Step 2: Add unique constraint on (quizId, studentId)
CREATE UNIQUE INDEX "quiz_attempts_quiz_id_student_id_key" ON "quiz_attempts"("quiz_id", "student_id");
