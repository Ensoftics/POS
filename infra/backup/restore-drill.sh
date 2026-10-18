#!/bin/sh
# Restore drill: restores a dump into a NEW database and proves it is usable.
# Runs in the postgres:17.6-alpine image. Never touches the live database.
#   ADMIN_URL   connection to the server as a role that may CREATE DATABASE (no db name needed in checks)
#   APP_URL     connection template for the app role, with DBNAME in place of the database name
#   BACKUP      path of the .dump (default: newest in /backups)
#   KEEP=1      keep the restored database afterwards (default: drop it)
set -eu
BACKUP=${BACKUP:-$(ls -1 /backups/pos-*.dump | sort | tail -1)}
NAME=$(basename "$BACKUP" .dump)
DB="drill_$(date -u +%Y%m%d%H%M%S)"
fail() { echo "DRILL FAILED: $*" >&2; exit 1; }

echo "drill: $NAME -> $DB"
(cd "$(dirname "$BACKUP")" && sha256sum -c "$NAME.dump.sha256" > /dev/null) || fail "checksum mismatch"
echo "  checksum ok"

started=$(date +%s)
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $DB OWNER pos_owner"
TARGET=$(printf '%s' "$ADMIN_URL" | sed -E "s#/[^/?]*(\?|$)#/$DB\1#")
pg_restore --dbname="$TARGET" --exit-on-error --no-password "$BACKUP" || fail "pg_restore failed"
restored=$(date +%s)
echo "  restored in $((restored - started)) s"

# Same tables and row counts as when the backup was taken.
psql "$TARGET" -v ON_ERROR_STOP=1 -At <<'SQL' > /tmp/restored.counts
BEGIN;
SELECT set_config('app.rls_bypass', 'on', true) \g /dev/null
SELECT format('SELECT %L || ''|'' || count(*) FROM %I.%I;', tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename \gexec
COMMIT;
SQL
if [ -f "/backups/$NAME.counts" ]; then
  diff "/backups/$NAME.counts" /tmp/restored.counts > /tmp/counts.diff || {
    cat /tmp/counts.diff; fail "row counts differ from the backup manifest"; }
  echo "  row counts match ($(wc -l < /tmp/restored.counts) tables)"
fi

# Every migration applied and finished.
# A migration may have an older failed attempt (rolled back) next to the run that succeeded.
pending=$(psql "$TARGET" -At -c "SELECT count(*) FROM (SELECT migration_name FROM _prisma_migrations GROUP BY 1 HAVING NOT bool_or(finished_at IS NOT NULL AND rolled_back_at IS NULL)) m")
[ "$pending" = "0" ] || fail "$pending migrations never finished"
echo "  migrations: $(psql "$TARGET" -At -c 'SELECT count(DISTINCT migration_name) FROM _prisma_migrations') applied"

# The application role still works, and row-level security still isolates businesses.
APP=$(printf '%s' "$APP_URL" | sed "s/DBNAME/$DB/")
tenant=$(psql "$TARGET" -At <<'SQL' | grep -E '^[0-9a-f-]{36}$' || true
BEGIN;
SELECT set_config('app.rls_bypass', 'on', true) \g /dev/null
SELECT tenant_id FROM sales GROUP BY 1 ORDER BY count(*) DESC LIMIT 1;
COMMIT;
SQL
)
if [ -n "$tenant" ]; then
  none=$(psql "$APP" -At -c "SELECT count(*) FROM sales")
  [ "$none" = "0" ] || fail "app role sees $none sales without a tenant (RLS broken)"
  own=$(psql "$APP" -At -v tenant="$tenant" <<'SQL' | grep -E '^[0-9]+$' | tail -1
BEGIN;
SELECT set_config('app.tenant_id', :'tenant', true) \g /dev/null
SELECT count(*) FROM sales;
COMMIT;
SQL
)
  [ "${own:-0}" -gt 0 ] || fail "app role cannot read its own tenant's sales"
  echo "  app role: 0 rows without a tenant, $own sales for the busiest tenant"
fi

finished=$(date +%s)
if [ "${KEEP:-0}" != "1" ]; then psql "$ADMIN_URL" -q -c "DROP DATABASE $DB"; fi
echo "DRILL PASSED: $NAME restored and verified in $((finished - started)) s"
