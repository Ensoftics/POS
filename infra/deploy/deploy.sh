#!/bin/sh
# Builds the images from this checkout and (re)starts the stack. Run on the server from
# the repository, after `git pull` for a new version:
#   sh infra/deploy/deploy.sh
set -eu
cd "$(dirname "$0")/../.."
RELEASE=$(git rev-parse --short HEAD)
echo "Building release ${RELEASE}..."
docker build -f apps/api/Dockerfile --target api -t "ensoftic-pos-api:${RELEASE}" .
docker build -f apps/api/Dockerfile --target migrate -t "ensoftic-pos-migrate:${RELEASE}" .
docker build -f apps/web/Dockerfile -t "ensoftic-pos-web:${RELEASE}" .
cd infra/deploy
sed -i "s/^RELEASE=.*/RELEASE=${RELEASE}/" .env
docker compose up -d --wait
docker compose ps
echo "Release ${RELEASE} is running at https://$(grep '^APP_DOMAIN=' .env | cut -d= -f2)"
