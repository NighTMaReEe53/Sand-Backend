-- CreateTable
CREATE TABLE "lesson_questions" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_answered" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_answers" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "is_teacher_reply" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lesson_questions_lesson_id_is_pinned_idx" ON "lesson_questions"("lesson_id", "is_pinned");

-- CreateIndex
CREATE INDEX "lesson_questions_student_id_idx" ON "lesson_questions"("student_id");

-- CreateIndex
CREATE INDEX "lesson_questions_is_answered_idx" ON "lesson_questions"("is_answered");

-- CreateIndex
CREATE INDEX "lesson_answers_question_id_idx" ON "lesson_answers"("question_id");

-- CreateIndex
CREATE INDEX "lesson_answers_author_user_id_idx" ON "lesson_answers"("author_user_id");

-- AddForeignKey
ALTER TABLE "lesson_questions" ADD CONSTRAINT "lesson_questions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_questions" ADD CONSTRAINT "lesson_questions_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_answers" ADD CONSTRAINT "lesson_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "lesson_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_answers" ADD CONSTRAINT "lesson_answers_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
