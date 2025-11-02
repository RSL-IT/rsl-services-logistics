-- AlterTable
ALTER TABLE "tbl_powerbuy_requests" ADD COLUMN     "code_id" INTEGER;

-- CreateIndex
CREATE INDEX "tbl_powerbuy_requests_code_id_idx" ON "tbl_powerbuy_requests"("code_id");

-- AddForeignKey
ALTER TABLE "tbl_powerbuy_requests" ADD CONSTRAINT "tbl_powerbuy_requests_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "tbl_powerbuy_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
