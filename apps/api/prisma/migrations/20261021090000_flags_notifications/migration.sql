
-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "email_digest" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" VARCHAR(64) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "default_enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "tenant_feature_flags" (
    "tenant_id" UUID NOT NULL,
    "flag_key" VARCHAR(64) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_feature_flags_pkey" PRIMARY KEY ("tenant_id","flag_key")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "dedupe_key" VARCHAR(160) NOT NULL,
    "data" JSONB NOT NULL,
    "link" VARCHAR(200),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_runs" (
    "tenant_id" UUID NOT NULL,
    "run_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_runs_pkey" PRIMARY KEY ("tenant_id","run_date")
);

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_created_at_idx" ON "notifications"("tenant_id", "user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenant_id_user_id_dedupe_key_key" ON "notifications"("tenant_id", "user_id", "dedupe_key");


-- AddForeignKey
ALTER TABLE "tenant_feature_flags" ADD CONSTRAINT "tenant_feature_flags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_feature_flags" ADD CONSTRAINT "tenant_feature_flags_flag_key_fkey" FOREIGN KEY ("flag_key") REFERENCES "feature_flags"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_runs" ADD CONSTRAINT "daily_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: flags, RLS and grants
-- ---------------------------------------------------------------------------

-- The keys must match FEATURE_FLAGS in @pos/domain.
INSERT INTO "feature_flags" ("key", "description", "default_enabled", "updated_at") VALUES
  ('notifications.daily_summary', 'In-app and e-mailed summary of yesterday''s sales for owners and managers', true, now()),
  ('notifications.email', 'Morning digest e-mails (people can still opt out individually)', true, now());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_feature_flags', 'notifications', 'daily_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_rls_bypass() OR tenant_id = app_current_tenant_id()) '
      'WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant_id())', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    -- Flags are platform data: staff change defaults, never add or remove keys at runtime.
    GRANT SELECT, UPDATE ON "feature_flags" TO pos_app;
    REVOKE INSERT, DELETE, TRUNCATE ON "feature_flags" FROM pos_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_feature_flags" TO pos_app;
    -- Old notifications are purged by the sweep.
    GRANT SELECT, INSERT, UPDATE, DELETE ON "notifications" TO pos_app;
    GRANT SELECT, INSERT ON "daily_runs" TO pos_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "daily_runs" FROM pos_app;
  END IF;
END
$$;
