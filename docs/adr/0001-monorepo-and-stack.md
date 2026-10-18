# ADR 0001 — Monorepo, stack and dependency versions

- **Status:** Accepted (2026-10-16)

## Context

Three clients (Android, web, admin) share one API and must agree on request/response shapes,
validation rules and design tokens. The team is small, so operational simplicity matters more
than independent deployability.

## Decision

- **pnpm workspaces + Turborepo.** Shared packages (`contracts`, `domain`, `api-client`,
  `ui-tokens`) are built with tsup to dual CJS/ESM so NestJS (CJS), Vite and Metro (ESM) all
  consume the same output. pnpm's isolated node_modules is kept (Expo SDK ≥ 54 supports it).
- **Modular monolith** in NestJS: one deployable, one module per business capability with
  explicit boundaries. Splitting a module into a service later is possible because modules
  only talk through their services and the shared contracts.
- **Zod as the single validation language** (`@pos/contracts`). The API validates with a Zod
  pipe; OpenAPI schemas are generated from the same schemas (`z.toJSONSchema`, OpenAPI 3.0
  target); forms use them via `@hookform/resolvers`.
- **Pinned versions.** Exact versions (`save-exact`), choosing the newest release inside
  majors we have verified together rather than the newest majors:

  | Area     | Choice                                                           | Why not newer                                 |
  | -------- | ---------------------------------------------------------------- | --------------------------------------------- |
  | Runtime  | Node 22 LTS                                                      | 24 LTS is a planned upgrade (before Apr 2027) |
  | Language | TypeScript 5.9 (mobile: 6.0 as Expo pins)                        | TS 7 (native compiler) not yet adopted        |
  | API      | NestJS 11, Prisma 6.19                                           | Nest 12 / Prisma 7 change configuration       |
  | Web      | React 19.3, Vite 7, React Router 7, Tailwind 4, TanStack Query 5 | RR 8 not yet evaluated                        |
  | Mobile   | Expo SDK 58 (RN 0.88) — versions chosen by `expo install`        | —                                             |
  | Lint     | ESLint 10 + typescript-eslint 8                                  | ESLint 9 is end of life                       |

  Upgrades go through a dedicated PR that runs the full test suite including E2E.

## Consequences

- Package changes require a build before dependants see them (`turbo` handles ordering).
- Jest is used for API and mobile (Nest decorator metadata, jest-expo), Vitest for packages and
  web. Both are configured; contributors need to know which runner a package uses.
- `expo-doctor` expects Jest 29 while jest-expo 58 requires Jest 30 (per Expo docs); Jest is
  excluded from Expo's version check in `apps/mobile/package.json`.
