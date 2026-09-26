-- Data migration: link old lessons/materials to default sections
-- Step 1: Create default section for each course that has orphan lessons or materials
INSERT INTO sections (id, course_id, title, "order", created_at, updated_at)
SELECT gen_random_uuid(), c.id, 'المحتوى العام', 0, NOW(), NOW()
FROM courses c
WHERE c.is_deleted = FALSE
  AND (
    EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id AND l.is_deleted = FALSE AND l.section_id IS NULL)
    OR EXISTS (SELECT 1 FROM course_materials m WHERE m.course_id = c.id AND m.deleted_at IS NULL AND m.section_id IS NULL)
  );

-- Step 2: Link orphan lessons to their course's default section
UPDATE lessons l
SET section_id = s.id
FROM sections s
WHERE s.course_id = l.course_id AND l.section_id IS NULL AND s.title = 'المحتوى العام';

-- Step 3: Link orphan materials to their course's default section
UPDATE course_materials m
SET section_id = s.id
FROM sections s
WHERE s.course_id = m.course_id AND m.section_id IS NULL AND s.title = 'المحتوى العام';
