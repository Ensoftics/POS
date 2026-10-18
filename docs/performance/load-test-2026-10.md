# Load test — October 2026 (Slice 14b)

How the API behaves under shop traffic, measured on a developer laptop. The numbers show
headroom and find bottlenecks. They are **not** a production capacity figure: production
hardware, network and PostgreSQL settings differ. Repeat the run on the staging environment
before the pilot (`infra/load/README.md`).

## Environment

|                |                                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Machine        | Intel Core i7-13620H (10 cores, 16 threads), 16 GB RAM, Windows 11                                                                                                                                     |
| API            | One Node.js 22 process, `NODE_ENV=production`, JSON logs to file, Prisma pool of 20 connections                                                                                                        |
| Database       | PostgreSQL 17.6 in Docker Desktop (8 GB limit, default settings: `shared_buffers` 128 MB, `work_mem` 4 MB)                                                                                             |
| Load generator | k6 1.3.0 on the same machine (native Windows binary; see "Measurement note")                                                                                                                           |
| Data           | 20 shops × 500 products (EAN-13 barcodes, 18 % VAT included in prices) and 2 tills each; 179,000 sales with 523,000 lines in total; one shop with **112,000 sales over a full year** (489 MB database) |

Seeding goes through the public API (`apps/api/src/scripts/load-seed.ts`). The busy shop's year
was made by copying its own sales (with their lines and payments) 30 times, 12 days apart.

## Targets (set before the first run)

| Request                                     | p95 target |
| ------------------------------------------- | ---------- |
| Barcode lookup at the till                  | < 300 ms   |
| Completing a sale                           | < 800 ms   |
| Syncing a sale saved offline                | < 1.5 s    |
| Till catalogue page (500 items)             | < 1 s      |
| Dashboard, sales report (this week)         | < 2 s      |
| Any report over a whole year (busiest shop) | < 3 s      |
| Failed requests                             | < 0.5 %    |

## Results

### Shop traffic (`k6/pos.js`, 8 minutes)

- 40 tills, each scanning 1–4 items with short pauses and completing a sale every ~5 s.
- Each till pulls its catalogue once a minute.
- After 4 minutes, 10 tills come back online and sync 20 offline sales each.
- 5 managers refresh the dashboard, the sales report and the sales list.

| Request                   | median | p95             | Target |
| ------------------------- | ------ | --------------- | ------ |
| Barcode lookup            | —      | 79 ms           | ✓      |
| Sale                      | —      | 210 ms          | ✓      |
| Offline sale sync (burst) | —      | 167 ms          | ✓      |
| Catalogue page            | —      | 86 ms           | ✓      |
| Dashboard                 | —      | 140 ms          | ✓      |
| Sales report (week)       | —      | 81 ms           | ✓      |
| **Failed requests**       |        | **0 of 13,119** | ✓      |

### Busiest shop's reports over a year, with tills selling elsewhere (`k6/reports.js`)

Five managers run every report for the busiest shop over a full year, while the shop-traffic
scenario runs at the same time.

| Report (1 year, ~112,000 sales) | p95 before fix | p95 after fix | Target            |
| ------------------------------- | -------------- | ------------- | ----------------- |
| Sales by day                    | 1,200 ms       | 775 ms        | ✓                 |
| Sales by product                | 2,350 ms       | 2,083 ms      | ✓                 |
| Sales by category               | **3,972 ms**   | 2,600 ms      | ✓ (failed before) |
| Sales by payment method         | 1,832 ms       | 1,196 ms      | ✓                 |
| Profit                          | 2,025 ms       | 1,524 ms      | ✓                 |
| Tax                             | 1,197 ms       | 729 ms        | ✓                 |
| Dashboard                       | 726 ms         | **84 ms**     | ✓                 |
| Sales list                      | 180 ms         | 48 ms         | ✓                 |

Till traffic during this run stayed fast: sale p95 99 ms, lookup p95 31 ms, no failures. After
the fix, a **one-day** category report for the same shop takes 0.3 s, and a one-day product
report 0.07 s; before the fix the one-day category report took 1.7 s.

### Write throughput (`k6/history.js`)

40 tills post sales back to back with no pauses:

|                               | Sales per second | Sale p95 | Failures |
| ----------------------------- | ---------------- | -------- | -------- |
| Before the fix (40,000 sales) | 102.6            | 454 ms   | 0        |
| After the fix (8,000 sales)   | 97.7             | 515 ms   | 0        |

### Ceiling (`k6/stress.js`)

Sales, each after a barcode lookup, arrive at a rising rate:

| Arrival target | Achieved | Sale p50 | Sale p95             |
| -------------- | -------- | -------- | -------------------- |
| up to 10/s     | 7.4/s    | 120 ms   | 265 ms               |
| up to 20/s     | 14.9/s   | 77 ms    | 480 ms (warm-up)     |
| up to 40/s     | 29.9/s   | 61 ms    | 79 ms                |
| up to 60/s     | 49.8/s   | 70 ms    | 96 ms                |
| up to 80/s     | 68.1/s   | 166 ms   | 743 ms               |
| up to 100/s    | 79.3/s   | 2,403 ms | 2,787 ms (saturated) |

There were no errors even when saturated: requests queued. **One API process sustains about
65–70 sales per second within the 800 ms target on this machine.** That is roughly 240,000
sales an hour, far above a pilot (20 shops × 2 tills ≈ 1 sale per second at a busy moment).
During saturation the API process used about 3.5 cores (JavaScript plus Prisma's query
engine) and PostgreSQL about 1.4 cores, so the API process is the limit.

## Findings and changes

1. **Fixed: line reports scaled with a shop's whole history, not the date range.**
   - _Cause:_ product, category, tax and profit reports joined sale lines to sales to filter
     by date. PostgreSQL walked every line the shop had ever sold (through the variant index)
     and only then filtered by the sale's date, so even a one-day category report took
     1.7 s for the busiest shop.
   - _Same problem in the dashboard:_ its week series applied a date function to every sale.
   - _Change:_ sale lines now carry their sale's date and branch, indexed by business and
     date (`20261027090000_sale_lines_report_columns`).
   - _Integrity:_ a database trigger copies both from the sale on every insert, so lines
     cannot disagree with their sale. Sales are append-only, so the copies stay true. Tested
     for offline sales and for a direct insert that names a wrong date.
   - _Queries:_ reports filter lines directly; the dashboard bounds its week series by time.
   - _Cost:_ about 5 % lower write throughput.
2. **Measurement note: Docker Desktop networking.**
   - With k6 running in a Docker container, 6 of 13,015 requests failed with `dial: i/o
timeout`. The API never received them (it logged only 200/201 responses).
   - The same scenario with k6 running directly on Windows had 0 failures, so the failures
     came from Docker Desktop's container-to-host network path, not the API.
   - The results above use direct runs. On Linux or a staging server, the container is
     fine.
3. **Headroom, not tuned yet:**
   - PostgreSQL ran with Docker defaults. Year-long reports spill a sort to disk at
     `work_mem` 4 MB. Production settings (`shared_buffers` about 25 % of RAM, `work_mem`
     16–32 MB, SSD) should make them faster.
   - Product and category reports over a whole year (~2 s) must still read every line in
     the range. If shops ask for multi-year reports, add daily summary tables.

## Recommendations for deployment

- **Scaling:** one API instance covers the pilot many times over. To scale, run more
  instances behind the load balancer. They are stateless, and the background sweeps already
  claim their work in the database. First move rate limiting to a shared store (see the
  security review).
- **Connection pool:** size it as instances × pool ≤ PostgreSQL `max_connections` minus a
  margin for migrations and administration.
- **Before the pilot:** re-run `pos.js` and `reports.js` against staging with production
  settings, and record the results next to these.
