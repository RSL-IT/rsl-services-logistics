/*
  Warnings:

  - You are about to drop the column `acceptance_email_content` on the `tbl_powerbuy_config` table. All the data in the column will be lost.
  - You are about to drop the column `confirmation_email_content` on the `tbl_powerbuy_config` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "tbl_powerbuy_config" DROP COLUMN "acceptance_email_content",
DROP COLUMN "confirmation_email_content",
ADD COLUMN     "confirm_email_content" TEXT,
ADD COLUMN     "confirm_email_subject" TEXT,
ADD COLUMN     "mailer_from_header" TEXT,
ADD COLUMN     "mailer_smtp_from_default" TEXT,
ADD COLUMN     "mailer_smtp_host" TEXT,
ADD COLUMN     "mailer_smtp_pass" TEXT,
ADD COLUMN     "mailer_smtp_port" INTEGER,
ADD COLUMN     "mailer_smtp_user" TEXT,
ADD COLUMN     "request_email_content" TEXT,
ADD COLUMN     "request_email_subject" TEXT;
