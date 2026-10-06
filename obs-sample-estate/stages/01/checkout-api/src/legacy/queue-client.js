// checkout-api, module 01 build (stage 01 of obs-sample-estate).
//
// The module 01 dispatch-queue client. It writes each job into the spool
// directory dispatch-worker reads (one JSON file, written then renamed).
//
// It also carries lab 01's decoy: the only ERROR line in the excerpt, which is
// unrelated to the failing checkout. The client treats its connection as
// stale after 10 seconds without a publish, so the first publish after an
// idle spell fails once with EAGAIN and succeeds on the single retry 100 ms
// later. Neither line names a customer, SKU or order. Stage 02 replaces this
// client and the decoy goes with it.
'use strict';

const { mkdirSync, writeFileSync, renameSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { line } = require('./print.js');

const SPOOL = process.env.DISPATCH_SPOOL_DIR ?? '/var/spool/dispatch';
const IDLE_MS = 10_000;
const RETRY_MS = 100;
let lastPublish = 0;

for (const dir of ['tmp', 'new']) mkdirSync(join(SPOOL, dir), { recursive: true });

function write(message) {
  const name = `${Date.now()}-${randomUUID()}.json`;
  writeFileSync(join(SPOOL, 'tmp', name), JSON.stringify(message));
  renameSync(join(SPOOL, 'tmp', name), join(SPOOL, 'new', name));
}

async function publish(queue, body) {
  const stale = Date.now() - lastPublish >= IDLE_MS;
  lastPublish = Date.now();
  if (stale) {
    line(`ERROR dispatch-queue: publish failed (EAGAIN), retrying in ${RETRY_MS}ms`);
    await new Promise((r) => setTimeout(r, RETRY_MS));
    write({ queue, body });
    line('dispatch-queue: publish ok after 1 retry');
    return;
  }
  write({ queue, body });
}

module.exports = { publish };
