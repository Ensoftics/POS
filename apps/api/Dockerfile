# syntax=docker/dockerfile:1.7
# API image. Build from the repository root:
#   docker build -f apps/api/Dockerfile --target api -t ensoftic-pos-api .
#   docker build -f apps/api/Dockerfile --target migrate -t ensoftic-pos-migrate .
ARG NODE_VERSION=22.23.3

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV CI=1 PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate \
  && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY . .
# Only the API and the packages it uses (not the web or Android apps).
RUN pnpm install --frozen-lockfile --filter "@pos/api..."
RUN pnpm --filter "@pos/api..." build
# A self-contained production tree; the Prisma client is generated for this platform.
RUN pnpm --filter @pos/api deploy --prod --ignore-scripts /out \
  && cd /out && /repo/apps/api/node_modules/.bin/prisma generate --schema prisma/schema.prisma

# Applies migrations as the schema owner (MIGRATION_DATABASE_URL), once per release.
# Only the Prisma CLI (same version as the API) and the migration files.
FROM node:${NODE_VERSION}-bookworm-slim AS migrate
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates   && rm -rf /var/lib/apt/lists/*
WORKDIR /migrate
RUN npm install --no-save --no-audit --no-fund prisma@6.19.3 && chown -R node:node /migrate
COPY --chown=node:node apps/api/prisma ./prisma
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"]

FROM node:${NODE_VERSION}-bookworm-slim AS api
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
