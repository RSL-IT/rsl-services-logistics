ALTER TABLE "tbl_purchaseOrder"
  ADD COLUMN IF NOT EXISTS "originalPoDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveryAddress" TEXT;

CREATE INDEX IF NOT EXISTS "tbl_purchaseOrder_deliveryAddress_idx" ON "tbl_purchaseOrder"("deliveryAddress");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tbl_purchaseOrder_deliveryAddress_fkey'
  ) THEN
    ALTER TABLE "tbl_purchaseOrder"
      ADD CONSTRAINT "tbl_purchaseOrder_deliveryAddress_fkey"
      FOREIGN KEY ("deliveryAddress") REFERENCES "tlkp_deliveryAddress"("shortName")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
