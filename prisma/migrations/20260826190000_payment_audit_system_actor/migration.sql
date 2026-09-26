-- Payment expiry is performed by a system job, not a User record.
ALTER TABLE "payment_audit_logs"
  ALTER COLUMN "performed_by" DROP NOT NULL;
