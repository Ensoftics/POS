-- Slice 14a security review: the platform staff audit trail names businesses
-- (tenant_id) but belongs to the platform. Only system-context transactions
-- (the platform console and operator scripts) may read or write it, so a bug in
-- tenant-scoped code can never expose or forge it.
ALTER TABLE "platform_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY system_only ON "platform_audit_logs"
  USING (app_rls_bypass())
  WITH CHECK (app_rls_bypass());
