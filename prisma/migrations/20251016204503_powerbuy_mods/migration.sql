-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('percentage', 'fixed');

-- AlterTable
ALTER TABLE "tbl_powerbuy_config" ADD COLUMN     "discount_type" "DiscountType",
ADD COLUMN     "discount_value" DECIMAL(10,2);
