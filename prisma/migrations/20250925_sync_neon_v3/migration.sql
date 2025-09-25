-- =========================================================
-- Idempotent baseline sync for RSL returns/repairs schema
-- Postgres / Neon safe to re-run
-- =========================================================

BEGIN;

-- 0) Rename old plural table if present
DO $$
BEGIN
  IF to_regclass('public.return_entries') IS NOT NULL
     AND to_regclass('public.return_entry') IS NULL THEN
ALTER TABLE public.return_entries RENAME TO return_entry;
END IF;
END $$;

-- 1) Lookup / small tables (idempotent creates)

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

-- 2) Main tables

-- Repair entries
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

-- Department lookup
CREATE TABLE IF NOT EXISTS "public"."tlkp_department" (
                                                        "id" SERIAL NOT NULL,
                                                        "name" CHAR(1),
  CONSTRAINT "tlkp_department_pkey" PRIMARY KEY ("id")
  );

-- Note/department/user/return join
CREATE TABLE IF NOT EXISTS "public"."tbljn_note_departmentUserReturnEntry" (
                                                                             "id" SERIAL NOT NULL,
                                                                             "department_id" INTEGER,
                                                                             "user_gid" CHAR(1),
  "note" TEXT,
  "return_entry_id" INTEGER,
  CONSTRAINT "tbljn_note_departmentUserReturnEntry_pkey" PRIMARY KEY ("id")
  );

-- Return entries (ensure exists; reconcile below)
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

-- 3) Reconcile columns on public.return_entry (idempotent)

-- Add any missing columns (nullable-first for safety)
ALTER TABLE "public"."return_entry"
  ADD COLUMN IF NOT EXISTS "date_requested" DATE,
  ADD COLUMN IF NOT EXISTS "original_order" CHAR(1),
  ADD COLUMN IF NOT EXISTS "original_order_gid" CHAR(1),
  ADD COLUMN IF NOT EXISTS "customer_name" CHAR(1),
  ADD COLUMN IF NOT EXISTS "customer_gid" CHAR(1),
  ADD COLUMN IF NOT EXISTS "primary_customer_reason_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "item_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "return_type_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "customer_service_status_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "rsl_csr" CHAR(1),
  ADD COLUMN IF NOT EXISTS "rsl_csr_gid" CHAR(1),
  ADD COLUMN IF NOT EXISTS "return_item_required" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "final_disposition_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "date_received" DATE,
  ADD COLUMN IF NOT EXISTS "repair_condition_received_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "date_inspected" DATE,
  ADD COLUMN IF NOT EXISTS "rsl_rd_staff" CHAR(1),
  ADD COLUMN IF NOT EXISTS "rsl_rd_staff_gid" INTEGER,
  ADD COLUMN IF NOT EXISTS "replacement_order" INTEGER,
  ADD COLUMN IF NOT EXISTS "replaced_items_todo" INTEGER,
  ADD COLUMN IF NOT EXISTS "status_id" INTEGER;

-- Guarded type corrections (only if the current type differs)
DO $$
BEGIN
  -- Example: ensure original_order is CHAR(1)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='return_entry'
      AND column_name='original_order' AND (data_type <> 'character' OR character_maximum_length <> 1)
  ) THEN
ALTER TABLE "public"."return_entry"
ALTER COLUMN "original_order" TYPE CHAR(1) USING LEFT("original_order"::text, 1);
END IF;

  -- Ensure customer_name is CHAR(1)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='return_entry'
      AND column_name='customer_name' AND (data_type <> 'character' OR character_maximum_length <> 1)
  ) THEN
ALTER TABLE "public"."return_entry"
ALTER COLUMN "customer_name" TYPE CHAR(1) USING LEFT("customer_name"::text, 1);
END IF;
END $$;

-- Optional: Set NOT NULL where safe (only if there are no NULLs)
DO $$
BEGIN
  -- original_order NOT NULL if no nulls present
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='return_entry' AND column_name='original_order')
     AND NOT EXISTS (SELECT 1 FROM public.return_entry WHERE original_order IS NULL) THEN
ALTER TABLE "public"."return_entry" ALTER COLUMN "original_order" SET NOT NULL;
END IF;

  -- customer_name NOT NULL if no nulls present
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='return_entry' AND column_name='customer_name')
     AND NOT EXISTS (SELECT 1 FROM public.return_entry WHERE customer_name IS NULL) THEN
ALTER TABLE "public"."return_entry" ALTER COLUMN "customer_name" SET NOT NULL;
END IF;
END $$;

COMMIT;
