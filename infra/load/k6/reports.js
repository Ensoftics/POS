// Managers of the busiest shop (a year of sales, about 110,000) running every report
// over the whole year while tills keep selling elsewhere.
//   SHOP=8 k6 run k6/reports.js
import { check, sleep } from 'k6';
import http from 'k6/http';
import { API, params, shops } from './lib.js';

const shop = shops[Number(__ENV.SHOP || 0)];
const to = new Date().toISOString().slice(0, 10);
const from = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
const year = `from=${from}&to=${to}`;

const REPORTS = [
  ['report_day', `/reports/sales?${year}&groupBy=day`],
  ['report_product', `/reports/sales?${year}&groupBy=product`],
  ['report_category', `/reports/sales?${year}&groupBy=category`],
  ['report_payment', `/reports/sales?${year}&groupBy=payment_method`],
  ['report_profit', `/reports/profit?${year}`],
  ['report_tax', `/reports/tax?${year}`],
  ['dashboard', '/reports/dashboard'],
  ['sales_list', '/sales?limit=25'],
];

export const options = {
  scenarios: {
    managers: { executor: 'constant-vus', vus: 5, duration: __ENV.DURATION || '3m' },
  },
  thresholds: {
    'http_req_duration{name:dashboard}': ['p(95)<2000'],
    'http_req_duration{name:sales_list}': ['p(95)<500'],
    // A year in one report: the target for the slowest views.
    'http_req_duration{name:report_day}': ['p(95)<3000'],
    'http_req_duration{name:report_product}': ['p(95)<3000'],
    'http_req_duration{name:report_category}': ['p(95)<3000'],
    'http_req_duration{name:report_payment}': ['p(95)<3000'],
    'http_req_duration{name:report_profit}': ['p(95)<3000'],
    'http_req_duration{name:report_tax}': ['p(95)<3000'],
    http_req_failed: ['rate<0.005'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  for (const [name, path] of REPORTS) {
    check(http.get(`${API}${path}`, params(shop.managerToken, name)), {
      [`${name} 200`]: (r) => r.status === 200,
    });
  }
  sleep(2 + Math.random() * 3);
}
