-- CreateEnum
CREATE TYPE "ReturnKind" AS ENUM ('RETURN', 'VOID');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('PAY_IN', 'PAY_OUT');

-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'RETURN';

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "approval_pin_failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "approval_pin_hash" VARCHAR(255),
ADD COLUMN     "approval_pin_locked_until" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "approved_by_id" UUID;

-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN     "discount_approval_bp" INTEGER,
ADD COLUMN     "refunds_require_approval" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "sale_returns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "kind" "ReturnKind" NOT NULL,
    "sale_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "cashier_id" UUID,
    "approved_by_id" UUID,
    "reason" VARCHAR(200) NOT NULL,
    "refund_minor" BIGINT NOT NULL,
    "tax_minor" BIGINT NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "sale_line_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "restock" BOOLEAN NOT NULL,
    "refund_minor" BIGINT NOT NULL,
    "tax_minor" BIGINT NOT NULL,

    CONSTRAINT "sale_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return_refunds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "reference" VARCHAR(40),

    CONSTRAINT "sale_return_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_returns_tenant_id_sale_id_idx" ON "sale_returns"("tenant_id", "sale_id");

-- CreateIndex
CREATE INDEX "sale_returns_tenant_id_shift_id_idx" ON "sale_returns"("tenant_id", "shift_id");

-- CreateIndex
CREATE INDEX "sale_returns_tenant_id_created_at_idx" ON "sale_returns"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_tenant_id_id_key" ON "sale_returns"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_tenant_id_number_key" ON "sale_returns"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "sale_return_lines_tenant_id_return_id_idx" ON "sale_return_lines"("tenant_id", "return_id");

-- CreateIndex
CREATE INDEX "sale_return_lines_tenant_id_sale_line_id_idx" ON "sale_return_lines"("tenant_id", "sale_line_id");

-- CreateIndex
CREATE INDEX "sale_return_refunds_tenant_id_return_id_idx" ON "sale_return_refunds"("tenant_id", "return_id");

-- CreateIndex
CREATE INDEX "cash_movements_tenant_id_shift_id_idx" ON "cash_movements"("tenant_id", "shift_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_lines_tenant_id_id_key" ON "sale_lines"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_tenant_id_sale_id_fkey" FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sales"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_tenant_id_shift_id_fkey" FOREIGN KEY ("tenant_id", "shift_id") REFERENCES "shifts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_tenant_id_branch_id_register_id_fkey" FOREIGN KEY ("tenant_id", "branch_id", "register_id") REFERENCES "registers"("tenant_id", "branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_tenant_id_return_id_fkey" FOREIGN KEY ("tenant_id", "return_id") REFERENCES "sale_returns"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_tenant_id_sale_line_id_fkey" FOREIGN KEY ("tenant_id", "sale_line_id") REFERENCES "sale_lines"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_refunds" ADD CONSTRAINT "sale_return_refunds_tenant_id_return_id_fkey" FOREIGN KEY ("tenant_id", "return_id") REFERENCES "sale_returns"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenant_id_shift_id_fkey" FOREIGN KEY ("tenant_id", "shift_id") REFERENCES "shifts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: integrity checks, RLS, append-only grants
-- ---------------------------------------------------------------------------

ALTER TABLE "tenant_settings"
  ADD CONSTRAINT "tenant_settings_discount_approval_range"
  CHECK ("discount_approval_bp" IS NULL OR "discount_approval_bp" BETWEEN 0 AND 10000);
ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_pin_failures_non_negative" CHECK ("approval_pin_failures" >= 0);

ALTER TABLE "sale_returns"
  ADD CONSTRAINT "sale_returns_amounts_non_negative" CHECK ("refund_minor" >= 0 AND "tax_minor" >= 0);
ALTER TABLE "sale_return_lines"
  ADD CONSTRAINT "sale_return_lines_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "sale_return_lines_amounts_non_negative" CHECK ("refund_minor" >= 0 AND "tax_minor" >= 0);
ALTER TABLE "sale_return_refunds"
  ADD CONSTRAINT "sale_return_refunds_amount_positive" CHECK ("amount_minor" > 0);
ALTER TABLE "cash_movements"
  ADD CONSTRAINT "cash_movements_amount_positive" CHECK ("amount_minor" > 0);

-- A sale can be voided at most once.
CREATE UNIQUE INDEX "sale_returns_one_void_key" ON "sale_returns" ("tenant_id", "sale_id") WHERE "kind" = 'VOID';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sale_returns', 'sale_return_lines', 'sale_return_refunds', 'cash_movements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_rls_bypass() OR tenant_id = app_current_tenant_id()) '
      'WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant_id())', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
      EXECUTE format('GRANT SELECT, INSERT ON %I TO pos_app', t);
    END IF;
  END LOOP;
END
$$;
