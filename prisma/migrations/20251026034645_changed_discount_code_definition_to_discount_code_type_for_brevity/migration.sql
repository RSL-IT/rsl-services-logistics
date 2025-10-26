/*
  Warnings:

  - You are about to drop the column `code_definition` on the `tbl_powerbuy_config` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "DiscountCodeType" AS ENUM ('alpha', 'numeric', 'mixed');

-- AlterTable
ALTER TABLE "tbl_powerbuy_config" DROP COLUMN "code_definition",
ADD COLUMN     "code_type" "DiscountCodeType";

-- DropEnum
DROP TYPE "public"."DiscountCodeDefinition";
