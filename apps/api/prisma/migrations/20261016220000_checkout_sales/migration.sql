-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED');

-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('PERCENT', 'AMOUNT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'SALE';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "tax_rate_id" UUID;

-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN     "allow_negative_stock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prices_include_tax" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "receipt_footer" VARCHAR(300);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "rate_bp" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "branch_id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "opening_float_minor" BIGINT NOT NULL,
    "opened_by_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by_id" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "expected_cash_minor" BIGINT,
    "counted_cash_minor" BIGINT,
    "closing_notes" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "branch_id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "cashier_id" UUID,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "currency" CHAR(3) NOT NULL,
    "prices_include_tax" BOOLEAN NOT NULL,
    "discount_kind" "DiscountKind",
    "discount_value" BIGINT,
    "subtotal_minor" BIGINT NOT NULL,
    "discount_minor" BIGINT NOT NULL,
    "tax_minor" BIGINT NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "paid_minor" BIGINT NOT NULL,
    "change_minor" BIGINT NOT NULL,
    "notes" VARCHAR(500),
    "request_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "variant_id" UUID NOT NULL,
    "product_name" VARCHAR(120) NOT NULL,
    "sku" VARCHAR(40) NOT NULL,
    "variant_label" VARCHAR(400) NOT NULL,
    "unit" VARCHAR(16) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "discount_kind" "DiscountKind",
    "discount_value" BIGINT,
    "line_discount_minor" BIGINT NOT NULL,
    "cart_discount_minor" BIGINT NOT NULL,
    "tax_rate_id" UUID,
    "tax_name" VARCHAR(60),
    "tax_rate_bp" INTEGER NOT NULL,
    "tax_minor" BIGINT NOT NULL,
    "total_minor" BIGINT NOT NULL,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "reference" VARCHAR(40),

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_rates_tenant_id_status_idx" ON "tax_rates"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_tenant_id_id_key" ON "tax_rates"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "shifts_tenant_id_status_opened_at_idx" ON "shifts"("tenant_id", "status", "opened_at");

-- CreateIndex
CREATE INDEX "shifts_tenant_id_register_id_opened_at_idx" ON "shifts"("tenant_id", "register_id", "opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_tenant_id_id_key" ON "shifts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_tenant_id_number_key" ON "shifts"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "sales_tenant_id_created_at_id_idx" ON "sales"("tenant_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "sales_tenant_id_shift_id_idx" ON "sales"("tenant_id", "shift_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_tenant_id_id_key" ON "sales"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_tenant_id_number_key" ON "sales"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "sale_lines_tenant_id_sale_id_idx" ON "sale_lines"("tenant_id", "sale_id");

-- CreateIndex
CREATE INDEX "sale_lines_tenant_id_variant_id_idx" ON "sale_lines"("tenant_id", "variant_id");

-- CreateIndex
CREATE INDEX "sale_payments_tenant_id_sale_id_idx" ON "sale_payments"("tenant_id", "sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "registers_tenant_id_branch_id_id_key" ON "registers"("tenant_id", "branch_id", "id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tax_rate_id_fkey" FOREIGN KEY ("tenant_id", "tax_rate_id") REFERENCES "tax_rates"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_id_branch_id_register_id_fkey" FOREIGN KEY ("tenant_id", "branch_id", "register_id") REFERENCES "registers"("tenant_id", "branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_branch_id_register_id_fkey" FOREIGN KEY ("tenant_id", "branch_id", "register_id") REFERENCES "registers"("tenant_id", "branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_shift_id_fkey" FOREIGN KEY ("tenant_id", "shift_id") REFERENCES "shifts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_tenant_id_sale_id_fkey" FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sales"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "product_variants"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_tenant_id_sale_id_fkey" FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sales"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: keys Prisma cannot express, integrity checks, RLS
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "tax_rates_tenant_name_key" ON "tax_rates" ("tenant_id", lower("name"));
-- At most one default rate per tenant.
CREATE UNIQUE INDEX "tax_rates_one_default_key" ON "tax_rates" ("tenant_id") WHERE "is_default";
ALTER TABLE "tax_rates"
  ADD CONSTRAINT "tax_rates_rate_range" CHECK ("rate_bp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "tax_rates_default_active" CHECK (NOT "is_default" OR "status" = 'ACTIVE');

-- One open shift per register at a time.
CREATE UNIQUE INDEX "shifts_one_open_per_register_key" ON "shifts" ("tenant_id", "register_id") WHERE "status" = 'OPEN';
ALTER TABLE "shifts"
  ADD CONSTRAINT "shifts_float_non_negative" CHECK ("opening_float_minor" >= 0),
  ADD CONSTRAINT "shifts_counted_non_negative" CHECK ("counted_cash_minor" IS NULL OR "counted_cash_minor" >= 0),
  ADD CONSTRAINT "shifts_closed_complete" CHECK (
    ("status" = 'OPEN' AND "closed_at" IS NULL AND "counted_cash_minor" IS NULL)
    OR ("status" = 'CLOSED' AND "closed_at" IS NOT NULL AND "counted_cash_minor" IS NOT NULL
        AND "expected_cash_minor" IS NOT NULL));

-- Sale totals must add up, whatever code wrote them.
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_amounts_non_negative" CHECK (
    "subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "tax_minor" >= 0 AND "total_minor" >= 0
    AND "paid_minor" >= 0 AND "change_minor" >= 0),
  ADD CONSTRAINT "sales_total_consistent" CHECK (
    "total_minor" = "subtotal_minor" - "discount_minor" + CASE WHEN "prices_include_tax" THEN 0 ELSE "tax_minor" END),
  ADD CONSTRAINT "sales_settled" CHECK ("paid_minor" = "total_minor" + "change_minor"),
  ADD CONSTRAINT "sales_discount_valid" CHECK (
    ("discount_kind" IS NULL AND "discount_value" IS NULL)
    OR ("discount_kind" = 'PERCENT' AND "discount_value" BETWEEN 0 AND 10000)
    OR ("discount_kind" = 'AMOUNT' AND "discount_value" >= 0));
ALTER TABLE "sale_lines"
  ADD CONSTRAINT "sale_lines_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "sale_lines_amounts_non_negative" CHECK (
    "unit_price_minor" >= 0 AND "line_discount_minor" >= 0 AND "cart_discount_minor" >= 0
    AND "tax_minor" >= 0 AND "total_minor" >= 0),
  ADD CONSTRAINT "sale_lines_tax_rate_range" CHECK ("tax_rate_bp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "sale_lines_discount_valid" CHECK (
    ("discount_kind" IS NULL AND "discount_value" IS NULL)
    OR ("discount_kind" = 'PERCENT' AND "discount_value" BETWEEN 0 AND 10000)
    OR ("discount_kind" = 'AMOUNT' AND "discount_value" >= 0));
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_amount_positive" CHECK ("amount_minor" > 0);

-- Negative-stock policy (ADR 0007): the "never below zero" rule moves from CHECK constraints
-- to StockLedger's conditional UPDATE, which is equally race-safe and lets a tenant opt in to
-- selling past recorded stock.
ALTER TABLE "stock_levels" DROP CONSTRAINT "stock_levels_quantity_non_negative";
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_balance_non_negative";

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_rates', 'shifts', 'sales', 'sale_lines', 'sale_payments'] LOOP
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
    -- Completed sales are financial records: the application can add them, never edit or delete them.
    REVOKE UPDATE, DELETE, TRUNCATE ON "sales", "sale_lines", "sale_payments" FROM pos_app;
  END IF;
END
$$;
