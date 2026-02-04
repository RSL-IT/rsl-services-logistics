-- CreateTable
CREATE TABLE "tbl_shipmentNotes" (
    "id" SERIAL NOT NULL,
    "shipmentId" INTEGER NOT NULL,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content" TEXT NOT NULL,
    "changes" TEXT,

    CONSTRAINT "tbl_shipmentNotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tbl_shipmentNotes_createdAt_idx" ON "tbl_shipmentNotes"("createdAt");

-- CreateIndex
CREATE INDEX "tbl_shipmentNotes_shipmentId_idx" ON "tbl_shipmentNotes"("shipmentId");

-- CreateIndex
CREATE INDEX "tbl_shipmentNotes_userId_idx" ON "tbl_shipmentNotes"("userId");

-- AddForeignKey
ALTER TABLE "tbl_shipmentNotes" ADD CONSTRAINT "tbl_shipmentNotes_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "tbl_shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_shipmentNotes" ADD CONSTRAINT "tbl_shipmentNotes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tbl_logisticsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
