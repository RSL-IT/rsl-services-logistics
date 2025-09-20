-- CreateTable
CREATE TABLE "public"."Session" (
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
CREATE TABLE "public"."repair_entry_condition_received" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "repair_entry_condition_received_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."repair_entry_photos" (
    "id" SERIAL NOT NULL,
    "value" BOOLEAN NOT NULL,

    CONSTRAINT "repair_entry_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."repair_entry_diagnosis" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "repair_entry_diagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."repair_entry_disposition" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "repair_entry_disposition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."repair_entry_replaced_items" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "repair_entry_replaced_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."repair_entry_feedback_to_csd" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "repair_entry_feedback_to_csd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."repair_entry_returns_repair_status" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "repair_entry_returns_repair_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."repair_entry_replacement_item_delivery_date" (
    "id" SERIAL NOT NULL,
    "value" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "repair_entry_replacement_item_delivery_date_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."csd_primary_customer_reported_reason_for_return_warranty" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "csd_primary_customer_reported_reason_for_return_warranty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."csd_item" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "csd_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."csd_return_type" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "csd_return_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."csd_troubleshooting_notes" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "csd_troubleshooting_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."csd_customer_service_status" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "csd_customer_service_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."csd_rsl_csd" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "csd_rsl_csd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."csd_return_item_required" (
    "id" SERIAL NOT NULL,
    "value" BOOLEAN NOT NULL,

    CONSTRAINT "csd_return_item_required_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."csd_refund_eligible" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "csd_refund_eligible_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."csd_entry" (
    "id" SERIAL NOT NULL,
    "service_number" TIMESTAMPTZ(6) NOT NULL,
    "date_of_return_request" TIMESTAMPTZ(6),
    "original_order" TEXT,
    "customer_name" TEXT,
    "primary_customer_reported_reason_for_return_warranty" TEXT,
    "col_unnamed" TEXT,
    "item" TEXT,
    "replacement_order" TEXT,
    "return_type" TEXT,
    "troubleshooting_notes" TEXT,
    "customer_service_status" TEXT,
    "rsl_csd" TEXT,
    "return_item_required" BOOLEAN,
    "repair_dept_designation" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "csd_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."repair_entry" (
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
