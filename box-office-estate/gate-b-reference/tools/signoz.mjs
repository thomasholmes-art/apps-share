// The SigNoz client used by ./verify.sh. Part of box-office-estate, the
// application behind module 07, lab 07-hackathon-two-worlds.
//
// Everything that depends on the SigNoz version is in this file: the base
// URL, the endpoints, the API key, the request bodies and the shape of the
// rows that come back. export-telemetry.mjs only sees the plain records
// returned by the functions below. When the SigNoz image is upgraded, this is
// the file to check against the new version's API.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SIGNOZ = {
  // Pinned with the lab image: SigNoz v0.144.0 (lab-image/signoz/). The query
  // endpoint is the query range API, version 5. Dashboards come from the v2
  // dashboards API; in v0.144 the v1 path answers with the UI's HTML page.
  apiVersion: 'SigNoz v0.144.0: query_range v5, dashboards v2',
  baseUrl: process.env.SIGNOZ_URL ?? 'http://localhost:8080',
  queryRangePath: '/api/v5/query_range',
  dashboardsPath: '/api/v2/dashboards',
  apiKeyFile: process.env.SIGNOZ_API_KEY_FILE ?? join(homedir(), '.config', 'signoz', 'api-key'),
  apiKeyHeader: 'SIGNOZ-API-KEY',
  requestTimeoutMs: 15000,
};

// Span attributes copied into the export. Raw trace queries return only the
// columns asked for, so the list is explicit.
const SPAN_FIELDS = [
  'http.route', 'http.request.method', 'http.method', 'http.response.status_code', 'http.status_code',
  'event.id', 'venue.seat_rows', 'peer.service', 'server.address',
  'messaging.system', 'messaging.operation', 'client.timeout_ms',
  'faas.coldstart', 'queue.wait_ms', 'idle.timeout_s',
  'db.system', 'db.system.name', 'db.statement', 'db.query.text', 'db.operation.name', 'db.collection.name',
];

function apiKey() {
  try {
    return readFileSync(SIGNOZ.apiKeyFile, 'utf8').trim();
  } catch {
    return undefined;
  }
}

function headers() {
  const key = apiKey();
  return { 'content-type': 'application/json', ...(key ? { [SIGNOZ.apiKeyHeader]: key } : {}) };
}

// True when anything answers HTTP on the base URL.
export async function answering() {
  try {
    await fetch(`${SIGNOZ.baseUrl}/`, { signal: AbortSignal.timeout(4000) });
    return true;
  } catch {
    return false;
  }
}

async function call(path, init) {
  const res = await fetch(`${SIGNOZ.baseUrl}${path}`, {
    ...init,
    headers: headers(),
    signal: AbortSignal.timeout(SIGNOZ.requestTimeoutMs),
  });
  if (!res.ok) throw new Error(`SigNoz ${path} answered HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// One raw (list) query. `filter` is a SigNoz filter expression. Each entry
// of `selectFields` is a column name or { name, fieldContext }.
async function raw(signal, { start, end, filter, limit = 1000, direction = 'desc', selectFields }) {
  const body = {
    schemaVersion: 'v1',
    start: Math.floor(start),
    end: Math.ceil(end),
    requestType: 'raw',
    compositeQuery: {
      queries: [{
        type: 'builder_query',
        spec: {
          name: 'A',
          signal,
          filter: { expression: filter },
          order: [{ key: { name: 'timestamp' }, direction }],
          limit,
          ...(selectFields ? { selectFields: selectFields.map((f) => (typeof f === 'string' ? { name: f } : f)) } : {}),
        },
      }],
    },
  };
  const json = await call(SIGNOZ.queryRangePath, { method: 'POST', body: JSON.stringify(body) });
  const results = json?.data?.data?.results ?? json?.data?.results ?? [];
  return results.flatMap((r) => r.rows ?? []);
}

const quote = (v) => `'${String(v).replaceAll("'", "\\'")}'`;
export const filters = {
  eq: (key, value) => `${key} = ${quote(value)}`,
  in: (key, values) => `${key} IN (${values.map(quote).join(', ')})`,
  contains: (key, value) => `${key} CONTAINS ${quote(value)}`,
  and: (...parts) => parts.join(' AND '),
};

const toMs = (ts) => (typeof ts === 'number' ? (ts > 1e15 ? ts / 1e6 : ts) : Date.parse(ts));

function statusOf(d) {
  const s = String(d.status_code_string ?? d.statusCodeString ?? '').toLowerCase();
  if (s.includes('error') || d.has_error === true || d.hasError === true) return 'ERROR';
  if (s.includes('ok')) return 'OK';
  return 'UNSET';
}

// Span rows as plain records:
// { traceId, spanId, parentSpanId, serviceName, name, kind, startMs (epoch), durationMs, status, attributes }
export async function spans(query) {
  // The span attributes are named with their field context. Without it,
  // v0.144 reads the prefix of a name such as event.id as a context (`event`)
  // and rejects the query; with it, an attribute no span has yet reported is
  // accepted rather than refused.
  const selectFields = [
    ...['trace_id', 'span_id', 'parent_span_id', 'name', 'duration_nano', 'kind_string', 'status_code_string', 'has_error'],
    { name: 'service.name', fieldContext: 'resource' },
    ...SPAN_FIELDS.map((name) => ({ name, fieldContext: 'attribute' })),
  ];
  const rows = await raw('traces', { ...query, selectFields });
  return rows.map(({ timestamp, data: d }) => {
    const attributes = {};
    for (const key of SPAN_FIELDS) {
      const v = d[key] ?? d[`attribute.${key}`];
      if (v !== undefined && v !== null && v !== '') attributes[key] = v;
    }
    return {
      traceId: d.trace_id ?? d.traceID,
      spanId: d.span_id ?? d.spanID,
      parentSpanId: (d.parent_span_id ?? d.parentSpanID) || null,
      serviceName: d['service.name'] ?? d.serviceName,
      name: d.name,
      kind: d.kind_string ?? d.spanKind,
      startMs: toMs(timestamp ?? d.timestamp),
      durationMs: Number(d.duration_nano ?? d.durationNano ?? 0) / 1e6,
      status: statusOf(d),
      attributes,
    };
  });
}

// Log rows as plain records:
// { timeMs, serviceName, body, attributes, traceId, spanId, severity }
export async function logs(query) {
  const rows = await raw('logs', query);
  return rows.map(({ timestamp, data: d }) => {
    const attributes = {
      ...(d.attributes_string ?? {}),
      ...(d.attributes_number ?? {}),
      ...(d.attributes_bool ?? {}),
    };
    const resources = d.resources_string ?? {};
    return {
      timeMs: toMs(timestamp ?? d.timestamp),
      serviceName: resources['service.name'] ?? attributes.service_name,
      body: typeof d.body === 'string' ? d.body : JSON.stringify(d.body ?? ''),
      attributes,
      traceId: d.trace_id || undefined,
      spanId: d.span_id || undefined,
      severity: d.severity_text,
    };
  });
}

// A v2 (schema v6) panel as a widget in the builder shape normaliseWidget()
// reads: each builder query becomes a queryData entry and each formula a
// queryFormulas entry. A panel holds either one builder query or a composite
// of several queries and formulas.
function widgetFromPanel(panel) {
  const queryData = [];
  const queryFormulas = [];
  for (const q of panel?.spec?.queries ?? []) {
    const plugin = q?.spec?.plugin ?? {};
    const parts = plugin.kind === 'signoz/CompositeQuery'
      ? (plugin.spec?.queries ?? [])
      : [{ type: plugin.kind === 'signoz/Formula' ? 'builder_formula' : 'builder_query', spec: plugin.spec }];
    for (const part of parts) {
      const spec = part?.spec ?? {};
      if (part.type === 'builder_formula') {
        queryFormulas.push({ expression: spec.expression, disabled: spec.disabled });
      } else if (part.type === 'builder_query') {
        queryData.push({
          queryName: spec.name,
          dataSource: spec.signal,
          aggregations: spec.aggregations ?? [],
          filter: spec.filter ?? {},
          groupBy: (spec.groupBy ?? []).map((g) => ({ key: g?.name ?? g?.key ?? g })),
          disabled: spec.disabled,
        });
      }
    }
  }
  return { title: panel?.spec?.display?.name ?? '', query: { builder: { queryData, queryFormulas } } };
}

// Dashboards as { name, updatedMs, widgets }, where each widget is in the
// builder shape normaliseWidget() reads. The v2 list carries no panels, so
// each dashboard is fetched by id.
export async function dashboards() {
  const json = await call(SIGNOZ.dashboardsPath, { method: 'GET' });
  const list = json?.data?.dashboards ?? (Array.isArray(json?.data) ? json.data : []);
  const out = [];
  for (const item of list) {
    const full = (await call(`${SIGNOZ.dashboardsPath}/${encodeURIComponent(item.id)}`, { method: 'GET' }))?.data ?? item;
    const panels = Object.values(full.spec?.panels ?? {});
    out.push({
      name: full.spec?.display?.name ?? full.name ?? null,
      updatedMs: toMs(full.updatedAt ?? item.updatedAt ?? full.createdAt ?? 0) || 0,
      widgets: panels.length > 0 ? panels.map(widgetFromPanel) : (full.data?.widgets ?? full.widgets ?? []),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Widget normalisation (spec section 5.4). A widget holds one or more builder
// queries and, optionally, formulas over them. Two query shapes are read:
// the builder shape with aggregateOperator / aggregateAttribute / filters.items,
// and the newer shape with aggregations[] and a filter expression.

// Trace queries mark errors with has_error = true. Span metrics in SigNoz
// v0.144 carry the dotted label status.code, value STATUS_CODE_ERROR; the
// underscored form of older versions is accepted too.
const ERROR_FILTER = /\b(has_error|hasError)\b\s*(=|:)?\s*'?true'?|status[._]code\w*\s*(=|IN\s*\()\s*'?STATUS_CODE_ERROR'?/i;

function queriesOf(widget) {
  const builder = widget?.query?.builder ?? {};
  return {
    // Every query, including ones hidden from the chart: a hidden query still
    // feeds the formulas that use it.
    data: (builder.queryData ?? []).filter(Boolean),
    formulas: (builder.queryFormulas ?? []).filter((f) => f && !f.disabled),
  };
}

function filterPairs(q) {
  const items = (q.filters?.items ?? []).map((f) => ({
    key: String(f.key?.key ?? f.key ?? ''),
    value: f.value,
  }));
  const expression = q.filter?.expression ?? q.filters?.expression;
  if (expression) {
    for (const m of String(expression).matchAll(/([\w.]+)\s*(?:=|IN)\s*\(?\s*'?([^')]+)'?\s*\)?/gi)) {
      items.push({ key: m[1], value: m[2] });
    }
  }
  return items;
}

function filterText(q) {
  return [
    ...(q.filters?.items ?? []).map((f) => `${f.key?.key ?? f.key} = ${Array.isArray(f.value) ? f.value.join(',') : f.value}`),
    q.filter?.expression ?? '',
  ].join(' AND ');
}

function aggregateOf(q) {
  let op = q.aggregateOperator ?? q.spaceAggregation ?? q.timeAggregation;
  let attr = q.aggregateAttribute?.key ?? q.metricName;
  const agg = (q.aggregations ?? [])[0];
  if (agg) {
    if (agg.metricName) {
      attr = agg.metricName;
      op = agg.spaceAggregation ?? agg.timeAggregation ?? op;
    } else if (agg.expression) {
      const m = String(agg.expression).match(/^\s*(\w+)\s*\(\s*([\w.]*)\s*\)/);
      if (m) { op = m[1]; attr = m[2] || attr; }
    }
  }
  op = String(op ?? '').toLowerCase();
  attr = String(attr ?? '');
  const aggregation = /95/.test(op) ? 'p95' : op;
  if (q.dataSource === 'traces') {
    const durationOp = /^(p\d+|avg|max|min|sum|hist_quantile_\d+)$/.test(op);
    const metric = /duration/i.test(attr) || (durationOp && attr !== '') ? 'durationNano' : 'calls';
    return { metric, aggregation };
  }
  return { metric: attr, aggregation };
}

export function normaliseWidget(widget) {
  const { data, formulas } = queriesOf(widget);
  const first = data.find((q) => !q.disabled) ?? data[0] ?? {};
  let { metric, aggregation } = aggregateOf(first);
  const filters = data.flatMap(filterPairs);
  if (formulas.length > 0 && data.some((q) => ERROR_FILTER.test(filterText(q)))) {
    metric = 'signoz_error_ratio';
    aggregation = 'ratio';
  }
  const groupBy = [...new Set(data.flatMap((q) => (q.groupBy ?? [])
    .map((g) => String(g?.key ?? g?.name ?? g))
    .map((k) => (k === 'name' ? 'operation' : k))))];
  return { title: widget?.title ?? '', metric, aggregation, groupBy, filters };
}

// True when any query in the widget filters on one of the given services.
export function widgetMentions(widget, services) {
  const { data } = queriesOf(widget);
  return data.some((q) => {
    const text = filterText(q);
    return services.some((s) => text.includes(s));
  });
}
