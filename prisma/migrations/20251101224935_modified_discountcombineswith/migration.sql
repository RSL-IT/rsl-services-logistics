/*
  Warnings:

  - The `discount_combines_with` column on the `tbl_powerbuy_config` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "tbl_powerbuy_config" DROP COLUMN "discount_combines_with",
ADD COLUMN     "discount_combines_with" TEXT;

-- DropEnum
DROP TYPE "public"."DiscountCombinesWithType";
