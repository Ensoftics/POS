
-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totp_last_step" INTEGER,
ADD COLUMN     "totp_secret_enc" VARCHAR(255);

-- CreateTable
CREATE TABLE "platform_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "tenant_id" UUID,
    "entity_type" VARCHAR(60),
    "entity_id" VARCHAR(64),
    "metadata" JSONB,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(255),
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_sessions_user_id_idx" ON "platform_sessions"("user_id");

-- CreateIndex
CREATE INDEX "platform_audit_logs_created_at_id_idx" ON "platform_audit_logs"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "platform_audit_logs_tenant_id_created_at_idx" ON "platform_audit_logs"("tenant_id", "created_at" DESC);


-- AddForeignKey
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: grants. Platform tables hold no tenant data, so no RLS; the
-- API only reaches them behind the platform guard.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    -- Platform staff create and edit plans; plans are never deleted (subscriptions refer to them).
    GRANT SELECT, INSERT, UPDATE ON "plans" TO pos_app;
    REVOKE DELETE, TRUNCATE ON "plans" FROM pos_app;
    GRANT SELECT, INSERT, UPDATE ON "platform_sessions" TO pos_app;
    REVOKE DELETE, TRUNCATE ON "platform_sessions" FROM pos_app;
    GRANT SELECT, INSERT ON "platform_audit_logs" TO pos_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "platform_audit_logs" FROM pos_app;
  END IF;
END
$$;
