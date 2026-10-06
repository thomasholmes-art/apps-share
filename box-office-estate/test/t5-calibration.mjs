// Build-test helper for box-office-estate (module 07, lab 07-hackathon-two-worlds).
// Test T5, fault 2 calibration, on gate-b-reference or later.
//
// Requests the seat map of an arena event and of a theatre event N times each
// through box-office, then reads the resulting traces from SigNoz with the
// checkout's tools/signoz.mjs and prints one JSON object: client-side p95,
// orders-api root span p95, the number of seatmap query spans per trace, the
// shortest and longest query span, and venue.seat_rows.
//
// Usage: node t5-calibration.mjs <checkout-dir> [n=50] [arena=842] [theatre=115]
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [checkout, nArg, arenaArg, theatreArg] = process.argv.slice(2);
const signoz = await import(pathToFileURL(join(checkout, 'tools', 'signoz.mjs')).href);
const N = Number(nArg ?? 50);
const EVENTS = { arena: Number(arenaArg ?? 842), theatre: Number(theatreArg ?? 115) };
const BASE = process.env.BOX_OFFICE_URL ?? 'http://localhost:5180';

const p95 = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const started = Date.now();
const client = { arena: [], theatre: [] };
for (let i = 0; i < N; i += 1) {
  for (const kind of ['arena', 'theatre']) {
    const t = Date.now();
    const res = await fetch(`${BASE}/api/events/${EVENTS[kind]}/seatmap`, { headers: { 'user-agent': 'build-test-t5' } });
    await res.arrayBuffer();
    client[kind].push(Date.now() - t);
  }
}
const ended = Date.now();
await sleep(20000);

const out = {};
for (const kind of ['arena', 'theatre']) {
  const roots = (await signoz.spans({
    start: started - 1000, end: ended + 5000, limit: 1000,
    // event.id is named with its field context: without it SigNoz v0.144
    // reads `event` as a context and rejects the query. The value is a number.
    filter: signoz.filters.and(signoz.filters.eq('service.name', 'orders-api'), `attribute.event.id = ${EVENTS[kind]}`),
  })).filter((s) => !s.parentSpanId);
  const queryCounts = [];
  const queryMs = [];
  const seatRows = new Set();
  for (const root of roots.slice(0, N)) {
    const spans = await signoz.spans({ start: started - 60000, end: ended + 60000, limit: 5000, filter: signoz.filters.eq('trace_id', root.traceId) });
    const queries = spans.filter((s) => s.serviceName === 'seatmap' && /select/i.test(s.name));
    queryCounts.push(queries.length);
    queryMs.push(...queries.map((s) => s.durationMs));
    for (const s of spans) if (s.attributes['venue.seat_rows'] !== undefined) seatRows.add(Number(s.attributes['venue.seat_rows']));
  }
  const sortedQ = [...queryMs].sort((a, b) => a - b);
  out[kind] = {
    event: EVENTS[kind],
    clientP95Ms: p95(client[kind]),
    traces: roots.length,
    rootP95Ms: p95(roots.map((s) => s.durationMs)),
    querySpansPerTrace: [...new Set(queryCounts)],
    querySpanMs: { min: sortedQ[0] ?? null, median: sortedQ[Math.floor(sortedQ.length / 2)] ?? null, p99: sortedQ[Math.floor(sortedQ.length * 0.99)] ?? null, max: sortedQ.at(-1) ?? null },
    querySpansOutside2to5ms: queryMs.filter((ms) => ms < 2 || ms > 5).length,
    querySpansTotal: queryMs.length,
    venueSeatRows: [...seatRows],
  };
}
console.log(JSON.stringify(out));
