-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(60) NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "brand" VARCHAR(60),
    "description" VARCHAR(1000),
    "unit" VARCHAR(16) NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" VARCHAR(40) NOT NULL,
    "barcode" VARCHAR(48),
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "attributes_key" VARCHAR(400) NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "cost_minor" BIGINT,
    "pack_size" INTEGER,
    "reorder_level" DECIMAL(12,3),
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_tenant_id_status_idx" ON "categories"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "categories_tenant_id_id_key" ON "categories"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "products_tenant_id_status_name_id_idx" ON "products"("tenant_id", "status", "name", "id");

-- CreateIndex
CREATE INDEX "products_tenant_id_category_id_idx" ON "products"("tenant_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_id_key" ON "products"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "product_variants_tenant_id_product_id_idx" ON "product_variants"("tenant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_tenant_id_sku_key" ON "product_variants"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_tenant_id_barcode_key" ON "product_variants"("tenant_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_attributes_key_key" ON "product_variants"("product_id", "attributes_key");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_parent_id_fkey" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "categories"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "categories"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: search indexes, integrity checks and row-level security
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Category names are unique per tenant and parent, ignoring case; NULLS NOT DISTINCT
-- (PostgreSQL 15+) makes top-level names unique too.
CREATE UNIQUE INDEX "categories_tenant_parent_name_key"
  ON "categories" ("tenant_id", "parent_id", lower("name")) NULLS NOT DISTINCT;

-- Product search: substring match on names, prefix match on SKUs.
CREATE INDEX "products_name_trgm_idx" ON "products" USING gin ("name" gin_trgm_ops);
CREATE INDEX "product_variants_sku_prefix_idx" ON "product_variants" ("tenant_id", "sku" varchar_pattern_ops);

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
  ADD CONSTRAINT "categories_version_check" CHECK ("version" >= 1);
ALTER TABLE "products"
  ADD CONSTRAINT "products_unit_check" CHECK ("unit" ~ '^[a-z]+$'),
  ADD CONSTRAINT "products_version_check" CHECK ("version" >= 1);
ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_sku_check" CHECK ("sku" ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$'),
  ADD CONSTRAINT "product_variants_price_check" CHECK ("price_minor" >= 0),
  ADD CONSTRAINT "product_variants_cost_check" CHECK ("cost_minor" IS NULL OR "cost_minor" >= 0),
  ADD CONSTRAINT "product_variants_pack_size_check" CHECK ("pack_size" IS NULL OR "pack_size" >= 1),
  ADD CONSTRAINT "product_variants_reorder_check" CHECK ("reorder_level" IS NULL OR "reorder_level" >= 0),
  ADD CONSTRAINT "product_variants_attributes_check" CHECK (jsonb_typeof("attributes") = 'object'),
  ADD CONSTRAINT "product_variants_version_check" CHECK ("version" >= 1);

ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "categories"
  USING (app_rls_bypass() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypass() OR "tenant_id" = app_current_tenant_id());

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "products"
  USING (app_rls_bypass() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypass() OR "tenant_id" = app_current_tenant_id());

ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_variants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "product_variants"
  USING (app_rls_bypass() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypass() OR "tenant_id" = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "categories", "products", "product_variants" TO pos_app;
  END IF;
END
$$;
