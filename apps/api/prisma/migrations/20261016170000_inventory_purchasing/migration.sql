-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIPT', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT_CORRECTION');

-- CreateEnum
CREATE TYPE "AdjustmentReason" AS ENUM ('DAMAGED', 'EXPIRED', 'LOST', 'THEFT', 'FOUND', 'RETURNED_TO_SUPPLIER', 'INTERNAL_USE', 'CORRECTION');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- DropIndex
DROP INDEX "product_variants_sku_prefix_idx";

-- CreateTable
CREATE TABLE "document_sequences" (
    "tenant_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("tenant_id","kind")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "contact_name" VARCHAR(120),
    "phone" VARCHAR(32),
    "email" VARCHAR(254),
    "address" VARCHAR(300),
    "tax_number" VARCHAR(40),
    "notes" VARCHAR(1000),
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "supplier_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "expected_date" DATE,
    "notes" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "ordered_at" TIMESTAMPTZ(3),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "quantity_ordered" DECIMAL(12,3) NOT NULL,
    "quantity_received" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unit_cost_minor" BIGINT NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_number" VARCHAR(40) NOT NULL,
    "expiry_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "type" "MovementType" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "balance_after" DECIMAL(12,3) NOT NULL,
    "unit_cost_minor" BIGINT,
    "reason" "AdjustmentReason",
    "reference_type" VARCHAR(30) NOT NULL,
    "reference_id" UUID NOT NULL,
    "reference_number" VARCHAR(20),
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "branch_id" UUID NOT NULL,
    "supplier_id" UUID,
    "purchase_order_id" UUID,
    "supplier_reference" VARCHAR(60),
    "notes" VARCHAR(1000),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "position" INTEGER NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_cost_minor" BIGINT NOT NULL,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "branch_id" UUID NOT NULL,
    "reason" "AdjustmentReason" NOT NULL,
    "notes" VARCHAR(1000),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "adjustment_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "position" INTEGER NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "stock_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "from_branch_id" UUID NOT NULL,
    "to_branch_id" UUID NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "notes" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "position" INTEGER NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "CountStatus" NOT NULL DEFAULT 'OPEN',
    "notes" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "expected_quantity" DECIMAL(12,3) NOT NULL,
    "counted_quantity" DECIMAL(12,3),
    "variance_quantity" DECIMAL(12,3),

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_tenant_id_status_name_idx" ON "suppliers"("tenant_id", "status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_id_id_key" ON "suppliers"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_status_created_at_idx" ON "purchase_orders"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_id_key" ON "purchase_orders"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_number_key" ON "purchase_orders"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_id_variant_id_key" ON "purchase_order_lines"("purchase_order_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_batches_tenant_id_id_key" ON "stock_batches"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_batches_tenant_id_variant_id_batch_number_key" ON "stock_batches"("tenant_id", "variant_id", "batch_number");

-- CreateIndex
CREATE INDEX "stock_levels_tenant_id_branch_id_variant_id_idx" ON "stock_levels"("tenant_id", "branch_id", "variant_id");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_variant_id_created_at_id_idx" ON "stock_movements"("tenant_id", "variant_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_branch_id_created_at_idx" ON "stock_movements"("tenant_id", "branch_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_reference_type_reference_id_idx" ON "stock_movements"("tenant_id", "reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "goods_receipts_tenant_id_created_at_idx" ON "goods_receipts"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_tenant_id_id_key" ON "goods_receipts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_tenant_id_number_key" ON "goods_receipts"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_tenant_id_receipt_id_idx" ON "goods_receipt_lines"("tenant_id", "receipt_id");

-- CreateIndex
CREATE INDEX "stock_adjustments_tenant_id_created_at_idx" ON "stock_adjustments"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_tenant_id_id_key" ON "stock_adjustments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_tenant_id_number_key" ON "stock_adjustments"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_tenant_id_adjustment_id_idx" ON "stock_adjustment_lines"("tenant_id", "adjustment_id");

-- CreateIndex
CREATE INDEX "stock_transfers_tenant_id_status_created_at_idx" ON "stock_transfers"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_tenant_id_id_key" ON "stock_transfers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_tenant_id_number_key" ON "stock_transfers"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_tenant_id_transfer_id_idx" ON "stock_transfer_lines"("tenant_id", "transfer_id");

-- CreateIndex
CREATE INDEX "stock_counts_tenant_id_status_created_at_idx" ON "stock_counts"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_tenant_id_id_key" ON "stock_counts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_tenant_id_number_key" ON "stock_counts"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "stock_count_lines_tenant_id_count_id_idx" ON "stock_count_lines"("tenant_id", "count_id");

-- CreateIndex
CREATE INDEX "product_variants_sku_prefix_idx" ON "product_variants"("tenant_id", "sku" varchar_pattern_ops);

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_tenant_id_id_key" ON "product_variants"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "suppliers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_purchase_order_id_fkey" FOREIGN KEY ("tenant_id", "purchase_order_id") REFERENCES "purchase_orders"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "product_variants"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "product_variants"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "product_variants"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "stock_batches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "product_variants"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "stock_batches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "suppliers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_purchase_order_id_fkey" FOREIGN KEY ("tenant_id", "purchase_order_id") REFERENCES "purchase_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenant_id_receipt_id_fkey" FOREIGN KEY ("tenant_id", "receipt_id") REFERENCES "goods_receipts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "product_variants"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "stock_batches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_tenant_id_adjustment_id_fkey" FOREIGN KEY ("tenant_id", "adjustment_id") REFERENCES "stock_adjustments"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "product_variants"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "stock_batches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenant_id_from_branch_id_fkey" FOREIGN KEY ("tenant_id", "from_branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenant_id_to_branch_id_fkey" FOREIGN KEY ("tenant_id", "to_branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_tenant_id_transfer_id_fkey" FOREIGN KEY ("tenant_id", "transfer_id") REFERENCES "stock_transfers"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "product_variants"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "stock_batches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_tenant_id_count_id_fkey" FOREIGN KEY ("tenant_id", "count_id") REFERENCES "stock_counts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "product_variants"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "stock_batches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: keys Prisma cannot express, integrity checks, RLS
-- ---------------------------------------------------------------------------

-- One balance row per branch/variant/batch, where "no batch" is a single key value.
CREATE UNIQUE INDEX "stock_levels_branch_variant_batch_key"
  ON "stock_levels" ("tenant_id", "branch_id", "variant_id", "batch_id") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "stock_count_lines_item_key"
  ON "stock_count_lines" ("count_id", "variant_id", "batch_id") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "suppliers_tenant_name_key" ON "suppliers" ("tenant_id", lower("name"));

-- Stock can never go below zero; StockLedger maps this violation to INSUFFICIENT_STOCK.
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_quantity_non_negative" CHECK ("quantity" >= 0);
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_quantity_non_zero" CHECK ("quantity" <> 0),
  ADD CONSTRAINT "stock_movements_balance_non_negative" CHECK ("balance_after" >= 0);
ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_ordered_positive" CHECK ("quantity_ordered" > 0),
  ADD CONSTRAINT "purchase_order_lines_received_non_negative" CHECK ("quantity_received" >= 0),
  ADD CONSTRAINT "purchase_order_lines_cost_non_negative" CHECK ("unit_cost_minor" >= 0);
ALTER TABLE "goods_receipt_lines"
  ADD CONSTRAINT "goods_receipt_lines_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "goods_receipt_lines_cost_non_negative" CHECK ("unit_cost_minor" >= 0);
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_non_zero" CHECK ("quantity" <> 0);
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_positive" CHECK ("quantity" > 0);
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_distinct_branches" CHECK ("from_branch_id" <> "to_branch_id");
ALTER TABLE "stock_count_lines"
  ADD CONSTRAINT "stock_count_lines_counted_non_negative" CHECK ("counted_quantity" IS NULL OR "counted_quantity" >= 0);
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_positive" CHECK ("next_value" >= 1);

-- Row-level security on every new tenant table.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'document_sequences', 'suppliers', 'purchase_orders', 'purchase_order_lines', 'stock_batches',
    'stock_levels', 'stock_movements', 'goods_receipts', 'goods_receipt_lines', 'stock_adjustments',
    'stock_adjustment_lines', 'stock_transfers', 'stock_transfer_lines', 'stock_counts', 'stock_count_lines'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_rls_bypass() OR tenant_id = app_current_tenant_id()) '
      'WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant_id())', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO pos_app', t);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    -- The stock ledger is append-only for the application, like the audit log.
    REVOKE UPDATE, DELETE, TRUNCATE ON "stock_movements" FROM pos_app;
  END IF;
END
$$;
