// Build-test helper for box-office-estate (module 07, lab 07-hackathon-two-worlds).
//
// Shows that the gate checks verify.sh runs fail when the telemetry is wrong.
// Starts from a passing export recorded from a real purchase on
// gate-c-reference (test/fixtures/export-gate-c.json, written by
// build-test.sh live), puts in one fault at a time, runs the checker as
// verify.sh does, and compares the gate lines and exit status with what the
// fault must produce. Prints one line per case: "ok <case>" or
// "WRONG <case>: <what came out>". Exits 1 if any case is wrong.
//
// Usage: node genuine.mjs <gate-checks.mjs> <export.json>
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const [checker, exportFile] = process.argv.slice(2);
const base = JSON.parse(readFileSync(exportFile, 'utf8'));
const copy = () => JSON.parse(JSON.stringify(base));
const dir = mkdtempSync(join(tmpdir(), 'boe-genuine-'));

// Each case: a fault, then the substring each gate line must contain.
const CASES = {
  'recorded purchase, unchanged': {
    fault: (e) => e,
    expect: { A: 'PASS', B: 'PASS', C: 'PASS', D: 'PASS' },
  },
  'payments-sim missing': {
    fault: (e) => {
      e.spans = e.spans.filter((s) => s.serviceName !== 'payments-sim');
      e.logRecords = e.logRecords.filter((r) => r.service_name !== 'payments-sim');
      return e;
    },
    expect: { A: 'no correlation_id carries records from both orders-api and payments-sim', B: 'PASS', C: 'payments-sim absent from the purchase trace', D: 'PASS' },
  },
  'payments-sim span has no parent': {
    fault: (e) => { for (const s of e.spans) if (s.serviceName === 'payments-sim') s.parentSpanId = null; return e; },
    expect: { A: 'PASS', B: 'PASS', C: 'the extracted context was never made active', D: 'PASS' },
  },
  'seatmap lines without trace context': {
    fault: (e) => { for (const r of e.logRecords) if (r.service_name === 'seatmap') { delete r.trace_id; delete r.span_id; } return e; },
    expect: { A: 'seatmap log record(s) with no trace_id', B: 'no seatmap log record carries a trace id from orders-api', C: 'PASS', D: 'PASS' },
  },
  'card number and email in a log body': {
    fault: (e) => {
      const r = e.logRecords.find((x) => x.service_name === 'orders-api');
      r.body = `${r.body} {"customer":{"email":"buyer@example.test"},"payment":{"card_number":"4111 1111 1111 1111"}}`;
      return e;
    },
    expect: { A: 'card number present in a log body', B: 'PASS', C: 'PASS', D: 'PASS' },
  },
  'two traces for one purchase': {
    fault: (e) => { for (const s of e.spans) if (s.serviceName === 'payments-sim') s.traceId = 'f'.repeat(32); return e; },
    expect: { A: 'PASS', B: 'PASS', C: 'one purchase produced 2 traces; expected 1', D: 'PASS' },
  },
  'no dashboard': {
    fault: (e) => { e.dashboard = { name: null, panels: [] }; return e; },
    expect: { A: 'PASS', B: 'PASS', C: 'PASS', D: 'dashboard has 0 panel(s); the journey needs 3' },
  },
  'latency panel not split by outcome': {
    fault: (e) => {
      const p = e.dashboard.panels.find((x) => /duration|latency/i.test(x.metric));
      p.groupBy = p.groupBy.filter((g) => !/status|outcome|error/i.test(g));
      p.filters = [];
      return e;
    },
    expect: { A: 'PASS', B: 'PASS', C: 'PASS', D: 'latency panel is not split by outcome' },
  },
  'no purchase at all': {
    fault: (e) => ({ ...e, purchase: { correlationId: null, traceIds: [] }, logRecords: [], spans: [] }),
    expect: { A: 'no log records in the export', B: 'no spans reported by orders-api', C: 'one purchase produced 0 traces; expected 1', D: 'PASS' },
  },
};

let wrong = 0;
for (const [name, { fault, expect }] of Object.entries(CASES)) {
  const file = join(dir, 'export.json');
  writeFileSync(file, JSON.stringify(fault(copy())));
  const run = spawnSync(process.execPath, [checker, file], { encoding: 'utf8' });
  const lines = Object.fromEntries(run.stdout.trim().split('\n').map((l) => [l.slice(5, 6), l]));
  const allPass = Object.values(expect).every((v) => v === 'PASS');
  const problems = [];
  for (const [gate, want] of Object.entries(expect)) {
    const line = lines[gate] ?? '(no line)';
    const ok = want === 'PASS' ? line === `GATE ${gate} PASS` : line.startsWith(`GATE ${gate} FAIL: `) && line.includes(want);
    if (!ok) problems.push(line);
  }
  if (run.status !== (allPass ? 0 : 1)) problems.push(`exit status ${run.status}`);
  if (problems.length) { wrong += 1; console.log(`WRONG ${name}: ${problems.join(' | ')}`); } else console.log(`ok ${name}`);
}
process.exit(wrong ? 1 : 0);
