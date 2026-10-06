// Build-test helper for box-office-estate (module 07, lab 07-hackathon-two-worlds).
// Checks against a real SigNoz that the build test cannot make with the stub.
//
//   node signoz-checks.mjs labels
//     signoz_calls_total for orders-api over the last 15 minutes, grouped by
//     the dotted labels SigNoz v0.144 uses (operation, status.code,
//     http.status_code), and the same filter written with the underscored
//     service_name, which is expected to match no series.
//
//   node signoz-checks.mjs dashboard <name>
//     Runs every builder query of the named v2 dashboard through query_range
//     over the last 15 minutes and reports how many series each returns.
//
// Prints one JSON object. Reads the API key from ~/.config/signoz/api-key.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.SIGNOZ_URL ?? 'http://localhost:8080';
const KEY = readFileSync(process.env.SIGNOZ_API_KEY_FILE ?? join(homedir(), '.config', 'signoz', 'api-key'), 'utf8').trim();
const headers = { 'content-type': 'application/json', 'SIGNOZ-API-KEY': KEY };
const end = Date.now();
const start = end - 15 * 60 * 1000;

async function call(path, body) {
  const res = await fetch(`${BASE}${path}`, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} answered ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

// Series from a time_series answer, as label objects.
function series(json) {
  const out = [];
  for (const r of json?.data?.data?.results ?? []) {
    for (const agg of r.aggregations ?? []) {
      for (const s of agg.series ?? []) out.push(Object.fromEntries((s.labels ?? []).map((l) => [l.key?.name ?? l.key, l.value])));
    }
    for (const s of r.series ?? []) out.push(Object.fromEntries((s.labels ?? []).map((l) => [l.key?.name ?? l.key, l.value])));
  }
  return out;
}

const timeSeries = (queries) => call('/api/v5/query_range', {
  schemaVersion: 'v1', start, end, requestType: 'time_series', compositeQuery: { queries },
});

async function labels() {
  const metric = (filter) => [{ type: 'builder_query', spec: {
    name: 'A', signal: 'metrics',
    aggregations: [{ metricName: 'signoz_calls_total', timeAggregation: 'increase', spaceAggregation: 'sum' }],
    filter: { expression: filter },
    groupBy: [{ name: 'operation' }, { name: 'status.code' }, { name: 'http.status_code' }],
  } }];
  const dotted = series(await timeSeries(metric("service.name = 'orders-api'")));
  let underscored;
  try { underscored = series(await timeSeries(metric("service_name = 'orders-api'"))).length; } catch (e) { underscored = `error: ${e.message.slice(0, 120)}`; }
  return { dottedSeries: dotted.length, sample: dotted.slice(0, 6), underscoredSeries: underscored };
}

async function dashboard(name) {
  const list = (await call('/api/v2/dashboards'))?.data?.dashboards ?? [];
  const item = list.find((d) => d.name === name || d.spec?.display?.name === name);
  if (!item) return { error: `no dashboard named ${name}` };
  const full = (await call(`/api/v2/dashboards/${item.id}`)).data;
  const panels = {};
  for (const panel of Object.values(full.spec?.panels ?? {})) {
    const title = panel.spec?.display?.name;
    const queries = [];
    for (const q of panel.spec?.queries ?? []) {
      const plugin = q.spec?.plugin ?? {};
      if (plugin.kind === 'signoz/CompositeQuery') queries.push(...plugin.spec.queries);
      else queries.push({ type: 'builder_query', spec: plugin.spec });
    }
    try {
      panels[title] = { series: series(await timeSeries(queries)).length };
    } catch (e) {
      panels[title] = { error: e.message.slice(0, 200) };
    }
  }
  return { dashboard: name, id: item.id, panels };
}

const [cmd, arg] = process.argv.slice(2);
const result = cmd === 'labels' ? await labels() : cmd === 'dashboard' ? await dashboard(arg) : { error: 'usage: signoz-checks.mjs labels | dashboard <name>' };
console.log(JSON.stringify(result));
