-- CreateTable
CREATE TABLE "tbl_powerbuy_config" (
    "id" SERIAL NOT NULL,
    "date_created" DATE,
    "created_by" TEXT,
    "created_by_gid" TEXT,
    "title" TEXT,
    "short_description" TEXT,
    "long_description" TEXT,
    "confirmation_email_content" TEXT,
    "acceptance_email_content" TEXT,
    "rsl_contact_email_address" TEXT,
    "discount_prefix" TEXT,
    "start_time" DATE,
    "end_time" DATE,
    "number_of_uses" INTEGER,
    "powerbuy_product_id" TEXT,

    CONSTRAINT "tbl_powerbuy_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tbl_powerbuy_entries" (
    "id" SERIAL NOT NULL,
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

    CONSTRAINT "tbl_powerbuy_entries_pkey" PRIMARY KEY ("id")
);
