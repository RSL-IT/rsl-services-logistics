ALTER TABLE "tbl_container"
  ADD COLUMN IF NOT EXISTS "rslLogisticsID" VARCHAR(14);

UPDATE "tbl_container"
SET "rslLogisticsID" = CONCAT('RSL-', LPAD(UPPER(TO_HEX("id")), 10, '0'))
WHERE "rslLogisticsID" IS NULL
   OR BTRIM("rslLogisticsID") = ''
   OR CHAR_LENGTH(BTRIM("rslLogisticsID")) <> 14
   OR LEFT(UPPER(BTRIM("rslLogisticsID")), 4) <> 'RSL-';

ALTER TABLE "tbl_container"
  ALTER COLUMN "rslLogisticsID" SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tbl_container_containerNumber_key'
  ) THEN
    ALTER TABLE "tbl_container" DROP CONSTRAINT "tbl_container_containerNumber_key";
  END IF;
END
$$;

DROP INDEX IF EXISTS "tbl_container_containerNumber_key";

ALTER TABLE "tbl_container"
  ALTER COLUMN "containerNumber" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "tbl_container_rslLogisticsID_key"
  ON "tbl_container"("rslLogisticsID");
