#!/bin/sh
# Copies database dumps and product images to the backup bucket, encrypted on this
# machine first (rclone crypt): the backup provider never sees plain data.
# Runs in the rclone/rclone:1.71.1 image.
#   mode: backup (default) | restore-images | verify-images
# Settings (environment):
#   BACKUP_S3_ENDPOINT, BACKUP_S3_REGION, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY,
#   BACKUP_BUCKET          where backups go (a different account or provider from production)
#   BACKUP_PASSPHRASE      encryption passphrase (keep it outside both clouds; without it
#                          the backups cannot be read)
#   S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET  the image bucket
#   RETENTION              how long dumps and deleted images are kept (default 35d)
set -eu
MODE=${1:-backup}
RETENTION=${RETENTION:-35d}

export RCLONE_CONFIG_STORE_TYPE=s3 RCLONE_CONFIG_STORE_PROVIDER=Other \
  RCLONE_CONFIG_STORE_ENDPOINT="${BACKUP_S3_ENDPOINT:-}" RCLONE_CONFIG_STORE_REGION="${BACKUP_S3_REGION:-us-east-1}" \
  RCLONE_CONFIG_STORE_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" RCLONE_CONFIG_STORE_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_SAFE_TYPE=crypt RCLONE_CONFIG_SAFE_REMOTE="store:$BACKUP_BUCKET" \
  RCLONE_CONFIG_SAFE_PASSWORD="$(rclone obscure "$BACKUP_PASSPHRASE")"
export RCLONE_CONFIG_IMAGES_TYPE=s3 RCLONE_CONFIG_IMAGES_PROVIDER=Other \
  RCLONE_CONFIG_IMAGES_ENDPOINT="${S3_ENDPOINT:-}" RCLONE_CONFIG_IMAGES_REGION="${S3_REGION:-us-east-1}" \
  RCLONE_CONFIG_IMAGES_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" RCLONE_CONFIG_IMAGES_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"

case "$MODE" in
  backup)
    rclone copy /backups safe:db --include 'pos-*' --immutable
    # Images: a mirror; files deleted or replaced since go to a dated folder, kept for RETENTION.
    rclone sync "images:$S3_BUCKET" safe:images --backup-dir "safe:images-removed/$(date -u +%Y%m%d)"
    rclone delete safe:db --min-age "$RETENTION"
    rclone delete safe:images-removed --min-age "$RETENTION" --rmdirs
    echo "offsite backup done: $(rclone size safe:db --json) db, $(rclone size safe:images --json) images"
    ;;
  verify-images)
    # Decrypts and compares every image against production (contents, not just names).
    rclone cryptcheck "images:$S3_BUCKET" safe:images
    echo "images verified"
    ;;
  restore-images)
    # Into an empty bucket named by RESTORE_BUCKET (never over the live one by mistake).
    : "${RESTORE_BUCKET:?set RESTORE_BUCKET}"
    rclone copy safe:images "images:$RESTORE_BUCKET"
    rclone cryptcheck "images:$RESTORE_BUCKET" safe:images
    echo "images restored to $RESTORE_BUCKET and verified"
    ;;
  fetch-db)
    # Downloads and decrypts the dumps for a restore drill.
    rclone copy safe:db /backups --include 'pos-*'
    ;;
  *) echo "unknown mode $MODE" >&2; exit 2 ;;
esac
