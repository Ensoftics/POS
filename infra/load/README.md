# Load tests

k6 scripts that drive the API like real shops. Results and targets:
[docs/performance/load-test-2026-10.md](../../docs/performance/load-test-2026-10.md).

| Script          | What it does                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `k6/pos.js`     | Shop traffic: tills scanning and selling, catalogue pulls, a burst of offline syncs, managers on reports. Pass/fail targets built in. |
| `k6/reports.js` | Every report over a full year for one shop (`SHOP=<index>`).                                                                          |
| `k6/history.js` | Posts `SALES` sales back to back: builds history and measures write throughput.                                                       |
| `k6/stress.js`  | Raises the sale rate until the API falls behind (finds the ceiling).                                                                  |

## Run

Use a separate database. The seed creates many accounts, and the load settings relax rate limits.

```sh
docker exec ensoftic-pos-postgres-1 createdb -U pos_owner pos_load
cd apps/api
pnpm build
pnpm exec dotenv -e ../../infra/load/.env.load -- prisma migrate deploy
pnpm exec dotenv -e ../../infra/load/.env.load -- node dist/main.js     # API on :4200 (keep running)

# In another terminal, from apps/api:
LOAD_API_URL=http://127.0.0.1:4200/api/v1 LOAD_SHOPS=20 LOAD_PRODUCTS=500 \
  LOAD_OUT=../../infra/load/fixture.json node dist/scripts/load-seed.js

# From infra/load, with k6 1.3.0 installed (https://github.com/grafana/k6/releases/tag/v1.3.0):
API_URL=http://127.0.0.1:4200/api/v1 SALES=40000 k6 run k6/history.js
API_URL=http://127.0.0.1:4200/api/v1 k6 run k6/pos.js
API_URL=http://127.0.0.1:4200/api/v1 SHOP=0 k6 run k6/reports.js
API_URL=http://127.0.0.1:4200/api/v1 k6 run k6/stress.js
```

k6 can also run from its pinned image (`grafana/k6:1.3.0`) with `-v "$PWD:/load"` and
`API_URL=http://host.docker.internal:4200/api/v1`. On Docker Desktop for Windows, though, a few
connections from the container to the host time out under load, and those failures never
reach the API. Run k6 directly there, or run everything on Linux.

`fixture.json` holds the seeded shops' access tokens (valid for an hour with the load
settings), and `results/` holds run output. Both are git-ignored. Drop the database with
`dropdb pos_load` when done.
