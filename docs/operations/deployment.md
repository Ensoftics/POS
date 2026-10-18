# Deployment

How Ensoftic POS runs in production and how a release goes out. The files are in
`infra/deploy`, `apps/api/Dockerfile` and `apps/web/Dockerfile`.

## Shape

```
browser / Android till
        │ HTTPS
   ┌────▼────┐   automatic certificates (Let's Encrypt), or a cloud load balancer instead
   │  Caddy  │
   └────┬────┘
   ┌────▼────┐   static app + security headers (CSP, HSTS, no framing), /api → API
   │   web   │   nginx, unprivileged, port 8080
   └────┬────┘
   ┌────▼────┐   NestJS, read-only filesystem, no Linux capabilities, TRUST_PROXY=2
   │   api   │   port 4000 (internal only)
   └──┬───┬──┘
      │   └──────────── S3-compatible bucket (product images, private)
      └──────────────── PostgreSQL 17 (managed; roles pos_owner + pos_app)
```

- **migrate** is a one-shot container. It runs `prisma migrate deploy` as `pos_owner` before
  the API starts on every release.
- **External services:** PostgreSQL and the image bucket are managed, for point-in-time
  recovery and durable storage. Backups are separate: see
  [backup-and-restore.md](backup-and-restore.md).
- **Optional integrations:** SMTP, PayHere and Notify.lk stay switched off until their
  settings are present.

## Images

| Image                  | Built from                              | Notes                                                                                                              |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ensoftic-pos-api`     | `apps/api/Dockerfile`, target `api`     | Node 22 on Debian slim; production dependencies only; runs as `node` under `tini`; health check on `/health/ready` |
| `ensoftic-pos-migrate` | `apps/api/Dockerfile`, target `migrate` | Prisma CLI and migrations. Large (about 2 GB, it reuses the build stage); a slimmer image is a follow-up           |
| `ensoftic-pos-web`     | `apps/web/Dockerfile`                   | nginx 1.29 (unprivileged) serving the built app; settings `API_UPSTREAM` and `IMAGE_ORIGIN`                        |

```sh
# From the repository root, tagged with the release:
docker build -f apps/api/Dockerfile --target api     -t ensoftic-pos-api:2026.10.0 .
docker build -f apps/api/Dockerfile --target migrate -t ensoftic-pos-migrate:2026.10.0 .
docker build -f apps/web/Dockerfile                  -t ensoftic-pos-web:2026.10.0 .
```

CI builds all three on every push and checks the web image's security headers. Pushing to a
registry needs a registry and credentials, which are not set up yet.

## First-time setup

1. **Database.** Create a PostgreSQL 17 instance with automated backups and point-in-time
   recovery switched on. As its administrator run `infra/deploy/db-init.sql`; it creates
   `pos_owner` (owns the schema, runs migrations) and `pos_app` (used by the API: no
   superuser, no `BYPASSRLS`).
   - The `pg_trgm` extension is created by the first migration. Managed services allow
     it for the database owner; if yours doesn't, create it once as administrator.
2. **Image bucket.** Make a private bucket with versioning on, and an access key that may
   only read and write that bucket. Set `IMAGE_ORIGIN` to the bucket's HTTPS origin; the
   web app's CSP allows images from there.
3. **Server.** Docker Engine with Compose v2, with only ports 80 and 443 open. Then:
   - copy `infra/deploy` to the server;
   - fill in `.env` from `.env.example` (`chmod 600`, or use the host's secret store);
   - point `APP_DOMAIN`'s DNS record at the server.
4. **Start.** Run `docker compose --profile tls up -d`. Caddy obtains the certificate;
   `migrate` runs, then `api`, then `web`.
5. **Platform staff.** Grant console access with
   `docker compose run --rm api node dist/scripts/platform-admin.js grant <email>`.
6. **Backups.** Set up the nightly job and run the first restore drill (see the backup
   document) before taking real sales.

## Releasing

1. Build and tag the three images with the new release (as above), then load or push them
   to the server.
2. Set `RELEASE=<new>` in `.env`.
3. Run `docker compose --profile tls up -d`:
   - `migrate` applies new migrations;
   - the API is replaced once they succeed;
   - the web container is replaced once the API reports healthy.
4. Check:
   - the health endpoints respond;
   - sign-in works;
   - one test sale goes through on a test business;
   - `docker compose logs api` shows no errors.

**Rolling back.** Migrations only move forward.

- A release with no migration rolls back by setting the previous `RELEASE` and running
  `up -d` again.
- A release that changed the database rolls forward with a fix. If data was damaged,
  restore from backup or point-in-time recovery to just before the release.
- Every migration is reviewed for being safe to run while the previous API version is
  still serving requests.

## Settings that matter in production

- `NODE_ENV=production` turns on:
  - `Secure` cookies;
  - no API docs;
  - required `CORS_ORIGINS`;
  - `https://` required for `WEB_APP_URL` and `API_PUBLIC_URL`.
- `TRUST_PROXY=2` matches Caddy → nginx. With only a load balancer in front of nginx it
  stays 2; it is 1 if nginx itself faces the internet. The client IP (used by rate limits
  and the audit log) is then read correctly and cannot be forged.
- `JWT_ACCESS_SECRET`: rotating it signs everyone out, re-keys image links, and requires
  platform staff to set up their authenticators again
  (`platform-admin reset-totp <email>`).

## Verified so far (2026-10-18, on a development machine)

The stack ran in production mode against a fresh database, with Caddy on `localhost`
using its own local certificate.

**Images and start-up**

- All three images build.
- Migrations applied by the `migrate` job; the API and web containers reported healthy.

**Web and security headers**

- Headers present: CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy.
- Hashed assets are cached for a year, and the app shell is revalidated.
- Deep links fall back to the app.
- In Chromium over HTTPS: register, onboard, reload while staying signed in, and browse,
  with **no CSP violations**.
- The refresh cookie was `Secure`, `HttpOnly`, `SameSite=Strict` and limited to
  `/api/v1/auth`.

**API**

- A product photo upload went through the proxy. Sharp processed it in the Linux image,
  and the signed link redirected to the bucket and returned the WebP.
- Behind Caddy → nginx, the audit log recorded the client's address, not a proxy's.

**Not done yet**

- No real server, domain, registry or managed database has been used: the first real
  deployment is part of the pilot (Slice 14d).
