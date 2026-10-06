// Writes telemetry-export.json for ./verify.sh. Part of box-office-estate,
// the application behind module 07, lab 07-hackathon-two-worlds.
//
// Finds the most recent purchase in SigNoz, collects its spans, its log
// records and the purchase-journey dashboard, and writes them in the shape
// gate-checks.mjs reads (see the comment at the top of that file).
// It only reads from SigNoz. It sends nothing to the application; the
// purchases are sent by verify.sh, through tools/purchase.mjs.
//
// Usage: node tools/export-telemetry.mjs [output-file]
// With VERIFY_SENT_AT_MS set to the time verify.sh sent the checked purchase,
// in milliseconds since the epoch, it waits until that purchase's telemetry
// has had time to arrive, and checks no purchase older than it.
// Diagnostics go to standard error, prefixed "verify:".
import { readFileSync, writeFileSync } from 'node:fs';
import * as signoz from './signoz.mjs';

const SERVICES = ['orders-api', 'seatmap', 'payments-sim'];
const LOOKBACK_MS = 30 * 60 * 1000;
// Log and span ingestion both land within this long of a purchase: the
// collector batches for 5 s and a late payment reply arrives about 3.6 s in.
const SETTLE_MS = 15 * 1000;
const WINDOW_BEFORE_MS = 500;
const WINDOW_AFTER_MS = 10 * 1000;

const say = (msg) => process.stderr.write(`verify: ${msg}\n`);
const hhmmss = (ms) => new Date(ms).toISOString().slice(11, 19);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { eq, and, contains } = signoz.filters;

// ---------------------------------------------------------------------------
// seatmap's lines are text in whatever layout the logback pattern gives them.

const SEATMAP_LOGGER = /(?:^|\s)(c\.d\.s\.[\w$.]+|com\.decoded\.seatmap(?:\.[\w$]+)+)\s*(.*)$/;
const EVENT_NAMES = [
  [/^holds released\b/i, 'hold.released'],
  [/^hold granted\b/i, 'hold.granted'],
  [/^hold requested\b/i, 'hold.requested'],
  [/^hold refused\b/i, 'hold.refused'],
  [/^availability returned\b/i, 'availability.returned'],
  [/^availability requested\b/i, 'availability.requested'],
];

export function parseSeatmapLine(body) {
  const logger = body.match(SEATMAP_LOGGER);
  if (!logger) return null;
  const message = logger[2].replace(/^[\s:|-]+/, '').trim();
  const level = body.match(/\b(TRACE|DEBUG|INFO|WARN|ERROR)\b/)?.[1];
  const trace = body.match(/\b[0-9a-f]{32}\b/);
  let spanId;
  if (trace) spanId = body.slice(trace.index + 32).match(/\b[0-9a-f]{16}\b/)?.[0];
  const named = EVENT_NAMES.find(([re]) => re.test(message));
  const event = named ? named[1] : message.split(/\s+/).slice(0, 2).join('.').toLowerCase().replace(/[^a-z.]/g, '');
  return { level, trace_id: trace?.[0], span_id: spanId, body: message, event };
}

const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// A record that came from a JSON line has its keys as attributes.
const structured = (r) => r.attributes.event !== undefined || r.attributes.msg !== undefined;

// `line` is the whole line as the service wrote it. The gate A never-emit
// check reads every value of a record, so a card number or email address
// logged under any key is found, not only one in the message.
function nodeRecord(r) {
  const a = r.attributes;
  return compact({
    time: a.time ?? new Date(r.timeMs).toISOString(),
    level: a.level,
    service_name: a.service_name ?? r.serviceName,
    event: a.event,
    correlation_id: a.correlation_id,
    trace_id: a.trace_id ?? r.traceId,
    span_id: a.span_id ?? r.spanId,
    body: a.msg ?? r.body,
    line: r.body,
  });
}

function seatmapRecord(r) {
  const parsed = parseSeatmapLine(r.body);
  if (!parsed) return null;
  return compact({
    time: new Date(r.timeMs).toISOString(),
    level: parsed.level,
    service_name: 'seatmap',
    event: parsed.event,
    trace_id: parsed.trace_id,
    span_id: parsed.span_id,
    body: parsed.body,
  });
}

// ---------------------------------------------------------------------------
// Purchase anchor (spec 5.3, rule 2): the latest orders-api POST /orders root
// span, the latest structured order.received record, and the latest legacy
// "new order" line. The newest of the three is the purchase; when a span and a
// record belong to the same purchase, the span is used. Taking the span first
// regardless of age would check an older instrumented purchase in place of a
// newer one made after the SDK was detached, and could pass a gate that the
// newer purchase fails.
const SAME_PURCHASE_MS = 2000;

const isPurchaseRoot = (s) => !s.parentSpanId
  && (s.name === 'POST /orders' || (s.attributes['http.route'] === '/orders'
    && /post/i.test(String(s.attributes['http.request.method'] ?? s.attributes['http.method'] ?? s.name))));

async function findAnchor(now) {
  const range = { start: now - LOOKBACK_MS, end: now };
  const byName = await signoz.spans({ ...range, filter: and(eq('service.name', 'orders-api'), eq('name', 'POST /orders')), limit: 50 });
  const byRoute = await signoz.spans({ ...range, filter: and(eq('service.name', 'orders-api'), eq('http.route', '/orders')), limit: 50 });
  const roots = [...byName, ...byRoute].filter(isPurchaseRoot).sort((x, y) => y.startMs - x.startMs);
  const received = await signoz.logs({ ...range, filter: and(eq('service.name', 'orders-api'), eq('event', 'order.received')), limit: 1 });
  const legacy = await signoz.logs({ ...range, filter: and(eq('service.name', 'orders-api'), contains('body', 'orders: new order')), limit: 1 });

  // In order of preference.
  const candidates = [
    roots[0] && { kind: 'span', timeMs: roots[0].startMs, root: roots[0], traceIds: [roots[0].traceId] },
    received[0] && { kind: 'event', timeMs: received[0].timeMs, correlationId: received[0].attributes.correlation_id ?? null, traceIds: [] },
    legacy[0] && { kind: 'text', timeMs: legacy[0].timeMs, correlationId: null, traceIds: [] },
  ].filter(Boolean);
  if (candidates.length === 0) return null;
  const newest = Math.max(...candidates.map((c) => c.timeMs));
  return candidates.find((c) => c.timeMs >= newest - SAME_PURCHASE_MS);
}

async function assemble(anchor) {
  if (!anchor) {
    return { purchase: { correlationId: null, traceIds: [] }, logRecords: [], spans: [] };
  }
  const W = { start: anchor.timeMs - WINDOW_BEFORE_MS, end: anchor.timeMs + WINDOW_AFTER_MS };

  // Spans: the purchase's trace, plus every payments-sim root span that
  // starts inside the window, with its trace (spec 5.3, rule 3).
  const traceIds = new Set(anchor.traceIds);
  const workerRoots = (await signoz.spans({ ...W, filter: eq('service.name', 'payments-sim'), limit: 200 }))
    .filter((s) => !s.parentSpanId && s.startMs >= W.start && s.startMs <= W.end);
  for (const s of workerRoots) traceIds.add(s.traceId);
  const spanRange = { start: W.start - 60000, end: W.end + 60000 };
  let spans = [];
  for (const id of traceIds) {
    spans.push(...await signoz.spans({ ...spanRange, filter: eq('trace_id', id), limit: 5000 }));
  }
  const seen = new Set();
  spans = spans.filter((s) => (seen.has(s.spanId) ? false : seen.add(s.spanId)));
  const origin = anchor.root?.startMs ?? anchor.timeMs;
  const exportSpans = spans
    .sort((x, y) => x.startMs - y.startMs)
    .map((s) => ({
      spanId: s.spanId,
      parentSpanId: s.parentSpanId,
      traceId: s.traceId,
      serviceName: s.serviceName,
      name: s.name,
      startMs: Math.round(s.startMs - origin),
      durationMs: Math.round(s.durationMs),
      status: s.status,
      attributes: s.attributes,
    }));

  // Log records inside the window, from the three services (rule 5).
  const records = (await signoz.logs({ ...W, filter: signoz.filters.in('service.name', SERVICES), limit: 5000, direction: 'asc' }))
    .filter((r) => r.timeMs >= W.start && r.timeMs <= W.end)
    .sort((x, y) => x.timeMs - y.timeMs);
  const orders = records.filter((r) => r.serviceName === 'orders-api');

  let correlationId = anchor.correlationId ?? null;
  if (anchor.kind === 'span') {
    const purchaseTrace = anchor.traceIds[0];
    const carrying = orders.find((r) => structured(r) && r.attributes.correlation_id
      && (r.attributes.trace_id === purchaseTrace || r.traceId === purchaseTrace));
    const first = orders.find((r) => r.attributes.event === 'order.received' && r.attributes.correlation_id);
    correlationId = carrying?.attributes.correlation_id ?? first?.attributes.correlation_id ?? null;
  }

  const logRecords = [];
  for (const r of records) {
    if (r.serviceName === 'orders-api') {
      if (structured(r)) {
        if (correlationId && r.attributes.correlation_id === correlationId) logRecords.push(nodeRecord(r));
      } else if (anchor.kind === 'text' && /\borders: /.test(r.body)) {
        logRecords.push({ time: new Date(r.timeMs).toISOString(), body: r.body.replace(/^\S+Z\s+/, '') });
      }
    } else if (r.serviceName === 'payments-sim') {
      logRecords.push(structured(r) ? nodeRecord(r) : compact({ time: new Date(r.timeMs).toISOString(), service_name: 'payments-sim', body: r.body }));
    } else if (r.serviceName === 'seatmap') {
      const rec = seatmapRecord(r);
      if (rec) logRecords.push(rec);
    }
  }

  return { purchase: { correlationId, traceIds: anchor.traceIds }, logRecords, spans: exportSpans };
}

// Gate D (spec 5.4): the most recently updated dashboard with a widget that
// filters on one of this application's services.
async function dashboard() {
  const all = await signoz.dashboards();
  const candidates = all
    .filter((d) => d.widgets.some((w) => signoz.widgetMentions(w, SERVICES)))
    .sort((x, y) => y.updatedMs - x.updatedMs);
  if (candidates.length === 0) {
    say('no dashboard filters on orders-api, seatmap or payments-sim');
    return { name: null, panels: [] };
  }
  const chosen = candidates[0];
  say(`dashboard checked: "${chosen.name}"`);
  return { name: chosen.name, panels: chosen.widgets.map(signoz.normaliseWidget) };
}

// The rollback point bin/stage last applied (start, a, b or c), read from the
// .stage file it writes. verify.sh runs this from the application directory.
function stage() {
  try {
    return readFileSync('.stage', 'utf8').trim() || 'start';
  } catch {
    return 'start';
  }
}

function cannotCheck(reason) {
  for (const gate of ['A', 'B', 'C', 'D']) {
    console.log(`GATE ${gate} FAIL: ${reason}, so this gate cannot be checked; the offline route is in the README`);
  }
  process.exit(1);
}

async function main() {
  const output = process.argv[2] ?? 'telemetry-export.json';
  if (!(await signoz.answering())) cannotCheck(`SigNoz is not answering on ${new URL(signoz.SIGNOZ.baseUrl).host}`);

  try {
    const sentAt = Number(process.env.VERIFY_SENT_AT_MS ?? 0);
    if (sentAt > 0 && Date.now() - sentAt < SETTLE_MS) {
      say('waiting for telemetry from the checked purchase');
      await sleep(SETTLE_MS - (Date.now() - sentAt));
    }
    let anchor = await findAnchor(Date.now());
    if (anchor && Date.now() - anchor.timeMs < SETTLE_MS) {
      if (!sentAt) say(`waiting for telemetry from the purchase at ${hhmmss(anchor.timeMs)}`);
      await sleep(SETTLE_MS - (Date.now() - anchor.timeMs));
      anchor = await findAnchor(Date.now());
    }
    // A newest purchase older than the checked one means orders-api
    // reported nothing for the checked purchase. Checking the older one
    // could pass a gate that the current build fails.
    if (anchor && sentAt > 0 && anchor.timeMs < sentAt - SAME_PURCHASE_MS) {
      say(`orders-api reported nothing for the purchase sent at ${hhmmss(sentAt)} UTC; the newest purchase in SigNoz is from ${hhmmss(anchor.timeMs)} UTC and is not checked`);
      anchor = null;
    } else if (anchor) {
      say(`purchase checked: ${hhmmss(anchor.timeMs)} UTC, found by ${
        { span: 'its POST /orders span', event: 'its order.received record', text: 'its "new order" line' }[anchor.kind]}`);
    } else {
      say('no purchase in the last 30 minutes');
    }
    const found = await assemble(anchor);
    if (found.purchase.correlationId) say(`correlation_id: ${found.purchase.correlationId}`);
    if (found.purchase.traceIds.length) say(`trace: ${found.purchase.traceIds.join(', ')}`);
    const exp = {
      capturedAt: new Date().toISOString(),
      stage: stage(),
      ...found,
      dashboard: await dashboard(),
    };
    writeFileSync(output, `${JSON.stringify(exp, null, 2)}\n`);
  } catch (err) {
    say(String(err?.message ?? err));
    cannotCheck('SigNoz did not answer the telemetry query');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
