-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('STAFF', 'UNSUBSCRIBE_LINK');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('SENDING', 'DONE');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "unsubscribe_code" VARCHAR(16);
-- Existing customers get a random opt-out code; new ones get one from the API.
SELECT set_config('app.rls_bypass', 'on', true);
UPDATE "customers"
  SET "unsubscribe_code" = substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
  WHERE "unsubscribe_code" IS NULL;
ALTER TABLE "customers" ALTER COLUMN "unsubscribe_code" SET NOT NULL;

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "sms_per_month" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "consent_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" "ConsentSource" NOT NULL,
    "note" VARCHAR(300),
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_campaigns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "subject" VARCHAR(120),
    "body" VARCHAR(2000) NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'SENDING',
    "recipients" INTEGER NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "message_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_deliveries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "message_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_events_tenant_id_customer_id_created_at_idx" ON "consent_events"("tenant_id", "customer_id", "created_at");

-- CreateIndex
CREATE INDEX "message_campaigns_tenant_id_created_at_idx" ON "message_campaigns"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_campaigns_tenant_id_id_key" ON "message_campaigns"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "message_deliveries_status_created_at_idx" ON "message_deliveries"("status", "created_at");

-- CreateIndex
CREATE INDEX "message_deliveries_tenant_id_channel_created_at_idx" ON "message_deliveries"("tenant_id", "channel", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_deliveries_campaign_id_customer_id_key" ON "message_deliveries"("campaign_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_unsubscribe_code_key" ON "customers"("unsubscribe_code");

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_campaigns" ADD CONSTRAINT "message_campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id", "campaign_id") REFERENCES "message_campaigns"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "message_campaigns"
  ADD CONSTRAINT "message_campaigns_recipients_check" CHECK ("recipients" >= 0),
  ADD CONSTRAINT "message_campaigns_subject_check" CHECK ("channel" = 'SMS' OR "subject" IS NOT NULL);
ALTER TABLE "message_deliveries"
  ADD CONSTRAINT "message_deliveries_attempts_check" CHECK ("attempts" >= 0);
ALTER TABLE "plans"
  ADD CONSTRAINT "plans_sms_per_month_check" CHECK ("sms_per_month" >= 0);

-- Monthly marketing SMS included in each plan.
UPDATE "plans" SET "sms_per_month" = CASE "code"
  WHEN 'STARTER' THEN 200 WHEN 'GROWTH' THEN 1000 WHEN 'BUSINESS' THEN 5000 ELSE 0 END;

-- Consents given before the history existed keep their date.
INSERT INTO "consent_events" ("id", "tenant_id", "customer_id", "granted", "source", "note", "created_at")
  SELECT gen_random_uuid(), "tenant_id", "id", true, 'STAFF', 'Recorded before consent history', "marketing_consent_at"
  FROM "customers" WHERE "marketing_consent_at" IS NOT NULL;

INSERT INTO "feature_flags" ("key", "description", "default_enabled", "updated_at") VALUES
  ('messaging', 'Customer messages by e-mail and SMS to customers who agreed', true, now());

ALTER TABLE "consent_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "consent_events"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant_id())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant_id());

ALTER TABLE "message_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_campaigns" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "message_campaigns"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant_id())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant_id());

ALTER TABLE "message_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "message_deliveries"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant_id())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    -- Consent history is append-only evidence.
    GRANT SELECT, INSERT ON "consent_events" TO pos_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "consent_events" FROM pos_app;
    GRANT SELECT, INSERT, UPDATE ON "message_campaigns", "message_deliveries" TO pos_app;
    REVOKE DELETE, TRUNCATE ON "message_campaigns", "message_deliveries" FROM pos_app;
  END IF;
END
$$;
