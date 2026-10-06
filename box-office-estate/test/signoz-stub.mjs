// Build-test helper for box-office-estate (module 07, lab 07-hackathon-two-worlds).
//
// A small stand-in for the SigNoz query API, for testing ./verify.sh on a
// host with no SigNoz. It serves what the collector's file exporters wrote
// (OTLP JSON lines in OUT_DIR) in the request and row shapes tools/signoz.mjs
// expects, and one dashboard from a v2 dashboard JSON file. It implements only the
// filter expressions tools/export-telemetry.mjs sends: terms joined by AND,
// each `key = 'v'`, `key IN ('a', 'b')` or `key CONTAINS 'v'`.
//
// Usage: node signoz-stub.mjs <out-dir> <port> [dashboard.json]
// What this does not test: whether a real SigNoz accepts these requests and
// answers in this shape. That is checked on the lab image at tech check.
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [outDir, port, dashboardFile] = process.argv.slice(2);

const value = (v) => v?.stringValue ?? v?.intValue ?? v?.doubleValue ?? v?.boolValue
  ?? (v?.kvlistValue ? Object.fromEntries(v.kvlistValue.values.map((x) => [x.key, value(x.value)])) : undefined);
const attrs = (list) => Object.fromEntries((list ?? []).map((a) => [a.key, value(a.value)]));
const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const KIND = ['Unspecified', 'Internal', 'Server', 'Client', 'Producer', 'Consumer'];
const STATUS = ['Unset', 'Ok', 'Error'];

function spanRows() {
  const rows = [];
  for (const req of lines(join(outDir, 'traces.jsonl'))) {
    for (const rs of req.resourceSpans ?? []) {
      const res = attrs(rs.resource?.attributes);
      for (const ss of rs.scopeSpans ?? []) {
        for (const s of ss.spans ?? []) {
          const start = Number(BigInt(s.startTimeUnixNano) / 1000000n);
          const code = s.status?.code ?? 0;
          rows.push({
            timeMs: start,
            data: {
              ...attrs(s.attributes),
              trace_id: s.traceId, span_id: s.spanId, parent_span_id: s.parentSpanId ?? '',
              name: s.name, 'service.name': res['service.name'],
              duration_nano: Number(BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano)),
              kind_string: KIND[s.kind ?? 0], status_code_string: STATUS[code], has_error: code === 2,
            },
          });
        }
      }
    }
  }
  return rows;
}

function logRows() {
  const rows = [];
  for (const req of lines(join(outDir, 'logs.jsonl'))) {
    for (const rl of req.resourceLogs ?? []) {
      const res = attrs(rl.resource?.attributes);
      for (const sl of rl.scopeLogs ?? []) {
        for (const r of sl.logRecords ?? []) {
          const a = attrs(r.attributes);
          const split = { attributes_string: {}, attributes_number: {}, attributes_bool: {} };
          for (const [k, v] of Object.entries(a)) {
            if (typeof v === 'number') split.attributes_number[k] = v;
            else if (typeof v === 'boolean') split.attributes_bool[k] = v;
            else if (typeof v === 'string') split.attributes_string[k] = v;
          }
          const ns = r.timeUnixNano && r.timeUnixNano !== '0' ? r.timeUnixNano : r.observedTimeUnixNano;
          rows.push({
            timeMs: Number(BigInt(ns) / 1000000n),
            data: { body: value(r.body), ...split, resources_string: res, severity_text: r.severityText ?? '',
              trace_id: r.traceId ?? '', span_id: r.spanId ?? '' },
            flat: { ...a, ...res, body: value(r.body) },
          });
        }
      }
    }
  }
  return rows;
}

function matcher(expression) {
  const terms = String(expression ?? '').split(/\s+AND\s+/).filter(Boolean).map((t) => {
    let m = t.match(/^([\w.]+)\s*=\s*'(.*)'$/);
    if (m) return (row) => String(row[m[1]] ?? '') === m[2];
    m = t.match(/^([\w.]+)\s+IN\s+\((.*)\)$/);
    if (m) { const set = [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]); return (row) => set.includes(String(row[m[1]] ?? '')); }
    m = t.match(/^([\w.]+)\s+CONTAINS\s+'(.*)'$/);
    if (m) return (row) => String(row[m[1]] ?? '').includes(m[2]);
    throw new Error(`stub cannot evaluate: ${t}`);
  });
  return (row) => terms.every((f) => f(row));
}

function query(body) {
  const spec = body.compositeQuery.queries[0].spec;
  const match = matcher(spec.filter?.expression);
  const source = spec.signal === 'traces' ? spanRows() : logRows();
  const rows = source
    .filter((r) => r.timeMs >= body.start && r.timeMs <= body.end)
    .filter((r) => match(r.flat ?? r.data))
    .sort((x, y) => (spec.order?.[0]?.direction === 'asc' ? x.timeMs - y.timeMs : y.timeMs - x.timeMs))
    .slice(0, spec.limit ?? 1000)
    .map((r) => ({ timestamp: new Date(r.timeMs).toISOString(), data: r.data }));
  return { status: 'success', data: { type: 'raw', data: { results: [{ queryName: 'A', rows }] } } };
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    try {
      let out;
      if (req.method === 'POST' && req.url === '/api/v5/query_range') out = query(JSON.parse(raw));
      else if (req.url === '/api/v2/dashboards') {
        out = { status: 'success', data: { dashboards: dashboardFile ? [{ id: 'reference', updatedAt: new Date().toISOString() }] : [] } };
      } else if (req.url === '/api/v2/dashboards/reference' && dashboardFile) {
        // The file is a v2 dashboard body (schemaVersion v6), as SigNoz returns it.
        out = { status: 'success', data: { id: 'reference', updatedAt: new Date().toISOString(), ...JSON.parse(readFileSync(dashboardFile, 'utf8')) } };
      } else out = { status: 'ok' };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400).end(JSON.stringify({ status: 'error', error: e.message }));
    }
  });
}).listen(Number(port), '127.0.0.1');
