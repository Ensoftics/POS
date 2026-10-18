-- CreateEnum
CREATE TYPE "CustomerEntryType" AS ENUM ('CHARGE', 'PAYMENT', 'REFUND');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'ACCOUNT';

-- AlterEnum
ALTER TYPE "SaleConflictType" ADD VALUE 'CREDIT_LIMIT_EXCEEDED';

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "customer_id" UUID;

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(20),
    "email" VARCHAR(254),
    "address" VARCHAR(300),
    "notes" VARCHAR(1000),
    "marketing_consent_at" TIMESTAMPTZ(3),
    "credit_limit_minor" BIGINT NOT NULL DEFAULT 0,
    "balance_minor" BIGINT NOT NULL DEFAULT 0,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_ledger_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "type" "CustomerEntryType" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "balance_after" BIGINT NOT NULL,
    "reference_type" VARCHAR(30) NOT NULL,
    "reference_id" UUID NOT NULL,
    "reference_number" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "customer_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "reference" VARCHAR(40),
    "shift_id" UUID,
    "created_by_id" UUID,
    "request_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_tenant_id_status_name_idx" ON "customers"("tenant_id", "status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_id_key" ON "customers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_number_key" ON "customers"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_phone_key" ON "customers"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "customer_ledger_entries_tenant_id_customer_id_created_at_id_idx" ON "customer_ledger_entries"("tenant_id", "customer_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "customer_payments_tenant_id_customer_id_created_at_idx" ON "customer_payments"("tenant_id", "customer_id", "created_at");

-- CreateIndex
CREATE INDEX "customer_payments_tenant_id_shift_id_idx" ON "customer_payments"("tenant_id", "shift_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_payments_tenant_id_id_key" ON "customer_payments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_payments_tenant_id_number_key" ON "customer_payments"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "sales_tenant_id_customer_id_created_at_idx" ON "sales"("tenant_id", "customer_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_tenant_id_shift_id_fkey" FOREIGN KEY ("tenant_id", "shift_id") REFERENCES "shifts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: integrity checks, RLS, insert-only account history
-- ---------------------------------------------------------------------------

CREATE INDEX "customers_tenant_name_lower_idx" ON "customers" ("tenant_id", lower("name"));
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_credit_limit_non_negative" CHECK ("credit_limit_minor" >= 0);
ALTER TABLE "customer_ledger_entries"
  ADD CONSTRAINT "customer_ledger_entries_amount_non_zero" CHECK ("amount_minor" <> 0);
ALTER TABLE "customer_payments"
  ADD CONSTRAINT "customer_payments_amount_positive" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "customer_payments_not_on_account" CHECK ("method"::text <> 'ACCOUNT');

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'customer_ledger_entries', 'customer_payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_rls_bypass() OR tenant_id = app_current_tenant_id()) '
      'WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant_id())', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "customers" TO pos_app;
    REVOKE DELETE, TRUNCATE ON "customers" FROM pos_app;
    -- Account history and collections are financial records: add-only.
    GRANT SELECT, INSERT ON "customer_ledger_entries", "customer_payments" TO pos_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "customer_ledger_entries", "customer_payments" FROM pos_app;
  END IF;
END
$$;
