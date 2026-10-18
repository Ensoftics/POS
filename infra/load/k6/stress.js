// Finds the ceiling: sales (each preceded by a scan) arrive at a rising rate until the
// API falls behind. Read where p95 passes 800 ms or errors start (the summary and the
// per-stage output).
//   docker run --rm -v "$PWD/infra/load:/load" grafana/k6:1.3.0 run /load/k6/stress.js
import { check } from 'k6';
import http from 'k6/http';
import { API, basket, params, pick, saleBody, shops, tills } from './lib.js';

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 400,
      stages: [
        { target: 10, duration: '1m' },
        { target: 20, duration: '1m' },
        { target: 40, duration: '1m' },
        { target: 60, duration: '1m' },
        { target: 80, duration: '1m' },
        { target: 100, duration: '1m' },
      ],
    },
  },
  // Not pass/fail: reported per stage in the write-up.
  thresholds: {
    'http_req_duration{name:sale}': ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const me = pick(tills);
  const lines = basket(shops[me.shopIndex].items, 3);
  check(
    http.get(`${API}/products/lookup?code=${lines[0].item.barcode}`, params(me.token, 'lookup')),
    {
      'lookup 200': (r) => r.status === 200,
    },
  );
  check(http.post(`${API}/sales`, saleBody(me, lines, false), params(me.token, 'sale')), {
    'sale 201': (r) => r.status === 201,
  });
}
