-- AlterTable
ALTER TABLE "public"."return_entry" ALTER COLUMN "original_order" SET DATA TYPE TEXT,
ALTER COLUMN "original_order_gid" SET DATA TYPE TEXT,
ALTER COLUMN "customer_name" SET DATA TYPE TEXT,
ALTER COLUMN "customer_gid" SET DATA TYPE TEXT,
ALTER COLUMN "rsl_csr" SET DATA TYPE TEXT,
ALTER COLUMN "rsl_csr_gid" SET DATA TYPE TEXT,
ALTER COLUMN "rsl_rd_staff" SET DATA TYPE TEXT,
ALTER COLUMN "serial_number" SET DATA TYPE TEXT;

-- CreateIndex
CREATE INDEX "return_entry_return_type_id_idx" ON "public"."return_entry"("return_type_id");

-- CreateIndex
CREATE INDEX "return_entry_primary_customer_reason_id_idx" ON "public"."return_entry"("primary_customer_reason_id");
