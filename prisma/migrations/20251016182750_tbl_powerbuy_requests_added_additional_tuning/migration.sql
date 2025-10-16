/*
  Warnings:

  - You are about to drop the `tbl_powerbuy_entries` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "public"."tbl_powerbuy_entries";

-- CreateTable
CREATE TABLE "tbl_powerbuy_codes" (
    "id" SERIAL NOT NULL,
    "powerbuy_id" INTEGER NOT NULL,
    "discount_code" TEXT NOT NULL,
    "discount_code_gid" TEXT NOT NULL,
    "short_description" TEXT,
    "long_description" TEXT NOT NULL,
    "confirmation_email_content" TEXT,
    "acceptance_email_content" TEXT,
    "rsl_contact_email_address" TEXT,
    "start_time" DATE,
    "end_time" DATE,
    "number_of_uses" INTEGER,
    "powerbuy_product_id" TEXT,

    CONSTRAINT "tbl_powerbuy_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbl_powerbuy_requests" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "powerbuy_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "token_expires" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "request_ip" TEXT,

    CONSTRAINT "tbl_powerbuy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tbl_powerbuy_codes_powerbuy_id_idx" ON "tbl_powerbuy_codes"("powerbuy_id");

-- CreateIndex
CREATE INDEX "tbl_powerbuy_codes_discount_code_idx" ON "tbl_powerbuy_codes"("discount_code");

-- CreateIndex
CREATE UNIQUE INDEX "tbl_powerbuy_requests_token_key" ON "tbl_powerbuy_requests"("token");

-- CreateIndex
CREATE INDEX "tbl_powerbuy_requests_email_powerbuy_id_idx" ON "tbl_powerbuy_requests"("email", "powerbuy_id");

-- AddForeignKey
ALTER TABLE "tbl_powerbuy_codes" ADD CONSTRAINT "tbl_powerbuy_codes_powerbuy_id_fkey" FOREIGN KEY ("powerbuy_id") REFERENCES "tbl_powerbuy_config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tbl_powerbuy_requests" ADD CONSTRAINT "tbl_powerbuy_requests_powerbuy_id_fkey" FOREIGN KEY ("powerbuy_id") REFERENCES "tbl_powerbuy_config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
