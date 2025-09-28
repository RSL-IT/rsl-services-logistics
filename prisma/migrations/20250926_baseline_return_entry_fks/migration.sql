-- Baseline: return_entry foreign keys already exist in the database.
-- This migration records them in Prisma's history without changing data.

-- NOTE: This SQL is intentionally present for history.
-- DO NOT run it manually since constraints already exist in your DB.

-- If you ever had to recreate them, these are the intended constraints:
-- ALTER TABLE "return_entry"
--   ADD CONSTRAINT "return_entry_return_type_id_fkey"
--     FOREIGN KEY ("return_type_id")
--     REFERENCES "csd_return_type"("id")
--     ON DELETE SET NULL
--     ON UPDATE CASCADE,
--   ADD CONSTRAINT "return_entry_primary_customer_reason_id_fkey"
--     FOREIGN KEY ("primary_customer_reason_id")
--     REFERENCES "csd_primary_customer_reported_reason_for_return_warranty"("id")
--     ON DELETE SET NULL
--     ON UPDATE CASCADE;
