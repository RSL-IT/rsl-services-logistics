-- AlterTable
ALTER TABLE "tbl_purchaseOrder" ADD COLUMN     "statusShortName" TEXT;

-- CreateTable
CREATE TABLE "tlkp_purchaseOrderStatus" (
    "id" SERIAL NOT NULL,
    "shortName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,

    CONSTRAINT "tlkp_purchaseOrderStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tlkp_purchaseOrderStatus_shortName_key" ON "tlkp_purchaseOrderStatus"("shortName");

-- CreateIndex
CREATE INDEX "tbl_purchaseOrder_statusShortName_idx" ON "tbl_purchaseOrder"("statusShortName");

-- AddForeignKey
ALTER TABLE "tbl_purchaseOrder" ADD CONSTRAINT "tbl_purchaseOrder_statusShortName_fkey" FOREIGN KEY ("statusShortName") REFERENCES "tlkp_purchaseOrderStatus"("shortName") ON DELETE SET NULL ON UPDATE CASCADE;
