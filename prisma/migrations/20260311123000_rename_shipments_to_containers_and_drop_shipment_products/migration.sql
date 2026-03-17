BEGIN;

-- Rename core shipment tables to container tables.
DO $$
BEGIN
  IF to_regclass('public."tbl_shipment"') IS NOT NULL AND to_regclass('public."tbl_container"') IS NULL THEN
    EXECUTE 'ALTER TABLE "tbl_shipment" RENAME TO "tbl_container"';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public."tbl_shipmentNotes"') IS NOT NULL AND to_regclass('public."tbl_containerNotes"') IS NULL THEN
    EXECUTE 'ALTER TABLE "tbl_shipmentNotes" RENAME TO "tbl_containerNotes"';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public."tbljn_shipment_purchaseOrder"') IS NOT NULL
     AND to_regclass('public."tbljn_container_purchaseOrder"') IS NULL THEN
    EXECUTE 'ALTER TABLE "tbljn_shipment_purchaseOrder" RENAME TO "tbljn_container_purchaseOrder"';
  END IF;
END
$$;

-- Rename notes FK column shipmentId -> containerId.
DO $$
BEGIN
  IF to_regclass('public."tbl_containerNotes"') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tbl_containerNotes'
        AND column_name = 'shipmentId'
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tbl_containerNotes'
        AND column_name = 'containerId'
    ) THEN
      EXECUTE 'ALTER TABLE "tbl_containerNotes" RENAME COLUMN "shipmentId" TO "containerId"';
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tbl_containerNotes'
        AND column_name = 'shipmentId'
    ) AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tbl_containerNotes'
        AND column_name = 'containerId'
    ) THEN
      EXECUTE 'UPDATE "tbl_containerNotes" SET "containerId" = "shipmentId" WHERE "containerId" IS NULL';
      EXECUTE 'ALTER TABLE "tbl_containerNotes" DROP COLUMN "shipmentId"';
    END IF;
  END IF;
END
$$;

-- Convert PO link table from shipmentID (containerNumber text) to containerID (tbl_container.id).
DO $$
BEGIN
  IF to_regclass('public."tbljn_container_purchaseOrder"') IS NOT NULL THEN
    ALTER TABLE "tbljn_container_purchaseOrder" ADD COLUMN IF NOT EXISTS "containerID" INTEGER;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tbljn_container_purchaseOrder'
        AND column_name = 'shipmentID'
    ) THEN
      UPDATE "tbljn_container_purchaseOrder" j
      SET "containerID" = c.id
      FROM "tbl_container" c
      WHERE c."containerNumber" = j."shipmentID";
    END IF;

    DELETE FROM "tbljn_container_purchaseOrder" WHERE "containerID" IS NULL;

    DELETE FROM "tbljn_container_purchaseOrder" j
    WHERE NOT EXISTS (
      SELECT 1
      FROM "tbl_container" c
      WHERE c.id = j."containerID"
    );

    DELETE FROM "tbljn_container_purchaseOrder" j
    WHERE NOT EXISTS (
      SELECT 1
      FROM "tbl_purchaseOrder" po
      WHERE po."purchaseOrderGID" = j."purchaseOrderGID"
    );

    -- Remove duplicates before adding the unique index.
    DELETE FROM "tbljn_container_purchaseOrder" a
    USING "tbljn_container_purchaseOrder" b
    WHERE a.id > b.id
      AND a."containerID" = b."containerID"
      AND a."purchaseOrderGID" = b."purchaseOrderGID";

    ALTER TABLE "tbljn_container_purchaseOrder" DROP COLUMN IF EXISTS "shipmentID" CASCADE;
    ALTER TABLE "tbljn_container_purchaseOrder" ALTER COLUMN "containerID" SET NOT NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public."tbljn_container_purchaseOrder"') IS NOT NULL THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "tbljn_container_purchaseOrder_containerID_purchaseOrderGID_key" ON "tbljn_container_purchaseOrder"("containerID", "purchaseOrderGID")';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "tbljn_container_purchaseOrder_containerID_idx" ON "tbljn_container_purchaseOrder"("containerID")';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "tbljn_container_purchaseOrder_purchaseOrderGID_idx" ON "tbljn_container_purchaseOrder"("purchaseOrderGID")';
  END IF;
END
$$;

-- Drop old shipment product table; replaced by per-container PO-product allocations.
DROP TABLE IF EXISTS "tbljn_shipment_rslProduct";

CREATE TABLE IF NOT EXISTS "tbljn_container_purchaseOrder_rslProduct" (
  "id" SERIAL PRIMARY KEY,
  "containerID" INTEGER NOT NULL,
  "purchaseOrderGID" TEXT NOT NULL,
  "rslProductID" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0
);

DELETE FROM "tbljn_container_purchaseOrder_rslProduct"
WHERE "containerID" IS NULL
   OR "purchaseOrderGID" IS NULL
   OR "rslProductID" IS NULL;

DELETE FROM "tbljn_container_purchaseOrder_rslProduct" j
WHERE NOT EXISTS (
  SELECT 1
  FROM "tbl_container" c
  WHERE c.id = j."containerID"
);

DELETE FROM "tbljn_container_purchaseOrder_rslProduct" j
WHERE NOT EXISTS (
  SELECT 1
  FROM "tbl_purchaseOrder" po
  WHERE po."purchaseOrderGID" = j."purchaseOrderGID"
);

DELETE FROM "tbljn_container_purchaseOrder_rslProduct" j
WHERE NOT EXISTS (
  SELECT 1
  FROM "tlkp_rslProduct" p
  WHERE p."shortName" = j."rslProductID"
);

DELETE FROM "tbljn_container_purchaseOrder_rslProduct" a
USING "tbljn_container_purchaseOrder_rslProduct" b
WHERE a.id > b.id
  AND a."containerID" = b."containerID"
  AND a."purchaseOrderGID" = b."purchaseOrderGID"
  AND a."rslProductID" = b."rslProductID";

CREATE UNIQUE INDEX IF NOT EXISTS "tbljn_container_po_product_unique"
  ON "tbljn_container_purchaseOrder_rslProduct"("containerID", "purchaseOrderGID", "rslProductID");

CREATE INDEX IF NOT EXISTS "tbljn_container_purchaseOrder_rslProduct_containerID_idx"
  ON "tbljn_container_purchaseOrder_rslProduct"("containerID");

CREATE INDEX IF NOT EXISTS "tbljn_container_purchaseOrder_rslProduct_purchaseOrderGID_idx"
  ON "tbljn_container_purchaseOrder_rslProduct"("purchaseOrderGID");

CREATE INDEX IF NOT EXISTS "tbljn_container_purchaseOrder_rslProduct_rslProductID_idx"
  ON "tbljn_container_purchaseOrder_rslProduct"("rslProductID");

DO $$
BEGIN
  IF to_regclass('public."tbljn_container_purchaseOrder"') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'tbljn_container_purchaseOrder_containerID_fkey'
    ) THEN
      ALTER TABLE "tbljn_container_purchaseOrder"
        ADD CONSTRAINT "tbljn_container_purchaseOrder_containerID_fkey"
        FOREIGN KEY ("containerID") REFERENCES "tbl_container"("id") ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'tbljn_container_purchaseOrder_purchaseOrderGID_fkey'
    ) THEN
      ALTER TABLE "tbljn_container_purchaseOrder"
        ADD CONSTRAINT "tbljn_container_purchaseOrder_purchaseOrderGID_fkey"
        FOREIGN KEY ("purchaseOrderGID") REFERENCES "tbl_purchaseOrder"("purchaseOrderGID") ON DELETE RESTRICT;
    END IF;
  END IF;

  IF to_regclass('public."tbljn_container_purchaseOrder_rslProduct"') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'tbljn_container_purchaseOrder_rslProduct_containerID_fkey'
    ) THEN
      ALTER TABLE "tbljn_container_purchaseOrder_rslProduct"
        ADD CONSTRAINT "tbljn_container_purchaseOrder_rslProduct_containerID_fkey"
        FOREIGN KEY ("containerID") REFERENCES "tbl_container"("id") ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'tbljn_container_purchaseOrder_rslProduct_purchaseOrderGID_fkey'
    ) THEN
      ALTER TABLE "tbljn_container_purchaseOrder_rslProduct"
        ADD CONSTRAINT "tbljn_container_purchaseOrder_rslProduct_purchaseOrderGID_fkey"
        FOREIGN KEY ("purchaseOrderGID") REFERENCES "tbl_purchaseOrder"("purchaseOrderGID") ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'tbljn_container_purchaseOrder_rslProduct_rslProductID_fkey'
    ) THEN
      ALTER TABLE "tbljn_container_purchaseOrder_rslProduct"
        ADD CONSTRAINT "tbljn_container_purchaseOrder_rslProduct_rslProductID_fkey"
        FOREIGN KEY ("rslProductID") REFERENCES "tlkp_rslProduct"("shortName") ON DELETE CASCADE;
    END IF;
  END IF;
END
$$;

COMMIT;
