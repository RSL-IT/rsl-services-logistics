/*
  Warnings:

  - You are about to drop the column `powerbuy_gid` on the `tbl_powerbuy_config` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "tbl_powerbuy_config" DROP COLUMN "powerbuy_gid",
ADD COLUMN     "duration" VARCHAR,
ADD COLUMN     "powerbuy_uid" TEXT,
ADD COLUMN     "powerbuy_variant_ids" TEXT;
