/*
  Warnings:

  - You are about to drop the column `department_id` on the `tbljn_note_departmentUserReturnEntry` table. All the data in the column will be lost.
  - You are about to drop the `csd_rsl_csd` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `repair_entry` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `tlkp_department` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "return_entry" ALTER COLUMN "rsl_rd_staff_gid" SET DATA TYPE TEXT,
ALTER COLUMN "replacement_order" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "tbljn_note_departmentUserReturnEntry" DROP COLUMN "department_id",
ALTER COLUMN "user_gid" SET DATA TYPE TEXT;

-- DropTable
DROP TABLE "public"."csd_rsl_csd";

-- DropTable
DROP TABLE "public"."repair_entry";

-- DropTable
DROP TABLE "public"."tlkp_department";

-- CreateTable
CREATE TABLE "rsl_staff" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "role" TEXT,
    "gid" TEXT,

    CONSTRAINT "rsl_staff_pkey" PRIMARY KEY ("id")
);
