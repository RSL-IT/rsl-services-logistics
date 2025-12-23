/*
  Safe migration:
  - Rename `tlkp_purchaseOrder` -> `tbl_purchaseOrder` WITHOUT data loss
  - Keep existing foreign keys intact (Postgres updates FK references automatically on table rename)
  - Add `createdAt` / `updatedAt` columns if missing (backfilled safely)
  - Rename indexes/sequence/PK constraint to match new table naming (optional but recommended)
*/

-- 1) Rename the table (this preserves all existing rows)
ALTER TABLE "public"."tlkp_purchaseOrder" RENAME TO "tbl_purchaseOrder";

-- 2) Rename the SERIAL sequence (if it exists)
ALTER SEQUENCE IF EXISTS "public"."tlkp_purchaseOrder_id_seq" RENAME TO "tbl_purchaseOrder_id_seq";

-- 3) Rename the primary key constraint (no IF EXISTS support, so guard in a DO block)
DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.conname = 'tlkp_purchaseOrder_pkey'
        AND t.relname = 'tbl_purchaseOrder'
        AND n.nspname = 'public'
    ) THEN
      ALTER TABLE "public"."tbl_purchaseOrder"
        RENAME CONSTRAINT "tlkp_purchaseOrder_pkey" TO "tbl_purchaseOrder_pkey";
    END IF;
  END $$;

-- 4) Rename unique indexes (these usually exist from the old model)
ALTER INDEX IF EXISTS "public"."tlkp_purchaseOrder_shortName_key"
  RENAME TO "tbl_purchaseOrder_shortName_key";

ALTER INDEX IF EXISTS "public"."tlkp_purchaseOrder_purchaseOrderGID_key"
  RENAME TO "tbl_purchaseOrder_purchaseOrderGID_key";

-- 5) Add timestamps required by the new Prisma model (safe for non-empty tables)
ALTER TABLE "public"."tbl_purchaseOrder"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."tbl_purchaseOrder"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 6) Backfill just in case (covers any odd edge cases)
UPDATE "public"."tbl_purchaseOrder"
SET
  "createdAt" = COALESCE("createdAt", CURRENT_TIMESTAMP),
  "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP);

-- 7) Match Prisma expectation more closely:
-- createdAt keeps DEFAULT now(), updatedAt typically has no DB default (Prisma updates it)
ALTER TABLE "public"."tbl_purchaseOrder"
  ALTER COLUMN "updatedAt" DROP DEFAULT;
