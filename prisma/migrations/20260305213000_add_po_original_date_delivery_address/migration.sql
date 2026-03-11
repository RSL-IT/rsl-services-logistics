ALTER TABLE "tbl_purchaseOrder"
  ADD COLUMN "originalPoDate" TIMESTAMP(3),
  ADD COLUMN "deliveryAddress" TEXT;

CREATE INDEX "tbl_purchaseOrder_deliveryAddress_idx" ON "tbl_purchaseOrder"("deliveryAddress");

ALTER TABLE "tbl_purchaseOrder"
  ADD CONSTRAINT "tbl_purchaseOrder_deliveryAddress_fkey"
  FOREIGN KEY ("deliveryAddress") REFERENCES "tlkp_deliveryAddress"("shortName")
  ON DELETE SET NULL ON UPDATE CASCADE;
