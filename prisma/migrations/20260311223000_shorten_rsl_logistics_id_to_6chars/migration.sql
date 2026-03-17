UPDATE "tbl_container"
SET "rslLogisticsID" = CONCAT(
  'RSL-',
  RIGHT(LPAD(UPPER(TO_HEX("id")), 6, '0'), 6)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT "rslLogisticsID"
      FROM "tbl_container"
      GROUP BY "rslLogisticsID"
      HAVING COUNT(*) > 1
    ) dup
  ) THEN
    RAISE EXCEPTION 'Duplicate 6-character rslLogisticsID values detected; cannot shorten safely.';
  END IF;
END
$$;

ALTER TABLE "tbl_container"
  ALTER COLUMN "rslLogisticsID" TYPE VARCHAR(10);
