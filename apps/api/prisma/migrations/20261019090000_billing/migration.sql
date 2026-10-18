-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "BillingInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');


-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "price_monthly_minor" INTEGER NOT NULL,
    "price_yearly_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'LKR',
    "max_branches" INTEGER NOT NULL,
    "max_registers" INTEGER NOT NULL,
    "max_staff" INTEGER NOT NULL,
    "max_devices" INTEGER NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "interval" "BillingInterval" NOT NULL DEFAULT 'MONTH',
    "trial_ends_at" TIMESTAMPTZ(3),
    "current_period_start" TIMESTAMPTZ(3),
    "current_period_end" TIMESTAMPTZ(3),
    "grace_ends_at" TIMESTAMPTZ(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "reminded_for" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "billing_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "plan_id" UUID NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "status" "BillingInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "subtotal_minor" INTEGER NOT NULL,
    "tax_rate_bp" INTEGER NOT NULL,
    "tax_minor" INTEGER NOT NULL,
    "total_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "period_start" TIMESTAMPTZ(3),
    "period_end" TIMESTAMPTZ(3),
    "provider" VARCHAR(20) NOT NULL,
    "provider_payment_id" VARCHAR(64),
    "paid_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "provider_event_id" VARCHAR(100) NOT NULL,
    "outcome" VARCHAR(20) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" VARCHAR(20),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "billing_invoices_tenant_id_created_at_idx" ON "billing_invoices"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "billing_invoices_tenant_id_number_key" ON "billing_invoices"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "payment_events_tenant_id_created_at_idx" ON "payment_events"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_provider_event_id_key" ON "payment_events"("provider", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_created_at_idx" ON "email_verification_tokens"("user_id", "created_at");


-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "billing_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: checks, plans, backfill, RLS and grants
-- ---------------------------------------------------------------------------

ALTER TABLE "plans" ADD CONSTRAINT "plans_amounts_check" CHECK (
  "price_monthly_minor" >= 0 AND "price_yearly_minor" >= 0 AND "max_branches" >= 1
  AND "max_registers" >= 1 AND "max_staff" >= 1 AND "max_devices" >= 0);
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_amounts_check" CHECK (
  "subtotal_minor" >= 0 AND "tax_minor" >= 0 AND "tax_rate_bp" >= 0
  AND "total_minor" = "subtotal_minor" + "tax_minor");
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_paid_check" CHECK (
  ("status" = 'PAID') = ("paid_at" IS NOT NULL));
-- At most one unpaid invoice per business: a new checkout replaces (voids) the old one.
CREATE UNIQUE INDEX "billing_invoices_one_open_key" ON "billing_invoices" ("tenant_id")
  WHERE "status" = 'OPEN';

-- Launch plans (prices tax-exclusive, LKR). Platform admins manage plans from Slice 12.
INSERT INTO "plans" ("id", "code", "name", "price_monthly_minor", "price_yearly_minor",
  "max_branches", "max_registers", "max_staff", "max_devices", "sort_order", "updated_at")
VALUES
  (gen_random_uuid(), 'STARTER',  'Starter',    250000,  2500000,  1,  2,  5,  2, 1, now()),
  (gen_random_uuid(), 'GROWTH',   'Growth',     650000,  6500000,  3,  8, 20, 10, 2, now()),
  (gen_random_uuid(), 'BUSINESS', 'Business',  1500000, 15000000, 10, 40, 80, 50, 3, now());

-- Existing businesses start a 14-day trial on Growth.
SELECT set_config('app.rls_bypass', 'on', true);
INSERT INTO "subscriptions" ("tenant_id", "plan_id", "status", "trial_ends_at", "updated_at")
SELECT t."id", p."id", 'TRIALING', now() + interval '14 days', now()
FROM "tenants" t CROSS JOIN "plans" p
WHERE p."code" = 'GROWTH';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscriptions', 'billing_invoices', 'payment_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_rls_bypass() OR tenant_id = app_current_tenant_id()) '
      'WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant_id())', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    -- Plans are read-only to the application.
    GRANT SELECT ON "plans" TO pos_app;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "plans" FROM pos_app;
    GRANT SELECT, INSERT, UPDATE ON "subscriptions", "billing_invoices" TO pos_app;
    REVOKE DELETE, TRUNCATE ON "subscriptions", "billing_invoices" FROM pos_app;
    -- Provider events are an append-only record.
    GRANT SELECT, INSERT ON "payment_events" TO pos_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "payment_events" FROM pos_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "email_verification_tokens" TO pos_app;
  END IF;
END
$$;
