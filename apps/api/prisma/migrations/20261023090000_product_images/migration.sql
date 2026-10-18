-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_images_tenant_id_product_id_position_idx" ON "product_images"("tenant_id", "product_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "product_images_tenant_id_id_key" ON "product_images"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_images_tenant_id_product_id_sha256_key" ON "product_images"("tenant_id", "product_id", "sha256");

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "product_images"
  ADD CONSTRAINT "product_images_position_check" CHECK ("position" >= 0),
  ADD CONSTRAINT "product_images_size_check" CHECK ("width" > 0 AND "height" > 0 AND "bytes" > 0),
  ADD CONSTRAINT "product_images_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "product_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_images" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "product_images"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant_id())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "product_images" TO pos_app;
    REVOKE TRUNCATE ON "product_images" FROM pos_app;
  END IF;
END
$$;
