// checkout-api, module 01 build (stage 01 of obs-sample-estate).
//
// The HTTP call to inventory's POST /reserve, with the `inventory->` and
// `inventory<-` lines from the lab 01 excerpt. The reply line shows only the
// `reservations` key, as the excerpt does. The timeout default and its
// start-up warning are the `[warn] config:` line.
'use strict';

const { line, bare } = require('./print.js');

const URL_ = process.env.INVENTORY_URL ?? 'http://inventory:3001/reserve';
const TIMEOUT_MS = Number(process.env.INVENTORY_TIMEOUT_MS ?? 2000);

function warnIfDefaulted() {
  if (process.env.INVENTORY_TIMEOUT_MS === undefined) {
    bare('[warn] config: INVENTORY_TIMEOUT_MS not set, using default 2000');
  }
}

async function reserve(basket) {
  const n = basket.lines.length;
  line(`inventory-> POST ${new URL(URL_).pathname} (${n} line(s))`);
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(basket),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const reply = await res.json();
  line(`inventory<- ${res.status} ${JSON.stringify({ reservations: reply.reservations })}`);
  return reply;
}

module.exports = { reserve, warnIfDefaulted };
