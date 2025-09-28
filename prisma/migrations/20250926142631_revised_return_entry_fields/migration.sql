/*
  Warnings:

  - You are about to drop the `csd_entry` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "public"."return_entry" ADD COLUMN     "serial_number" CHAR(1);

-- DropTable
DROP TABLE "public"."csd_entry";
