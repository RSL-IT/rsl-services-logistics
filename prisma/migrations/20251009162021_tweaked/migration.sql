/*
  Warnings:

  - You are about to alter the column `name` on the `rsl_staff` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(60)`.
  - You are about to alter the column `role` on the `rsl_staff` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(60)`.
  - You are about to alter the column `gid` on the `rsl_staff` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(60)`.

*/
-- AlterTable
ALTER TABLE "rsl_staff" ALTER COLUMN "name" SET DATA TYPE VARCHAR(60),
ALTER COLUMN "role" SET DATA TYPE VARCHAR(60),
ALTER COLUMN "gid" SET DATA TYPE VARCHAR(60);
