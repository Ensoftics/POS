#!/bin/sh
# Writes infra/deploy/.env for one server with its own database, with strong random
# secrets. Run once; afterwards edit .env for e-mail and image storage.
#   sh make-env.sh pos-demo.duckdns.org you@example.com
set -eu
cd "$(dirname "$0")"
DOMAIN=${1:?usage: make-env.sh <domain> <email for certificates>}
EMAIL=${2:?usage: make-env.sh <domain> <email for certificates>}
[ -e .env ] && { echo ".env already exists; not overwriting it." >&2; exit 1; }
rand() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
SUPER=$(rand 32); OWNER=$(rand 32); APP=$(rand 32); JWT=$(rand 64)
umask 077
cat > .env <<ENV
# Generated $(date -u +%F). Keep this file private (chmod 600); back it up in your password manager.
COMPOSE_PATH_SEPARATOR=:
COMPOSE_FILE=docker-compose.yml:docker-compose.single-server.yml
COMPOSE_PROFILES=tls
RELEASE=latest
IMAGE_PREFIX=ensoftic-pos

APP_DOMAIN=${DOMAIN}
ACME_EMAIL=${EMAIL}

POSTGRES_SUPER_PASSWORD=${SUPER}
POS_OWNER_PASSWORD=${OWNER}
POS_APP_PASSWORD=${APP}
DATABASE_URL=postgresql://pos_app:${APP}@postgres:5432/pos?schema=public&connection_limit=20
MIGRATION_DATABASE_URL=postgresql://pos_owner:${OWNER}@postgres:5432/pos?schema=public

JWT_ACCESS_SECRET=${JWT}
CORS_ORIGINS=https://${DOMAIN}
WEB_APP_URL=https://${DOMAIN}
API_PUBLIC_URL=https://${DOMAIN}
LOG_FORMAT=json

# E-mail (password resets, invitations, customer e-mails). Brevo free plan:
# smtp://<login>:<SMTP key>@smtp-relay.brevo.com:587  (sender must be verified in Brevo)
SMTP_URL=smtp://CHANGE_ME:CHANGE_ME@smtp-relay.brevo.com:587
MAIL_FROM="Ensoftic POS <CHANGE_ME@example.com>"

# Product photos (optional; photos stay switched off until set). Oracle Object Storage:
# S3_ENDPOINT=https://<namespace>.compat.objectstorage.<region>.oraclecloud.com
# S3_REGION=<region, e.g. ap-mumbai-1>
# S3_BUCKET=ensoftic-pos-images
# S3_ACCESS_KEY_ID=<Customer Secret Key access key>
# S3_SECRET_ACCESS_KEY=<Customer Secret Key secret>
# S3_FORCE_PATH_STYLE=true
# IMAGE_ORIGIN=https://<namespace>.compat.objectstorage.<region>.oraclecloud.com
IMAGE_ORIGIN=

# Online payments and SMS stay off until set.
# PAYHERE_MERCHANT_ID=
# PAYHERE_MERCHANT_SECRET=
# PAYHERE_MODE=sandbox
# NOTIFYLK_USER_ID=
# NOTIFYLK_API_KEY=
# NOTIFYLK_SENDER_ID=
ENV
echo "Wrote $(pwd)/.env for https://${DOMAIN}. Next: fill in SMTP_URL and MAIL_FROM."
