-- CreateTable
CREATE TABLE "tbljn_shipment_rslProduct" (
    "id" SERIAL NOT NULL,
    "shipmentId" INTEGER NOT NULL,
    "rslProductID" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tbljn_shipment_rslProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tbljn_shipment_rslProduct_shipmentId_idx" ON "tbljn_shipment_rslProduct"("shipmentId");

-- CreateIndex
CREATE INDEX "tbljn_shipment_rslProduct_rslProductID_idx" ON "tbljn_shipment_rslProduct"("rslProductID");

-- CreateIndex
CREATE UNIQUE INDEX "tbljn_shipment_rslProduct_shipmentId_rslProductID_key" ON "tbljn_shipment_rslProduct"("shipmentId", "rslProductID");

-- AddForeignKey
ALTER TABLE "tbljn_shipment_rslProduct" ADD CONSTRAINT "tbljn_shipment_rslProduct_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "tbl_shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbljn_shipment_rslProduct" ADD CONSTRAINT "tbljn_shipment_rslProduct_rslProductID_fkey" FOREIGN KEY ("rslProductID") REFERENCES "tlkp_rslProduct"("shortName") ON DELETE CASCADE ON UPDATE CASCADE;
