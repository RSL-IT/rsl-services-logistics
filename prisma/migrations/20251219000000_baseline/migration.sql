-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rsl_staff" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(60),
    "role" VARCHAR(60),
    "gid" VARCHAR(60),

    CONSTRAINT "rsl_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbl_shipment" (
    "id" SERIAL NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "containerNumber" TEXT NOT NULL,
    "containerSize" TEXT,
    "portOfOrigin" TEXT,
    "destinationPort" TEXT,
    "etaDate" TIMESTAMP(3),
    "cargoReadyDate" TIMESTAMP(3),
    "estimatedDeliveryToOrigin" TIMESTAMP(3),
    "supplierPi" TEXT,
    "quantity" BIGINT,
    "bookingNumber" TEXT,
    "status" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bookingAgent" TEXT,
    "deliveryAddress" TEXT,
    "vesselName" TEXT,

    CONSTRAINT "tbl_shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbl_logisticsUser" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "userType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyID" TEXT NOT NULL,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tbl_logisticsUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbljn_logisticsUser_permission" (
    "id" SERIAL NOT NULL,
    "logisticsUserID" INTEGER NOT NULL,
    "permissionID" INTEGER NOT NULL,

    CONSTRAINT "tbljn_logisticsUser_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbljn_shipment_company_rslModel" (
    "id" SERIAL NOT NULL,
    "shipmentID" TEXT NOT NULL,
    "companyID" TEXT NOT NULL,
    "rslModelID" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "tbljn_shipment_company_rslModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbljn_company_rslModel" (
    "id" SERIAL NOT NULL,
    "companyID" TEXT NOT NULL,
    "rslModelID" TEXT NOT NULL,

    CONSTRAINT "tbljn_company_rslModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbljn_shipment_purchaseOrder" (
    "id" SERIAL NOT NULL,
    "shipmentID" TEXT NOT NULL,
    "purchaseOrderGID" TEXT NOT NULL,

    CONSTRAINT "tbljn_shipment_purchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbljn_purchaseOrder_company" (
    "id" SERIAL NOT NULL,
    "purchaseOrderGID" TEXT NOT NULL,
    "companyID" TEXT NOT NULL,

    CONSTRAINT "tbljn_purchaseOrder_company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tlkp_purchaseOrder" (
    "id" SERIAL NOT NULL,
    "shortName" TEXT NOT NULL,
    "purchaseOrderGID" TEXT NOT NULL,
    "purchaseOrderPdfUrl" TEXT,

    CONSTRAINT "tlkp_purchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tlkp_rslModel" (
    "id" SERIAL NOT NULL,
    "shortName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "SKU" TEXT NOT NULL,

    CONSTRAINT "tlkp_rslModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tlkp_company" (
    "id" SERIAL NOT NULL,
    "shortName" TEXT NOT NULL,
    "displayName" TEXT,
    "address1" TEXT,
    "address2" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "primaryContact" TEXT,
    "primaryPhone" TEXT,
    "primaryEmail" TEXT,
    "supplierCurrency" TEXT,

    CONSTRAINT "tlkp_company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tlkp_bookingAgent" (
    "id" SERIAL NOT NULL,
    "shortName" TEXT NOT NULL,
    "displayName" TEXT,

    CONSTRAINT "tlkp_bookingAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tlkp_container" (
    "id" SERIAL NOT NULL,
    "shortName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,

    CONSTRAINT "tlkp_container_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tlkp_originPort" (
    "id" SERIAL NOT NULL,
    "shortName" TEXT NOT NULL,
    "displayName" TEXT,

    CONSTRAINT "tlkp_originPort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tlkp_destinationPort" (
    "id" SERIAL NOT NULL,
    "shortName" TEXT NOT NULL,
    "displayName" TEXT,

    CONSTRAINT "tlkp_destinationPort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tlkp_deliveryAddress" (
    "id" SERIAL NOT NULL,
    "shortName" TEXT NOT NULL,
    "displayName" TEXT,

    CONSTRAINT "tlkp_deliveryAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tlkp_permission" (
    "id" SERIAL NOT NULL,
    "shortName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,

    CONSTRAINT "tlkp_permission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE INDEX "Session_expires_idx" ON "Session"("expires");

-- CreateIndex
CREATE UNIQUE INDEX "tbl_shipment_containerNumber_key" ON "tbl_shipment"("containerNumber");

-- CreateIndex
CREATE UNIQUE INDEX "tbl_logisticsUser_email_key" ON "tbl_logisticsUser"("email");

-- CreateIndex
CREATE INDEX "tbljn_logisticsUser_permission_logisticsUserID_idx" ON "tbljn_logisticsUser_permission"("logisticsUserID");

-- CreateIndex
CREATE INDEX "tbljn_logisticsUser_permission_permissionID_idx" ON "tbljn_logisticsUser_permission"("permissionID");

-- CreateIndex
CREATE INDEX "tbljn_shipment_company_rslModel_shipmentID_idx" ON "tbljn_shipment_company_rslModel"("shipmentID");

-- CreateIndex
CREATE INDEX "tbljn_shipment_company_rslModel_companyID_idx" ON "tbljn_shipment_company_rslModel"("companyID");

-- CreateIndex
CREATE INDEX "tbljn_shipment_company_rslModel_rslModelID_idx" ON "tbljn_shipment_company_rslModel"("rslModelID");

-- CreateIndex
CREATE INDEX "tbljn_company_rslModel_companyID_idx" ON "tbljn_company_rslModel"("companyID");

-- CreateIndex
CREATE INDEX "tbljn_company_rslModel_rslModelID_idx" ON "tbljn_company_rslModel"("rslModelID");

-- CreateIndex
CREATE INDEX "tbljn_shipment_purchaseOrder_shipmentID_idx" ON "tbljn_shipment_purchaseOrder"("shipmentID");

-- CreateIndex
CREATE INDEX "tbljn_shipment_purchaseOrder_purchaseOrderGID_idx" ON "tbljn_shipment_purchaseOrder"("purchaseOrderGID");

-- CreateIndex
CREATE INDEX "tbljn_purchaseOrder_company_purchaseOrderGID_idx" ON "tbljn_purchaseOrder_company"("purchaseOrderGID");

-- CreateIndex
CREATE INDEX "tbljn_purchaseOrder_company_companyID_idx" ON "tbljn_purchaseOrder_company"("companyID");

-- CreateIndex
CREATE UNIQUE INDEX "tbljn_purchaseOrder_company_purchaseOrderGID_companyID_key" ON "tbljn_purchaseOrder_company"("purchaseOrderGID", "companyID");

-- CreateIndex
CREATE UNIQUE INDEX "tlkp_purchaseOrder_shortName_key" ON "tlkp_purchaseOrder"("shortName");

-- CreateIndex
CREATE UNIQUE INDEX "tlkp_purchaseOrder_purchaseOrderGID_key" ON "tlkp_purchaseOrder"("purchaseOrderGID");

-- CreateIndex
CREATE UNIQUE INDEX "tlkp_rslModel_shortName_key" ON "tlkp_rslModel"("shortName");

-- CreateIndex
CREATE UNIQUE INDEX "tlkp_rslModel_SKU_key" ON "tlkp_rslModel"("SKU");

-- CreateIndex
CREATE UNIQUE INDEX "tlkp_company_shortName_key" ON "tlkp_company"("shortName");

-- CreateIndex
CREATE UNIQUE INDEX "tlkp_bookingAgent_shortName_key" ON "tlkp_bookingAgent"("shortName");

-- CreateIndex
CREATE UNIQUE INDEX "tlkp_container_shortName_key" ON "tlkp_container"("shortName");

-- CreateIndex
CREATE UNIQUE INDEX "tlkp_originPort_shortName_key" ON "tlkp_originPort"("shortName");

-- CreateIndex
CREATE UNIQUE INDEX "tlkp_destinationPort_shortName_key" ON "tlkp_destinationPort"("shortName");

-- CreateIndex
CREATE UNIQUE INDEX "tlkp_deliveryAddress_shortName_key" ON "tlkp_deliveryAddress"("shortName");

-- CreateIndex
CREATE UNIQUE INDEX "tlkp_permission_shortName_key" ON "tlkp_permission"("shortName");

-- AddForeignKey
ALTER TABLE "tbl_shipment" ADD CONSTRAINT "tbl_shipment_bookingAgent_fkey" FOREIGN KEY ("bookingAgent") REFERENCES "tlkp_bookingAgent"("shortName") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_shipment" ADD CONSTRAINT "tbl_shipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "tlkp_company"("shortName") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_shipment" ADD CONSTRAINT "tbl_shipment_containerSize_fkey" FOREIGN KEY ("containerSize") REFERENCES "tlkp_container"("shortName") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_shipment" ADD CONSTRAINT "tbl_shipment_deliveryAddress_fkey" FOREIGN KEY ("deliveryAddress") REFERENCES "tlkp_deliveryAddress"("shortName") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_shipment" ADD CONSTRAINT "tbl_shipment_destinationPort_fkey" FOREIGN KEY ("destinationPort") REFERENCES "tlkp_destinationPort"("shortName") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_shipment" ADD CONSTRAINT "tbl_shipment_portOfOrigin_fkey" FOREIGN KEY ("portOfOrigin") REFERENCES "tlkp_originPort"("shortName") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_logisticsUser" ADD CONSTRAINT "tbl_logisticsUser_companyID_fkey" FOREIGN KEY ("companyID") REFERENCES "tlkp_company"("shortName") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbljn_logisticsUser_permission" ADD CONSTRAINT "tbljn_logisticsUser_permission_logisticsUserID_fkey" FOREIGN KEY ("logisticsUserID") REFERENCES "tbl_logisticsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbljn_logisticsUser_permission" ADD CONSTRAINT "tbljn_logisticsUser_permission_permissionID_fkey" FOREIGN KEY ("permissionID") REFERENCES "tlkp_permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbljn_shipment_company_rslModel" ADD CONSTRAINT "tbljn_shipment_company_rslModel_companyID_fkey" FOREIGN KEY ("companyID") REFERENCES "tlkp_company"("shortName") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbljn_shipment_company_rslModel" ADD CONSTRAINT "tbljn_shipment_company_rslModel_rslModelID_fkey" FOREIGN KEY ("rslModelID") REFERENCES "tlkp_rslModel"("shortName") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbljn_shipment_company_rslModel" ADD CONSTRAINT "tbljn_shipment_company_rslModel_shipmentID_fkey" FOREIGN KEY ("shipmentID") REFERENCES "tbl_shipment"("containerNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbljn_company_rslModel" ADD CONSTRAINT "tbljn_company_rslModel_companyID_fkey" FOREIGN KEY ("companyID") REFERENCES "tlkp_company"("shortName") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbljn_company_rslModel" ADD CONSTRAINT "tbljn_company_rslModel_rslModelID_fkey" FOREIGN KEY ("rslModelID") REFERENCES "tlkp_rslModel"("shortName") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbljn_shipment_purchaseOrder" ADD CONSTRAINT "tbljn_shipment_purchaseOrder_purchaseOrderGID_fkey" FOREIGN KEY ("purchaseOrderGID") REFERENCES "tlkp_purchaseOrder"("purchaseOrderGID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbljn_shipment_purchaseOrder" ADD CONSTRAINT "tbljn_shipment_purchaseOrder_shipmentID_fkey" FOREIGN KEY ("shipmentID") REFERENCES "tbl_shipment"("containerNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbljn_purchaseOrder_company" ADD CONSTRAINT "tbljn_purchaseOrder_company_companyID_fkey" FOREIGN KEY ("companyID") REFERENCES "tlkp_company"("shortName") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbljn_purchaseOrder_company" ADD CONSTRAINT "tbljn_purchaseOrder_company_purchaseOrderGID_fkey" FOREIGN KEY ("purchaseOrderGID") REFERENCES "tlkp_purchaseOrder"("purchaseOrderGID") ON DELETE CASCADE ON UPDATE CASCADE;

