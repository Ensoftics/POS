-- CreateEnum
CREATE TYPE "LoyaltyEntryType" AS ENUM ('EARN', 'REDEEM', 'REVERSE', 'REFUND', 'ADJUST');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'LOYALTY';


-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "loyalty_points" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "points_earned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "points_redeemed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "points_redeemed_minor" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN     "loyalty_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "loyalty_min_redeem_points" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loyalty_point_value_minor" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "loyalty_spend_per_point_minor" INTEGER NOT NULL DEFAULT 10000;

-- CreateTable
CREATE TABLE "loyalty_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "type" "LoyaltyEntryType" NOT NULL,
    "points" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "sale_id" UUID,
    "reference_type" VARCHAR(30) NOT NULL,
    "reference_id" UUID NOT NULL,
    "reference_number" VARCHAR(20),
    "note" VARCHAR(300),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loyalty_entries_tenant_id_customer_id_created_at_id_idx" ON "loyalty_entries"("tenant_id", "customer_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "loyalty_entries_tenant_id_sale_id_idx" ON "loyalty_entries"("tenant_id", "sale_id");


-- AddForeignKey
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: checks, RLS and grants
-- ---------------------------------------------------------------------------

ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_loyalty_check" CHECK (
  "loyalty_spend_per_point_minor" > 0 AND "loyalty_point_value_minor" > 0
  AND "loyalty_min_redeem_points" >= 0);
ALTER TABLE "sales" ADD CONSTRAINT "sales_points_check" CHECK (
  "points_earned" >= 0 AND "points_redeemed" >= 0 AND "points_redeemed_minor" >= 0);
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_points_check" CHECK ("points" <> 0);
-- Points cannot pay off an account (the new enum value is compared as text: it is not
-- usable as a value within this migration's transaction).
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_not_loyalty_check"
  CHECK ("method"::text <> 'LOYALTY');

-- Loyalty can be switched off per business by platform staff.
INSERT INTO "feature_flags" ("key", "description", "default_enabled", "updated_at") VALUES
  ('loyalty', 'Loyalty points (owners still switch the programme on in Settings)', true, now());

ALTER TABLE "loyalty_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "loyalty_entries"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant_id())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    -- The points history is append-only.
    GRANT SELECT, INSERT ON "loyalty_entries" TO pos_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "loyalty_entries" FROM pos_app;
  END IF;
END
$$;
