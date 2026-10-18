-- Slice 14b load tests: product, category, tax and profit reports read sale lines
-- by date. Without a date on the line, PostgreSQL visited every line the business
-- ever sold (through the variant index) and filtered by the sale's date, so even a
-- one-day report grew with the business's whole history. The sale's date and branch
-- are copied onto its lines; a trigger copies them on insert, so the application
-- cannot get them wrong. Sales and their lines never change, so the copies stay true.

ALTER TABLE "sale_lines" ADD COLUMN "created_at" TIMESTAMPTZ(3), ADD COLUMN "branch_id" UUID;

SELECT set_config('app.rls_bypass', 'on', true);
UPDATE "sale_lines" l SET "created_at" = s."created_at", "branch_id" = s."branch_id"
  FROM "sales" s WHERE s."tenant_id" = l."tenant_id" AND s."id" = l."sale_id";

ALTER TABLE "sale_lines"
  ALTER COLUMN "created_at" SET NOT NULL,
  ALTER COLUMN "branch_id" SET NOT NULL;

CREATE INDEX "sale_lines_tenant_id_created_at_idx" ON "sale_lines"("tenant_id", "created_at");

CREATE FUNCTION sale_lines_copy_sale_fields() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT s."created_at", s."branch_id" INTO NEW."created_at", NEW."branch_id"
  FROM "sales" s WHERE s."tenant_id" = NEW."tenant_id" AND s."id" = NEW."sale_id";
  IF NEW."created_at" IS NULL THEN
    RAISE EXCEPTION 'sale % not found for sale line', NEW."sale_id";
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER sale_lines_copy_sale_fields
  BEFORE INSERT ON "sale_lines"
  FOR EACH ROW EXECUTE FUNCTION sale_lines_copy_sale_fields();
