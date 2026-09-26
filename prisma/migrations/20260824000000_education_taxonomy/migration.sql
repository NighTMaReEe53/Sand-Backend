-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "needs_review" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subject_id" UUID;

-- CreateTable
CREATE TABLE "education_systems" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "education_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "educational_stages" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "education_system_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "educational_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage_id" UUID NOT NULL,
    "has_tracks" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracks" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grade_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject_assignments" (
    "id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "track_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "subject_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_targets" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "track_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_education_profiles" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "education_system_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "track_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_education_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "education_systems_code_key" ON "education_systems"("code");

-- CreateIndex
CREATE UNIQUE INDEX "educational_stages_code_key" ON "educational_stages"("code");

-- CreateIndex
CREATE INDEX "educational_stages_education_system_id_idx" ON "educational_stages"("education_system_id");

-- CreateIndex
CREATE UNIQUE INDEX "grades_code_key" ON "grades"("code");

-- CreateIndex
CREATE INDEX "grades_stage_id_idx" ON "grades"("stage_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracks_code_key" ON "tracks"("code");

-- CreateIndex
CREATE INDEX "tracks_grade_id_idx" ON "tracks"("grade_id");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_code_key" ON "subjects"("code");

-- CreateIndex
CREATE INDEX "subject_assignments_subject_id_grade_id_track_id_idx" ON "subject_assignments"("subject_id", "grade_id", "track_id");

-- CreateIndex
CREATE INDEX "subject_assignments_grade_id_track_id_idx" ON "subject_assignments"("grade_id", "track_id");

-- CreateIndex
CREATE INDEX "course_targets_course_id_idx" ON "course_targets"("course_id");

-- CreateIndex
CREATE INDEX "course_targets_grade_id_track_id_idx" ON "course_targets"("grade_id", "track_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_education_profiles_student_id_key" ON "student_education_profiles"("student_id");

-- CreateIndex
CREATE INDEX "student_education_profiles_grade_id_track_id_idx" ON "student_education_profiles"("grade_id", "track_id");

-- CreateIndex
CREATE INDEX "courses_subject_id_idx" ON "courses"("subject_id");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "educational_stages" ADD CONSTRAINT "educational_stages_education_system_id_fkey" FOREIGN KEY ("education_system_id") REFERENCES "education_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "educational_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_assignments" ADD CONSTRAINT "subject_assignments_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_assignments" ADD CONSTRAINT "subject_assignments_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_assignments" ADD CONSTRAINT "subject_assignments_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_targets" ADD CONSTRAINT "course_targets_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_targets" ADD CONSTRAINT "course_targets_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_targets" ADD CONSTRAINT "course_targets_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_education_profiles" ADD CONSTRAINT "student_education_profiles_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_education_profiles" ADD CONSTRAINT "student_education_profiles_education_system_id_fkey" FOREIGN KEY ("education_system_id") REFERENCES "education_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_education_profiles" ADD CONSTRAINT "student_education_profiles_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "educational_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_education_profiles" ADD CONSTRAINT "student_education_profiles_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_education_profiles" ADD CONSTRAINT "student_education_profiles_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
