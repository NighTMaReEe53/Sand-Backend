-- Course offer/discount: teacher-set percentage + expiry (coupon-style, per course)
ALTER TABLE "courses" ADD COLUMN "discount_percent" INTEGER;
ALTER TABLE "courses" ADD COLUMN "discount_ends_at" TIMESTAMP(3);

CREATE INDEX "courses_discount_ends_at_idx" ON "courses"("discount_ends_at");
