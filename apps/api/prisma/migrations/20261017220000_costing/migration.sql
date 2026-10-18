-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "cost_minor" BIGINT;

-- CreateTable
CREATE TABLE "variant_costs" (
    "tenant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "average_cost4" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "variant_costs_pkey" PRIMARY KEY ("tenant_id","variant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "variant_costs_variant_id_key" ON "variant_costs"("variant_id");

-- AddForeignKey
ALTER TABLE "variant_costs" ADD CONSTRAINT "variant_costs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_costs" ADD CONSTRAINT "variant_costs_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "product_variants"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: checks, RLS, and a backfill of costs for existing data
-- ---------------------------------------------------------------------------

ALTER TABLE "variant_costs" ADD CONSTRAINT "variant_costs_non_negative" CHECK ("average_cost4" >= 0);
ALTER TABLE "variant_costs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "variant_costs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "variant_costs"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant_id())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant_id());
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "variant_costs" TO pos_app;
    REVOKE DELETE, TRUNCATE ON "variant_costs" FROM pos_app;
  END IF;
END
$$;

-- RLS is forced even for the owner, so the backfill runs with the bypass on (this transaction only).
SELECT set_config('app.rls_bypass', 'on', true);

-- Starting average: the quantity-weighted cost of everything received so far (approximate for
-- history; exact from now on, as each receipt updates the moving average).
INSERT INTO "variant_costs" ("tenant_id", "variant_id", "average_cost4", "updated_at")
SELECT "tenant_id", "variant_id",
       ROUND(SUM("quantity" * "unit_cost_minor") * 10000 / SUM("quantity"))::bigint, now()
FROM "stock_movements"
WHERE "type" = 'RECEIPT' AND "unit_cost_minor" IS NOT NULL AND "quantity" > 0
GROUP BY "tenant_id", "variant_id";

-- Earlier sales and returns get the cost they would have had at that average.
UPDATE "stock_movements" m
SET "cost_minor" = ROUND(ABS(m."quantity") * c."average_cost4" / 10000)::bigint
FROM "variant_costs" c
WHERE c."tenant_id" = m."tenant_id" AND c."variant_id" = m."variant_id"
  AND m."type" IN ('SALE', 'RETURN') AND m."cost_minor" IS NULL;
