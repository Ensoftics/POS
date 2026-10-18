-- CreateEnum
CREATE TYPE "Language" AS ENUM ('en', 'si', 'ta');

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "tenant_settings" (
    "tenant_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "legal_name" VARCHAR(160),
    "tax_registration_number" VARCHAR(40),
    "address_line1" VARCHAR(160),
    "address_line2" VARCHAR(160),
    "city" VARCHAR(80),
    "postal_code" VARCHAR(16),
    "country" CHAR(2) NOT NULL DEFAULT 'LK',
    "currency" CHAR(3) NOT NULL DEFAULT 'LKR',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Colombo',
    "default_language" "Language" NOT NULL DEFAULT 'en',
    "enabled_languages" "Language"[] DEFAULT ARRAY['en', 'si', 'ta']::"Language"[],
    "track_batch_numbers" BOOLEAN NOT NULL DEFAULT false,
    "track_expiry_dates" BOOLEAN NOT NULL DEFAULT false,
    "allow_fractional_quantities" BOOLEAN NOT NULL DEFAULT false,
    "variant_attributes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "default_units" TEXT[] DEFAULT ARRAY['piece']::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "address_line1" VARCHAR(160),
    "city" VARCHAR(80),
    "phone" VARCHAR(32),
    "status" "LocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "status" "LocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "registers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branches_tenant_id_status_idx" ON "branches"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_code_key" ON "branches"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_id_key" ON "branches"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "registers_tenant_id_branch_id_idx" ON "registers"("tenant_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "registers_tenant_id_branch_id_code_key" ON "registers"("tenant_id", "branch_id", "code");

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registers" ADD CONSTRAINT "registers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registers" ADD CONSTRAINT "registers_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: integrity checks, row-level security and backfill
-- ---------------------------------------------------------------------------
ALTER TABLE "tenant_settings"
  ADD CONSTRAINT "tenant_settings_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "tenant_settings_country_check" CHECK ("country" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "tenant_settings_version_check" CHECK ("version" >= 1);
ALTER TABLE "branches"
  ADD CONSTRAINT "branches_code_check" CHECK ("code" ~ '^[A-Z0-9]([A-Z0-9-]{0,10}[A-Z0-9])?$'),
  ADD CONSTRAINT "branches_version_check" CHECK ("version" >= 1);
ALTER TABLE "registers"
  ADD CONSTRAINT "registers_code_check" CHECK ("code" ~ '^[A-Z0-9]([A-Z0-9-]{0,10}[A-Z0-9])?$'),
  ADD CONSTRAINT "registers_version_check" CHECK ("version" >= 1);

ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_settings"
  USING (app_rls_bypass() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypass() OR "tenant_id" = app_current_tenant_id());

ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "branches"
  USING (app_rls_bypass() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypass() OR "tenant_id" = app_current_tenant_id());

ALTER TABLE "registers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "registers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "registers"
  USING (app_rls_bypass() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypass() OR "tenant_id" = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_settings", "branches", "registers" TO pos_app;
  END IF;
END
$$;

-- Backfill settings for tenants created before this migration, using the
-- industry preset (mirrors BUSINESS_PROFILE_PRESETS in @pos/domain).
INSERT INTO "tenant_settings" (
  "tenant_id", "updated_at", "track_batch_numbers", "track_expiry_dates",
  "allow_fractional_quantities", "variant_attributes", "default_units"
)
SELECT t."id", CURRENT_TIMESTAMP,
  COALESCE(t."business_type" = 'COSMETICS', false),
  COALESCE(t."business_type" = 'COSMETICS', false),
  COALESCE(t."business_type" IN ('TEXTILE', 'GENERAL_RETAIL'), false),
  CASE t."business_type"
    WHEN 'COSMETICS' THEN ARRAY['brand', 'shade', 'size']
    WHEN 'TEXTILE' THEN ARRAY['colour', 'size', 'design', 'material']
    WHEN 'GENERAL_RETAIL' THEN ARRAY['brand', 'size', 'flavour']
    ELSE ARRAY[]::TEXT[] END,
  CASE t."business_type"
    WHEN 'COSMETICS' THEN ARRAY['piece', 'pack', 'millilitre', 'gram']
    WHEN 'TEXTILE' THEN ARRAY['piece', 'metre', 'pack']
    WHEN 'GENERAL_RETAIL' THEN ARRAY['piece', 'pack', 'kilogram', 'litre', 'dozen']
    ELSE ARRAY['piece'] END
FROM "tenants" t
ON CONFLICT ("tenant_id") DO NOTHING;

-- Onboarded tenants get the same default location new tenants receive.
INSERT INTO "branches" ("id", "tenant_id", "code", "name", "updated_at")
SELECT gen_random_uuid(), t."id", 'MAIN', 'Main branch', CURRENT_TIMESTAMP
FROM "tenants" t
WHERE t."onboarding_status" = 'COMPLETED'
  AND NOT EXISTS (SELECT 1 FROM "branches" b WHERE b."tenant_id" = t."id");

INSERT INTO "registers" ("id", "tenant_id", "branch_id", "code", "name", "updated_at")
SELECT gen_random_uuid(), b."tenant_id", b."id", 'R1', 'Register 1', CURRENT_TIMESTAMP
FROM "branches" b
WHERE b."code" = 'MAIN'
  AND NOT EXISTS (SELECT 1 FROM "registers" r WHERE r."branch_id" = b."id");
