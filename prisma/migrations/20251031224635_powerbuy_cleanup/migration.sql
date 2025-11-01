/*
  Warnings:

  - You are about to drop the column `acceptance_email_content` on the `tbl_powerbuy_codes` table. All the data in the column will be lost.
  - You are about to drop the column `confirmation_email_content` on the `tbl_powerbuy_codes` table. All the data in the column will be lost.
  - You are about to drop the column `long_description` on the `tbl_powerbuy_codes` table. All the data in the column will be lost.
  - You are about to drop the column `short_description` on the `tbl_powerbuy_codes` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "tbl_powerbuy_codes" DROP COLUMN "acceptance_email_content",
DROP COLUMN "confirmation_email_content",
DROP COLUMN "long_description",
DROP COLUMN "short_description";

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE INDEX "Session_expires_idx" ON "Session"("expires");
