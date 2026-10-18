// Builds a sales history quickly (for the report scenarios) and measures write throughput:
// every till posts sales back to back with no pauses.
//   docker run --rm -e SALES=40000 -v "$PWD/infra/load:/load" grafana/k6:1.3.0 run /load/k6/history.js
import { check } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { API, basket, params, saleBody, shops, tills } from './lib.js';

export const options = {
  scenarios: {
    history: {
      executor: 'shared-iterations',
      vus: tills.length,
      iterations: Number(__ENV.SALES || 40000),
      maxDuration: '60m',
    },
  },
  thresholds: { http_req_failed: ['rate<0.005'] },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const me = tills[(exec.vu.idInTest - 1) % tills.length];
  const res = http.post(
    `${API}/sales`,
    saleBody(me, basket(shops[me.shopIndex].items, 1 + Math.floor(Math.random() * 5)), false),
    params(me.token, 'sale'),
  );
  check(res, { 'sale 201': (r) => r.status === 201 });
}
