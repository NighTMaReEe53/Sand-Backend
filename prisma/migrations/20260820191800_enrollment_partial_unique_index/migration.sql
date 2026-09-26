-- Partial Unique Index to ensure a student cannot have multiple PENDING or ACTIVE enrollments for the same course concurrently
CREATE UNIQUE INDEX IF NOT EXISTS enrollment_active_unique
ON enrollments (student_id, course_id)
WHERE status IN ('PENDING', 'ACTIVE');
