# syntax=docker/dockerfile:1.7
# Web app: static files served by unprivileged nginx, /api proxied to the API so the
# browser talks to one origin. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t ensoftic-pos-web .
ARG NODE_VERSION=22.23.3

FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV CI=1 PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@pos/web..."
ENV VITE_API_BASE_URL=/api/v1
RUN pnpm --filter "@pos/web..." build

FROM nginxinc/nginx-unprivileged:1.29.1-alpine AS web
# Settings read at start-up (see nginx/default.conf.template).
ENV API_UPSTREAM=api:4000 \
    IMAGE_ORIGIN="" \
    NGINX_ENVSUBST_FILTER="^(API_UPSTREAM|IMAGE_ORIGIN)$"
COPY apps/web/nginx/*.template /etc/nginx/templates/
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
