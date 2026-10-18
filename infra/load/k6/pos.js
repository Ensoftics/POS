// Realistic shop traffic against the API (see infra/load/README.md).
//   docker run --rm -v "$PWD/infra/load:/load" grafana/k6:1.3.0 run /load/k6/pos.js
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { API, basket, params, pick, saleBody, shops, tills } from './lib.js';

const DURATION = __ENV.DURATION || '8m';

export const options = {
  scenarios: {
    // Every till: scan 1-4 items with short pauses, take payment, wait for the next customer.
    tills: {
      executor: 'constant-vus',
      exec: 'till',
      vus: tills.length,
      duration: DURATION,
    },
    // Each till refreshes its offline catalogue about once a minute (first page, the heaviest case).
    catalogue: {
      executor: 'constant-arrival-rate',
      exec: 'catalogue',
      rate: tills.length,
      timeUnit: '1m',
      duration: DURATION,
      preAllocatedVUs: 10,
    },
    // Half-way through, a quarter of the tills come back online and sync 20 sales each at once.
    offlineBurst: {
      executor: 'per-vu-iterations',
      exec: 'offlineBurst',
      vus: Math.max(1, Math.floor(tills.length / 4)),
      iterations: 1,
      startTime: '4m',
      maxDuration: '3m',
    },
    // Managers watching the dashboard and reports.
    managers: {
      executor: 'constant-vus',
      exec: 'manager',
      vus: 5,
      duration: DURATION,
    },
  },
  // Targets set before the first run (docs/performance/load-test-2026-10.md).
  thresholds: {
    'http_req_failed{scenario:tills}': ['rate<0.005'],
    'http_req_failed{scenario:offlineBurst}': ['rate<0.005'],
    'http_req_duration{name:lookup}': ['p(95)<300'],
    'http_req_duration{name:sale}': ['p(95)<800'],
    'http_req_duration{name:offline_sale}': ['p(95)<1500'],
    'http_req_duration{name:catalogue}': ['p(95)<1000'],
    'http_req_duration{name:dashboard}': ['p(95)<2000'],
    'http_req_duration{name:sales_report}': ['p(95)<2000'],
    checks: ['rate>0.995'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function till() {
  const me = tills[(exec.vu.idInTest - 1) % tills.length];
  const items = shops[me.shopIndex].items;
  const lines = basket(items, 1 + Math.floor(Math.random() * 4));
  for (const line of lines) {
    const res = http.get(
      `${API}/products/lookup?code=${line.item.barcode}`,
      params(me.token, 'lookup'),
    );
    check(res, { 'lookup 200': (r) => r.status === 200 });
    sleep(0.5 + Math.random());
  }
  const sale = http.post(`${API}/sales`, saleBody(me, lines, false), params(me.token, 'sale'));
  check(sale, { 'sale 201': (r) => r.status === 201 });
  sleep(2 + Math.random() * 2);
}

export function catalogue() {
  const me = pick(tills);
  const res = http.get(`${API}/sync/catalog?limit=500`, params(me.token, 'catalogue'));
  check(res, { 'catalogue 200': (r) => r.status === 200 });
}

export function offlineBurst() {
  const me = tills[(exec.vu.idInTest - 1) % tills.length];
  const items = shops[me.shopIndex].items;
  for (let i = 0; i < 20; i += 1) {
    const res = http.post(
      `${API}/sales`,
      saleBody(me, basket(items, 3), true),
      params(me.token, 'offline_sale'),
    );
    check(res, { 'offline sale 201': (r) => r.status === 201 });
  }
}

export function manager() {
  const shop = pick(shops);
  check(http.get(`${API}/reports/dashboard`, params(shop.managerToken, 'dashboard')), {
    'dashboard 200': (r) => r.status === 200,
  });
  check(http.get(`${API}/reports/sales?groupBy=day`, params(shop.managerToken, 'sales_report')), {
    'report 200': (r) => r.status === 200,
  });
  check(http.get(`${API}/sales?limit=25`, params(shop.managerToken, 'sales_list')), {
    'sales list 200': (r) => r.status === 200,
  });
  sleep(8 + Math.random() * 4);
}
