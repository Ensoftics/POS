#!/bin/sh
# Nightly backup: dump the database, then copy dumps and images off-site (encrypted),
# and keep only the last 3 dumps on this server. Schedule it with cron or a systemd timer:
#   15 1 * * *  cd /srv/ensoftic-pos/infra/backup && ./nightly.sh >> /var/log/pos-backup.log 2>&1
set -eu
cd "$(dirname "$0")"
docker compose run --rm db
docker compose run --rm offsite backup
docker compose run --rm --entrypoint sh db -c 'ls -1t /backups/pos-*.dump | tail -n +4 | while read f; do rm -f "$f" "$f.sha256" "${f%.dump}.counts"; done'
echo "nightly backup finished $(date -u +%FT%TZ)"
