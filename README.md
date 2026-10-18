# Ensoftic POS

Subscription-based, multi-tenant point-of-sale platform for cosmetics, textile and general
retail shops. One backend serves three clients: an Android POS app, a web app (checkout and
back office) and, from Slice 12, a SaaS super-admin console.

> **Status:** Slices 0–13 and Slice 14a–14c (security review, load tests, deployment and backups) are complete: foundation; tenants, authentication and onboarding;
> business settings, industry profiles, branches and registers; products, variants, barcodes,
> pricing and CSV import/export; suppliers, purchasing, receiving and inventory; checkout with
> taxes, discounts, split payments, receipts and shifts; returns, voids, manager approvals and
> cash reconciliation; offline selling with sync and review; customers, credit accounts,
> collections and statements; reports, profit and dashboards with CSV export; staff
> invitations, roles, branch restrictions and device management; plans, trials, subscriptions
> and PayHere billing; a platform console for Ensoftic staff; feature flags and notifications; loyalty points; product photos in object storage; expired-stock protection at the till; Bluetooth receipt printing on Android; customer messages by e-mail and SMS with recorded consent. See [docs/roadmap.md](docs/roadmap.md) for what each slice delivers and what is next.

## Repository layout

| Path                  | What it is                                                                  |
| --------------------- | --------------------------------------------------------------------------- |
| `apps/api`            | NestJS REST API (modular monolith), Prisma + PostgreSQL, OpenAPI docs       |
| `apps/web`            | React + Vite web app (owners, managers, cashiers on desktop/tablet)         |
| `apps/mobile`         | Expo / React Native Android app (cashiers and managers)                     |
| `packages/contracts`  | Zod schemas and types for every API request/response — single source        |
| `packages/domain`     | Framework-free business rules (roles, permissions, password policy, slugs)  |
| `packages/api-client` | Typed fetch client with token renewal, shared by web and mobile             |
| `packages/i18n`       | English, Sinhala and Tamil translations shared by web and mobile            |
| `packages/offline`    | Offline selling: catalogue copy, sale outbox and sync engine for both tills |
| `packages/ui-tokens`  | Design tokens → TS values (mobile) and Tailwind `@theme` CSS (web)          |
| `packages/config`     | Shared TypeScript presets                                                   |
| `infra`               | Docker Compose for local Postgres, Mailpit, object storage and Redis        |
| `docs`                | Architecture, ADRs, roadmap, localization notes, generated OpenAPI          |

The super-admin console will be added as `apps/admin` in Slice 12; it is a separate app
(not a section of `apps/web`) so platform access never ships in the tenant bundle.

## Prerequisites

- **Node.js 22 LTS** (≥ 22.12; `.nvmrc` pins 22.23.3). Node 20 reached end of life in April 2026.
- **pnpm 9.15** (`npm i -g pnpm@9.15.9` or `corepack enable`).
- **Docker** with Compose v2 for Postgres, Mailpit and object storage (SeaweedFS).
- For Android: Android Studio (SDK + an emulator) and JDK 17+, or an EAS account for cloud builds.

## Quick start

```sh
pnpm install
pnpm db:up                        # Postgres :5434, Mailpit :1026 (UI http://localhost:8026), S3 :8334
cp apps/api/.env.example apps/api/.env
# set JWT_ACCESS_SECRET in apps/api/.env (instructions inside the file)
pnpm db:deploy                    # apply migrations to pos_dev
pnpm build                        # build shared packages, API and web
pnpm --filter @pos/api storage:init   # create the local image bucket (once)
pnpm dev                          # API http://localhost:4000, web http://localhost:5180
```

- API docs (Swagger UI): http://localhost:4000/api/v1/docs
- Health: http://localhost:4000/health/live and `/health/ready`
- Password-reset, invitation and verification emails land in Mailpit: http://localhost:8026
- Online payment stays off ("not set up yet") until PayHere credentials are set in
  `apps/api/.env` (`PAYHERE_MERCHANT_ID`, `PAYHERE_MERCHANT_SECRET`, `PAYHERE_MODE`). PayHere
  must reach `API_PUBLIC_URL` to confirm payments, so test the sandbox from a public URL
  (e.g. a tunnel). See [ADR 0013](docs/adr/0013-plans-subscriptions-billing.md).
- Customer SMS stays unavailable until Notify.lk credentials are set (`NOTIFYLK_USER_ID`,
  `NOTIFYLK_API_KEY`, `NOTIFYLK_SENDER_ID`); customer e-mails land in Mailpit. See
  [ADR 0020](docs/adr/0020-customer-messaging-and-consent.md).

Android app (emulator running, API on the host):

```sh
cp apps/mobile/.env.example apps/mobile/.env   # EXPO_PUBLIC_API_URL=http://10.0.2.2:4000/api/v1
pnpm --filter @pos/mobile android              # prebuild + Gradle debug build + Metro
```

Receipt printing needs a real phone or tablet with Bluetooth (emulators have none) and a
Bluetooth LE ESC/POS printer; set it up under **Receipt printer** on the app's home screen.

> **Windows + Android native builds:** React Native's CMake/ninja steps exceed the 260-character
> path limit inside pnpm's store. Enable long paths once (admin PowerShell, then reopen terminals):
> `New-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force`
> or build in the cloud with EAS (`npx eas-cli@latest build -p android --profile development`).

> On Windows use `127.0.0.1` rather than `localhost` in database URLs: `localhost` resolves
> to IPv6 first and every new pooled connection stalls ~2 s before falling back.

Deploying and backups: [docs/operations/deployment.md](docs/operations/deployment.md) and
[docs/operations/backup-and-restore.md](docs/operations/backup-and-restore.md).

## Commands

| Command                                               | Purpose                                                                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck`                        | ESLint and TypeScript across all workspaces                                                                       |
| `pnpm format` / `pnpm format:check`                   | Prettier                                                                                                          |
| `pnpm test:unit`                                      | Fast tests, no database                                                                                           |
| `pnpm test`                                           | Unit + API integration tests (needs `pnpm db:up`)                                                                 |
| `pnpm test:e2e`                                       | Playwright against the real API + web + Mailpit (needs `pnpm build`)                                              |
| `pnpm db:migrate`                                     | Create a new migration in development (`prisma migrate dev`)                                                      |
| `pnpm db:deploy` / `db:test:deploy`                   | Apply committed migrations to `pos_dev` / `pos_test`                                                              |
| `pnpm --filter @pos/api openapi`                      | Regenerate `docs/api/openapi.json`                                                                                |
| `pnpm --filter @pos/api platform:admin grant <email>` | Give an existing account platform-console access (prints the authenticator key once; also `reset-totp`, `revoke`) |

Integration and E2E tests both use the `pos_test` database; run them one after the other.

## Ports

| Service         | Port             |
| --------------- | ---------------- |
| API             | 4000 (E2E: 4100) |
| Web             | 5180 (E2E: 5190) |
| Postgres        | 5434             |
| Mailpit SMTP/UI | 1026 / 8026      |
| Object storage  | 8334 (S3 API)    |
| Redis (opt-in)  | 6380             |

## Further reading

- [Architecture overview](docs/architecture.md)
- [Architecture decision records](docs/adr)
- [Roadmap and acceptance criteria](docs/roadmap.md)
- [Localization](docs/localization.md)
