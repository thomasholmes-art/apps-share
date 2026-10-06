// Gate checks for the box-office hackathon.
//
// One expression of the four gates, used in two places:
//   - ./verify.sh in the application repository queries the SigNoz API, writes
//     telemetry-export.json in the shape documented below, and runs this file
//     against it;
//   - tests/ in this directory run the same checks against captured exports, so
//     the lab can still be completed with the application stopped.
//
// Export shape (see artefacts/export-after.json for a complete example):
//   { capturedAt, stage,       // the captures in artefacts/ name this field branch
//     purchase:    { correlationId, traceIds: [] },
//     logRecords:  [ { time, level, service_name, event, body,
//                      correlation_id,              // Node services
//                      trace_id, span_id } ],       // seatmap, from the agent's MDC
//     spans:       [ { spanId, parentSpanId, traceId, serviceName, name,
//                      startMs, durationMs, status, attributes } ],
//     dashboard:   { name, panels: [ { title, metric, aggregation, groupBy,
//                                      filters } ] } }
//
// filters is either an object of key/value pairs or an array of { key, value }.
// Both are read, because the outcome split reaches the export as a group-by
// dimension or as a filter depending on which of the two methods module 04's
// lab taught was used to build it.
//
// Two log shapes, because the two languages reach correlation differently.
// orders-api and payments-sim are Node and carry the correlation identifier
// that orders-api creates at the request edge. seatmap is Java and carries no
// hand-written logging code at all: the OpenTelemetry agent's logback-mdc
// instrumentation puts trace_id, span_id and trace_flags into the MDC, and the
// logging pattern prints them. Gate A checks each side against what it can produce on its own;
// gate B checks that the two sides meet, which is when orders-api's trace
// reaches seatmap.

export const REQUIRED_LOG_FIELDS = ['time', 'level', 'service_name', 'event'];

// Injected into seatmap's MDC by the agent, printed only if the logging
// pattern references them. trace_flags is injected too and nothing here needs it.
export const AGENT_MDC_FIELDS = ['trace_id', 'span_id'];

// A 13-to-19 digit run is also the shape of an epoch-milliseconds value and of
// an order sequence, so the candidate is Luhn-checked before it is called a
// card number. Every real primary account number satisfies Luhn.
const luhn = (digits) => {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
};

export const NEVER_EMIT = [
  {
    name: 'card number',
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    confirm: (match) => luhn(match.replace(/[^\d]/g, '')),
  },
  { name: 'card security code', pattern: /\b(?:cvv|cvc|cv2)\b\D{0,3}\d{3,4}\b/i },
  { name: 'payment token', pattern: /\b(?:tok|card|pm)_[A-Za-z0-9]{8,}\b/ },
  { name: 'email address', pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/ },
];

const ORDERS = 'orders-api';
const SEATMAP = 'seatmap';
const PAYMENTS = 'payments-sim';
const NODE_SERVICES = [ORDERS, PAYMENTS];

const emits = (rule, text) => {
  const found = text.match(rule.pattern);
  if (!found) return false;
  return rule.confirm ? found.some((m) => rule.confirm(m)) : true;
};

const result = (gate, missing) => ({ gate, pass: missing.length === 0, missing });

export function checkGateA(exp) {
  const missing = [];
  const records = exp.logRecords ?? [];
  if (records.length === 0) missing.push('no log records in the export');

  const absentIn = (rows, field) =>
    rows.filter((r) => r[field] === undefined || r[field] === '');

  for (const field of REQUIRED_LOG_FIELDS) {
    const absent = absentIn(records, field);
    if (absent.length > 0) {
      missing.push(`${absent.length} log record(s) with no ${field}`);
    }
  }

  const nodeRecords = records.filter((r) => NODE_SERVICES.includes(r.service_name));
  const absentId = absentIn(nodeRecords, 'correlation_id');
  if (absentId.length > 0) {
    missing.push(`${absentId.length} Node log record(s) with no correlation_id`);
  }

  const seatmapRecords = records.filter((r) => r.service_name === SEATMAP);
  if (seatmapRecords.length === 0) {
    missing.push(`no log records from ${SEATMAP}`);
  }
  for (const field of AGENT_MDC_FIELDS) {
    const absent = absentIn(seatmapRecords, field);
    if (absent.length > 0) {
      missing.push(
        `${absent.length} ${SEATMAP} log record(s) with no ${field}; `
        + 'the agent is not attached or the logging pattern does not reference the MDC',
      );
    }
  }

  const byId = new Map();
  for (const r of nodeRecords) {
    if (!r.correlation_id) continue;
    const services = byId.get(r.correlation_id) ?? new Set();
    services.add(r.service_name);
    byId.set(r.correlation_id, services);
  }
  const shared = [...byId.values()].some((s) => s.has(ORDERS) && s.has(PAYMENTS));
  if (!shared) {
    missing.push(`no correlation_id carries records from both ${ORDERS} and ${PAYMENTS}`);
  }

  for (const r of records) {
    const text = [r.body ?? '', ...Object.values(r).map(String)].join(' ');
    for (const rule of NEVER_EMIT) {
      if (emits(rule, text)) {
        missing.push(`${rule.name} present in a log body (event ${r.event ?? 'unnamed'})`);
      }
    }
  }
  return result('A', [...new Set(missing)]);
}

export function checkGateB(exp) {
  const missing = [];
  const spans = exp.spans ?? [];
  const services = new Set(spans.map((s) => s.serviceName));
  for (const name of [ORDERS, SEATMAP]) {
    if (!services.has(name)) missing.push(`no spans reported by ${name}`);
  }
  const ordersIds = new Set(spans.filter((s) => s.serviceName === ORDERS).map((s) => s.spanId));
  const joined = spans.some((s) => s.serviceName === SEATMAP && ordersIds.has(s.parentSpanId));
  if (!joined) missing.push(`no ${SEATMAP} span has an ${ORDERS} parent`);
  const dbSpans = spans.filter((s) => s.serviceName === SEATMAP && /select|insert|update/i.test(s.name));
  if (dbSpans.length === 0) missing.push(`no database spans under ${SEATMAP}; check the agent flag order`);

  // The cross-language join. seatmap's lines carry a trace id from the moment
  // the agent is attached; they carry the purchase's trace id only once
  // orders-api is attached too and its trace context reaches the Java service.
  const ordersTraces = new Set(
    spans.filter((s) => s.serviceName === ORDERS).map((s) => s.traceId),
  );
  const seatmapRecords = (exp.logRecords ?? []).filter((r) => r.service_name === SEATMAP);
  const logsJoined = seatmapRecords.some((r) => ordersTraces.has(r.trace_id));
  if (!logsJoined) {
    missing.push(
      `no ${SEATMAP} log record carries a trace id from ${ORDERS}; `
      + 'the Java service is logging a trace of its own',
    );
  }
  return result('B', missing);
}

export function checkGateC(exp) {
  const missing = [];
  const spans = exp.spans ?? [];
  const traceIds = new Set(spans.map((s) => s.traceId));
  if (traceIds.size !== 1) {
    missing.push(`one purchase produced ${traceIds.size} traces; expected 1`);
  }
  const services = new Set(spans.map((s) => s.serviceName));
  for (const name of [ORDERS, SEATMAP, PAYMENTS]) {
    if (!services.has(name)) missing.push(`${name} absent from the purchase trace`);
  }
  // Every span except the entry span carries a parent. Checking only the
  // payments-sim spans names the hop the learner is working on and says nothing
  // about a broken HTTP hop, so the check is on any parentless span that is not
  // the entry point.
  const orphans = spans.filter((s) => !s.parentSpanId && s.serviceName !== ORDERS);
  for (const s of orphans) {
    missing.push(s.serviceName === PAYMENTS
      ? `${PAYMENTS} span ${s.spanId} has no parent; the extracted context was never made active`
      : `${s.serviceName} span ${s.spanId} has no parent; the trace is broken at that hop`);
  }
  return result('C', missing);
}

const hasDimension = (panel, words) =>
  (panel.groupBy ?? []).some((d) => words.some((w) => d.toLowerCase().includes(w)));

// The outcome split has two shapes and both are correct, because the two
// modules that taught it taught different ones. Module 04's lab built it as two
// duplicated queries, one filtered has_error = false and one has_error = true,
// which lands in the panel's filters. SigNoz will also take status.code as a
// second group-by dimension on a single query, which is what the reference
// dashboard uses. Either produces two labelled lines per route, so either
// passes. Checking only groupBy failed a learner who had done exactly what
// module 04 taught, on a panel that was right.
const splitByOutcome = (panel) => {
  const words = ['status', 'outcome', 'error'];
  if (hasDimension(panel, words)) return true;
  const filters = panel.filters ?? {};
  const keys = Array.isArray(filters)
    ? filters.map((f) => String(f?.key ?? f?.name ?? ''))
    : Object.keys(filters);
  return keys.some((k) => words.some((w) => k.toLowerCase().includes(w)));
};

export function checkGateD(exp) {
  const missing = [];
  const panels = exp.dashboard?.panels ?? [];
  if (panels.length < 3) missing.push(`dashboard has ${panels.length} panel(s); the journey needs 3`);

  // Each panel fills at most one role. signoz_calls_total is both the error
  // ratio's denominator and the throughput metric, so without claiming a
  // matched panel the same error-rate panel would satisfy the throughput
  // check too and a dashboard with no throughput panel would pass.
  const unclaimed = [...panels];
  const claim = (pred) => {
    const i = unclaimed.findIndex(pred);
    return i === -1 ? undefined : unclaimed.splice(i, 1)[0];
  };
  const latency = claim((p) => /duration|latency/i.test(p.metric ?? ''));
  const errors = claim((p) => /error/i.test(p.metric ?? '') || /error/i.test(p.title ?? ''));
  const throughput = claim((p) => /calls|requests|throughput/i.test(p.metric ?? ''));

  if (!latency) missing.push('no latency panel');
  else {
    if (!/p95|95/.test(String(latency.aggregation ?? ''))) missing.push('latency panel is not p95');
    if (!hasDimension(latency, ['route', 'operation', 'endpoint', 'target'])) {
      missing.push('latency panel is not grouped by route; the slow route averages away');
    }
    if (!splitByOutcome(latency)) {
      missing.push('latency panel is not split by outcome; a slow failure averages with fast successes');
    }
  }
  if (!errors) missing.push('no error-rate panel');
  if (!throughput) missing.push('no throughput panel');
  return result('D', missing);
}

export function runGates(exp) {
  return [checkGateA(exp), checkGateB(exp), checkGateC(exp), checkGateD(exp)];
}

export function formatGates(gates) {
  return gates.map((g) => (g.pass
    ? `GATE ${g.gate} PASS`
    : `GATE ${g.gate} FAIL: ${g.missing.join('; ')}`)).join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const path = process.argv[2] ?? './telemetry-export.json';
  const gates = runGates(JSON.parse(readFileSync(path, 'utf8')));
  console.log(formatGates(gates));
  process.exit(gates.every((g) => g.pass) ? 0 : 1);
}
