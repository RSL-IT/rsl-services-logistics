ALTER TABLE "tbl_shipment"
  DROP COLUMN IF EXISTS "supplierPiUrl",
  DROP COLUMN IF EXISTS "supplierPiFileName",
  ADD COLUMN "packingListUrl" TEXT,
  ADD COLUMN "packingListFileName" VARCHAR(255),
  ADD COLUMN "commercialInvoiceUrl" TEXT,
  ADD COLUMN "commercialInvoiceFileName" VARCHAR(255);
