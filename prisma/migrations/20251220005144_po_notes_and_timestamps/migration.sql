/*
  Warnings:

  - Added the required column `updatedAt` to the `tlkp_purchaseOrder` table without a default value. This is not possible if the table is not empty.

*/

-- AlterTable (safe backfill for existing rows)
ALTER TABLE "tlkp_purchaseOrder"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Backfill existing rows
UPDATE "tlkp_purchaseOrder"
SET
  "createdAt" = COALESCE("createdAt", CURRENT_TIMESTAMP),
  "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP);

-- Enforce not-null + defaults for future inserts
ALTER TABLE "tlkp_purchaseOrder"
  ALTER COLUMN "createdAt" SET NOT NULL,
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updatedAt" SET NOT NULL,
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "tbl_purchaseOrderNotes" (
                                        "id" SERIAL NOT NULL,
                                        "purchaseOrderGID" TEXT NOT NULL,
                                        "userId" INTEGER,
                                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "content" TEXT NOT NULL,
                                        "pdfUrl" TEXT,
                                        "pdfFileName" VARCHAR(255),
                                        "eventType" VARCHAR(30),

                                        CONSTRAINT "tbl_purchaseOrderNotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tbl_purchaseOrderNotes_purchaseOrderGID_idx" ON "tbl_purchaseOrderNotes"("purchaseOrderGID");

-- CreateIndex
CREATE INDEX "tbl_purchaseOrderNotes_userId_idx" ON "tbl_purchaseOrderNotes"("userId");

-- CreateIndex
CREATE INDEX "tbl_purchaseOrderNotes_createdAt_idx" ON "tbl_purchaseOrderNotes"("createdAt");

-- AddForeignKey
ALTER TABLE "tbl_purchaseOrderNotes"
  ADD CONSTRAINT "tbl_purchaseOrderNotes_purchaseOrderGID_fkey"
    FOREIGN KEY ("purchaseOrderGID")
      REFERENCES "tlkp_purchaseOrder"("purchaseOrderGID")
      ON DELETE CASCADE
      ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_purchaseOrderNotes"
  ADD CONSTRAINT "tbl_purchaseOrderNotes_userId_fkey"
    FOREIGN KEY ("userId")
      REFERENCES "tbl_logisticsUser"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
