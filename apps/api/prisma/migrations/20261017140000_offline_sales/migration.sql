-- CreateEnum
CREATE TYPE "SaleConflictType" AS ENUM ('PRICE_CHANGED', 'STOCK_SHORT', 'SHIFT_CLOSED', 'APPROVAL_MISSING', 'ITEM_ARCHIVED');

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "captured_offline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "synced_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "sale_conflicts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "type" "SaleConflictType" NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,
    "resolution_note" VARCHAR(500),

    CONSTRAINT "sale_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_conflicts_tenant_id_resolved_at_created_at_idx" ON "sale_conflicts"("tenant_id", "resolved_at", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sale_conflicts_sale_id_type_key" ON "sale_conflicts"("sale_id", "type");

-- AddForeignKey
ALTER TABLE "sale_conflicts" ADD CONSTRAINT "sale_conflicts_tenant_id_sale_id_fkey" FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sales"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_conflicts" ADD CONSTRAINT "sale_conflicts_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: RLS, grants, and the indexes behind catalogue delta sync
-- ---------------------------------------------------------------------------

ALTER TABLE "sale_conflicts"
  ADD CONSTRAINT "sale_conflicts_resolution_complete"
  CHECK ("resolved_by_id" IS NULL OR "resolved_at" IS NOT NULL);
ALTER TABLE "sale_conflicts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sale_conflicts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sale_conflicts"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant_id())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant_id());
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    -- Conflicts are resolved in place (resolved_at, note) but never deleted.
    GRANT SELECT, INSERT, UPDATE ON "sale_conflicts" TO pos_app;
    REVOKE DELETE, TRUNCATE ON "sale_conflicts" FROM pos_app;
  END IF;
END
$$;

-- Devices pull catalogue changes since their last sync, ordered by change time.
CREATE INDEX "product_variants_tenant_updated_idx" ON "product_variants" ("tenant_id", "updated_at", "id");
CREATE INDEX "products_tenant_updated_idx" ON "products" ("tenant_id", "updated_at");
