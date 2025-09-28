-- Baseline migration to align Prisma history with existing DB FKs on return_entry.

SET search_path = public;

-- Add missing FKs in a fresh/shadow DB when Prisma replays migrations.
-- (They already exist in your live DB; this file will be marked as "applied" and NOT executed there.)

ALTER TABLE "return_entry"
  ADD CONSTRAINT "return_entry_return_type_id_fkey"
    FOREIGN KEY ("return_type_id")
      REFERENCES "csd_return_type"("id")
      ON UPDATE CASCADE
      ON DELETE SET NULL;

ALTER TABLE "return_entry"
  ADD CONSTRAINT "return_entry_primary_customer_reason_id_fkey"
    FOREIGN KEY ("primary_customer_reason_id")
      REFERENCES "csd_primary_customer_reported_reason_for_return_warranty"("id")
      ON UPDATE CASCADE
      ON DELETE SET NULL;
