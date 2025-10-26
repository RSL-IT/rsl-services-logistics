-- CreateEnum
CREATE TYPE "DiscountCodeDefinition" AS ENUM ('alpha', 'numeric', 'mixed');

-- AlterTable
ALTER TABLE "tbl_powerbuy_config" ADD COLUMN     "code_definition" "DiscountCodeDefinition";
