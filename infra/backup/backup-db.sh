#!/bin/sh
# Dumps the database (custom format, compressed) with a checksum and a manifest of
# row counts per table. Runs in the postgres:17.6-alpine image.
#   SOURCE_URL  owner connection string (postgresql://pos_owner:...@host:5432/pos)
#   OUT_DIR     where to write (default /backups)
set -eu
OUT_DIR=${OUT_DIR:-/backups}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BASE="$OUT_DIR/pos-$STAMP"
mkdir -p "$OUT_DIR"

started=$(date +%s)
# Row counts first, in one consistent snapshot (compare with a restore; on a busy
# database the dump, taken moments later, may contain a few more rows).
psql "$SOURCE_URL" -v ON_ERROR_STOP=1 -At <<'SQL' > "$BASE.counts"
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT set_config('app.rls_bypass', 'on', true) \g /dev/null
SELECT format('SELECT %L || ''|'' || count(*) FROM %I.%I;', tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename \gexec
COMMIT;
SQL
pg_dump "$SOURCE_URL" --format=custom --compress=6 --no-password --file="$BASE.dump"
(cd "$OUT_DIR" && sha256sum "pos-$STAMP.dump" > "pos-$STAMP.dump.sha256")
finished=$(date +%s)
size=$(du -h "$BASE.dump" | cut -f1)
echo "backup pos-$STAMP.dump ($size, $((finished - started)) s, $(wc -l < "$BASE.counts") tables)"
