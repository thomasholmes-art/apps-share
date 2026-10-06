// The contract for lab 02. These assertions are the acceptance criteria in
// executable form; they fail against the starter and pass against a finished
// implementation. Run them with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Point the logger at a file before anything imports it, so the records can be
// read back and inspected.
const logFile = join(mkdtempSync(join(tmpdir(), 'checkout-log-')), 'out.jsonl');
process.env.LOG_FILE = logFile;
process.env.LOG_LEVEL = 'debug';

const { logger } = await import('../src/logger.js');
const { withCorrelationId, outboundHeaders, CORRELATION_HEADER } = await import(
  '../src/correlation.js'
);
const { handleCheckout } = await import('../src/checkout.js');

const fixture = JSON.parse(
  readFileSync(join(here, 'fixtures', 'checkout-request.json'), 'utf8'),
);

const REQUIRED_FIELDS = ['time', 'level', 'service_name', 'correlation_id', 'event', 'msg'];

// What `randomUUID()` produces. This says what the service generates; it says
// nothing about what it is willing to accept.
const GENERATED_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function reset() {
  writeFileSync(logFile, '');
}

function records() {
  return readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function fakeRes() {
  const res = { headers: {}, statusCode: null, body: null };
  res.setHeader = (key, value) => {
    res.headers[key] = value;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

function fakeDeps(reservedSkus) {
  const calls = { http: [], queue: [] };
  return {
    calls,
    inventory: {
      reserve: async (_basket, headers) => {
        calls.http.push(headers);
        return {
          reservations: reservedSkus.map((sku, i) => ({ sku, id: `rsv_88${i + 1}` })),
        };
      },
    },
    transport: {
      send: async (message) => {
        calls.queue.push(message);
      },
    },
    nextOrderId: () => 'ord_20260914_0442',
  };
}

function runRequest({ headers = {}, reserves }) {
  reset();
  const deps = fakeDeps(reserves);
  const req = { headers, body: structuredClone(fixture.body) };
  const res = fakeRes();
  return new Promise((resolve, reject) => {
    withCorrelationId(req, res, () => {
      handleCheckout(req, res, deps)
        .then(() => resolve({ req, res, deps }))
        .catch(reject);
    });
  });
}

// The accepted set. Not every caller generates a UUID: the storefront's own
// identifiers are a prefix and a sortable timestamp-and-random string.
const WORTH_TRUSTING = [
  [fixture.inbound_correlation_id, 'a uuid from an upstream service'],
  ['sf-01J9ZK3M7Q8R2T4V', 'an identifier the storefront generated in its own shape'],
];

test('the middleware reuses a correlation id that arrived on the request', async () => {
  for (const [inbound, what] of WORTH_TRUSTING) {
    const { res } = await runRequest({
      headers: { [CORRELATION_HEADER]: inbound },
      reserves: fixture.inventory_reserves_on_success,
    });
    assert.equal(res.headers[CORRELATION_HEADER], inbound,
      `${what} must be reused, not replaced`);
    for (const record of records()) {
      assert.equal(record.correlation_id, inbound,
        'every record of this request must carry the inbound id, not a fresh one');
    }
  }
});

test('the middleware generates an id when none arrived, and echoes it on the response', async () => {
  const { res } = await runRequest({ reserves: fixture.inventory_reserves_on_success });
  const generated = res.headers[CORRELATION_HEADER];
  assert.match(generated ?? '', GENERATED_SHAPE, 'a generated id is the uuid randomUUID() returns');
  const written = records();
  assert.ok(written.length > 0, 'the request wrote no log records at all');
  for (const record of written) {
    assert.equal(record.correlation_id, generated);
  }
});

// The rejected set is the other half of the contract for task 2b. No rule is
// stated anywhere: the examples fix the boundary, and the predicate that
// separates them from the accepted set is the decision the task exists to make.
const NOT_WORTH_TRUSTING = [
  ['a"; DROP\ncheckout: forged line', 'a newline forges a second record out of one field'],
  ['x'.repeat(200), 'an unbounded value is written onto every record of the request'],
  ['a b c', 'whitespace and punctuation are not identifier characters'],
  ['ab7', 'an identifier short enough to collide identifies nothing'],
  ['abcd1234";level=fatal', 'a quote, a semicolon and an equals sign let one value forge other fields'],
];

test('an inbound id that is not worth trusting is replaced, never rejected', async () => {
  for (const [header, why] of NOT_WORTH_TRUSTING) {
    const { res } = await runRequest({
      headers: { [CORRELATION_HEADER]: header },
      reserves: fixture.inventory_reserves_on_success,
    });
    assert.notEqual(res.headers[CORRELATION_HEADER], header,
      `${why}, so this value must not become the id of the request`);
    assert.match(res.headers[CORRELATION_HEADER] ?? '', GENERATED_SHAPE,
      `${why}: the replacement is a freshly generated id, not a repaired header`);
    assert.equal(res.statusCode, 201, 'a bad header must not fail the customer checkout');
    for (const record of records()) {
      assert.equal(record.correlation_id, res.headers[CORRELATION_HEADER],
        'every record of this request carries the replacement, not the inbound value');
    }
  }
});

test('every record the request path writes carries the agreed fields', async () => {
  await runRequest({ reserves: fixture.inventory_reserves_on_success });
  const written = records();
  assert.ok(written.length >= 3, `expected at least 3 structured records, got ${written.length}`);
  for (const record of written) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(field in record, `record ${JSON.stringify(record)} is missing "${field}"`);
    }
    assert.ok(['debug', 'info', 'warn', 'error'].includes(record.level));
  }
});

test('the outbound HTTP call to inventory carries the id, and keeps its own headers', async () => {
  const { res, deps } = await runRequest({ reserves: fixture.inventory_reserves_on_success });
  assert.equal(deps.calls.http.length, 1);
  const headers = deps.calls.http[0];
  assert.equal(headers[CORRELATION_HEADER], res.headers[CORRELATION_HEADER],
    'the outbound call to inventory must carry the header');
  assert.equal(headers['content-type'], 'application/json',
    "the caller's own headers must survive, so merge rather than replace");
  assert.equal(outboundHeaders().hasOwnProperty(CORRELATION_HEADER), false,
    'outside a request there is no id to attach, so the key must be absent: a key set to undefined still counts as present');
});

test('the queue message envelope carries the id for dispatch-worker to read', async () => {
  const { res, deps } = await runRequest({ reserves: fixture.inventory_reserves_on_success });
  assert.equal(deps.calls.queue.length, 1);
  const message = deps.calls.queue[0];
  assert.equal(message.correlation_id, res.headers[CORRELATION_HEADER],
    'the queue message has no headers, so the id belongs on the envelope');
  assert.equal(message.queue, 'dispatch');
  assert.ok(message.body, 'the job payload must still be there');
});

test('the reservation shortfall is a warn event naming the missing sku', async () => {
  const { res } = await runRequest({ reserves: fixture.inventory_reserves_on_failure });
  assert.equal(res.statusCode, 500);
  const written = records();
  const shortfall = written.find((r) => r.level === 'warn');
  assert.ok(shortfall, 'the shortfall must be a warn, not an info and not an error');
  assert.equal(shortfall.requested, 3);
  assert.equal(shortfall.reserved, 2);
  assert.deepEqual(shortfall.missing_skus, ['TS-SHIRT-XL-BLK']);
  const abandoned = written.find((r) => r.level === 'error');
  assert.ok(abandoned, 'abandoning the order is the failure the customer saw, so it is an error');
});

test('the never-log fields are removed before the record is written', async () => {
  reset();
  logger.info(
    {
      event: 'test.never_log',
      session_id: 'sess_a19f',
      customer: { id: 'cus_7f31a2', email: 'buyer@example.com' },
      payment: { card_number: '4111111111111111', card_last4: '4417' },
    },
    'never-log check',
  );
  const raw = readFileSync(logFile, 'utf8');
  for (const forbidden of ['sess_a19f', 'buyer@example.com', '4111111111111111', '4417']) {
    assert.equal(raw.includes(forbidden), false, `"${forbidden}" reached the log output`);
  }
  const record = records()[0];
  assert.equal(record.customer.id, 'cus_7f31a2', 'the customer reference itself must survive');
});
