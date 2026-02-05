-- Rename rslProductGID -> variantGID and move uniqueness from SKU to variantGID
ALTER TABLE "tlkp_rslProduct" RENAME COLUMN "rslProductGID" TO "variantGID";
ALTER TABLE "tlkp_rslProduct" DROP CONSTRAINT IF EXISTS "tlkp_rslproduct_sku_key";
ALTER TABLE "tlkp_rslProduct" ADD CONSTRAINT "tlkp_rslproduct_variantgid_key" UNIQUE ("variantGID");
