-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EnrollmentStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "EnrollmentStatus" ADD VALUE 'CANCELLED';

-- DropIndex
DROP INDEX "enrollments_student_id_course_id_key";

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "order_reference" TEXT NOT NULL,
    "receipt_image_url" TEXT,
    "receipt_image_hash" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_audit_logs" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "performed_by" UUID NOT NULL,
    "previous_status" "PaymentStatus",
    "new_status" "PaymentStatus",
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_reference_key" ON "payments"("order_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payments_receipt_image_hash_key" ON "payments"("receipt_image_hash");

-- CreateIndex
CREATE INDEX "payments_enrollment_id_idx" ON "payments"("enrollment_id");

-- CreateIndex
CREATE INDEX "payments_course_id_status_idx" ON "payments"("course_id", "status");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_order_reference_idx" ON "payments"("order_reference");

-- CreateIndex
CREATE INDEX "payment_audit_logs_payment_id_idx" ON "payment_audit_logs"("payment_id");

-- CreateIndex
CREATE INDEX "payment_audit_logs_performed_by_idx" ON "payment_audit_logs"("performed_by");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
