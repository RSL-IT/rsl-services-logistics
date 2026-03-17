-- Allow products without SKU and ensure SKU is not used as a uniqueness key.
ALTER TABLE "tlkp_rslProduct"
  ALTER COLUMN "SKU" DROP NOT NULL;

-- Older databases may still have a unique SKU index/constraint from baseline.
DROP INDEX IF EXISTS "tlkp_rslproduct_sku_key";
ALTER TABLE "tlkp_rslProduct" DROP CONSTRAINT IF EXISTS "tlkp_rslproduct_sku_key";

-- Keep a non-unique index to preserve lookup performance for SKU-based matching.
CREATE INDEX IF NOT EXISTS "tlkp_rslproduct_sku_idx" ON "tlkp_rslProduct"("SKU");
