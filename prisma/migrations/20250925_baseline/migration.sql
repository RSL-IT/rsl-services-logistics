-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."Session" (
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
CREATE TABLE IF NOT EXISTS "public"."repair_entry_condition_received" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "repair_entry_condition_received_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."repair_entry_photos" (
    "id" SERIAL NOT NULL,
    "value" BOOLEAN NOT NULL,

    CONSTRAINT "repair_entry_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."repair_entry_diagnosis" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "repair_entry_diagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."repair_entry_disposition" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "repair_entry_disposition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."repair_entry_replaced_items" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "repair_entry_replaced_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."repair_entry_feedback_to_csd" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "repair_entry_feedback_to_csd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."repair_entry_returns_repair_status" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "repair_entry_returns_repair_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."repair_entry_replacement_item_delivery_date" (
    "id" SERIAL NOT NULL,
    "value" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "repair_entry_replacement_item_delivery_date_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."csd_primary_customer_reported_reason_for_return_warranty" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "csd_primary_customer_reported_reason_for_return_warranty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."csd_item" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "csd_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."csd_return_type" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "csd_return_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."csd_troubleshooting_notes" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "csd_troubleshooting_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."csd_customer_service_status" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "csd_customer_service_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."csd_rsl_csd" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "csd_rsl_csd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."csd_return_item_required" (
    "id" SERIAL NOT NULL,
    "value" BOOLEAN NOT NULL,

    CONSTRAINT "csd_return_item_required_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."csd_refund_eligible" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "csd_refund_eligible_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."repair_entry" (
    "id" SERIAL NOT NULL,
    "service_number" TIMESTAMPTZ(6),
    "date_of_repair_request" TIMESTAMPTZ(6),
    "original_order" TEXT,
    "customer_name" TEXT,
    "item" TEXT,
    "replacement_order" TEXT,
    "repair_type" TEXT,
    "repair_notes" TEXT,
    "customer_service_status" TEXT,
    "rsl_repair_dept" TEXT,
    "repair_completed" BOOLEAN,
    "repair_dept_designation" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."tlkp_department" (
    "id" SERIAL NOT NULL,
    "name" CHAR(1),

    CONSTRAINT "tlkp_department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."tbljn_note_departmentUserReturnEntry" (
    "id" SERIAL NOT NULL,
    "department_id" INTEGER,
    "user_gid" CHAR(1),
    "note" TEXT,
    "return_entry_id" INTEGER,

    CONSTRAINT "tbljn_note_departmentUserReturnEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."return_entry" (
    "id" SERIAL NOT NULL,
    "date_requested" DATE,
    "original_order" CHAR(1) NOT NULL,
    "original_order_gid" CHAR(1),
    "customer_name" CHAR(1) NOT NULL,
    "customer_gid" CHAR(1),
    "primary_customer_reason_id" INTEGER,
    "item_id" INTEGER,
    "return_type_id" INTEGER,
    "customer_service_status_id" INTEGER,
    "rsl_csr" CHAR(1),
    "rsl_csr_gid" CHAR(1),
    "return_item_required" BOOLEAN,
    "final_disposition_id" INTEGER,
    "date_received" DATE,
    "repair_condition_received_id" INTEGER,
    "date_inspected" DATE,
    "rsl_rd_staff" CHAR(1),
    "rsl_rd_staff_gid" INTEGER,
    "replacement_order" INTEGER,
    "replaced_items_todo" INTEGER,
    "status_id" INTEGER,

    CONSTRAINT "return_entry_pk" PRIMARY KEY ("id")
);

