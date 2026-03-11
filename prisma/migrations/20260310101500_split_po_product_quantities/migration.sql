-- Rename existing PO product quantity into initial quantity and add committed quantity.
ALTER TABLE "tbljn_purchaseOrder_rslProduct"
RENAME COLUMN "quantity" TO "initialQuantity";

ALTER TABLE "tbljn_purchaseOrder_rslProduct"
ADD COLUMN "committedQuantity" INTEGER NOT NULL DEFAULT 0;
