// checkout-api: entry point of the structured build (obs-sample-estate,
// stage 02 onwards; modules and labs 02 to 06).
//
// Started by `node src/server.js`, or from lab 03 on by
// `node --import ./instrumentation.mjs src/server.js`. It wires the files the
// labs own into the running service and keeps everything else in files that
// no lab edits:
//
//   lab 02 owns   checkout.js, correlation.js, logger.js, dispatch-queue.js
//   lab 03 owns   reserve-stock.mjs (and ../instrumentation.mjs)
//   lab 04 owns   dispatch-publisher.mjs (swapped in by `bin/stage 04` and 05)
//   lab 05 owns   dispatch-queue.js again (the trace-context envelope)
//
// Three behaviours of the sample application live here rather than in a lab
// file:
//
// 1. Every non-checkout route writes structured events (`http.request` when
//    the response finishes, `catalog.cache_miss`, `session.created`, ...), so
//    lab 02's learners change only the checkout path.
// 2. The inventory call goes through lab 03's `reserveStock(basket, url)`.
//    That function sends only `content-type`, so this file wraps the global
//    `fetch` for requests to INVENTORY_URL: it adds the headers checkout.js
//    passed to `deps.inventory.reserve` (from `outboundHeaders()`, so the
//    correlation id reaches inventory exactly when lab 02's task 3a is done)
//    and reads a clone of the reply, without changing the body the caller
//    receives.
// 3. From that reply it sets `reserve.shortfall` (`none`, `stock_absent`,
//    `stock_present`) on the HTTP server span of POST /api/checkout, and it
//    sets `correlation_id` on the server span of every request. Inside an
//    Express handler the active span is a handler span, so the server span is
//    taken from the RPC metadata the http instrumentation stores. Both are
//    no-ops until lab 03 loads the SDK. Lab 06 reads `reserve.shortfall` as a
//    span-metrics label.
import express from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { context, trace } from '@opentelemetry/api';
import { getRPCMetadata } from '@opentelemetry/core';
import { logger } from './logger.js';
import { withCorrelationId, log, correlationId } from './correlation.js';
import { handleCheckout } from './checkout.js';
import { reserveStock } from './reserve-stock.mjs';
import { createBroker } from './broker-client.mjs';
import { createPublisher } from './dispatch-publisher.mjs';
import * as catalog from './catalog.js';
import * as sessions from './sessions.js';
import * as background from './background.js';
import { search } from './search.js';

const PORT = Number(process.env.PORT ?? 3000);
const INVENTORY_URL = process.env.INVENTORY_URL ?? 'http://inventory:3001/reserve';

// Per-request state: the server span, the headers checkout.js asked
// for on the inventory call, and the parsed inventory reply.
const estate = new AsyncLocalStorage();

function classifyShortfall(reply) {
  const unreserved = reply?.unreserved ?? [];
  if (unreserved.length === 0) return 'none';
  return unreserved.some((l) => (l.on_hand ?? 0) < l.requested) ? 'stock_absent' : 'stock_present';
}

const realFetch = globalThis.fetch;
globalThis.fetch = async function estateFetch(input, init = {}) {
  const state = estate.getStore();
  if (!state || String(input) !== INVENTORY_URL) return realFetch(input, init);
  const headers = { ...(state.outboundHeaders ?? {}), ...(init.headers ?? {}) };
  const res = await realFetch(input, { ...init, headers });
  state.inventoryReply = await res.clone().json().catch(() => undefined);
  if (state.inventoryReply) state.serverSpan?.setAttribute('reserve.shortfall', classifyShortfall(state.inventoryReply));
  return res;
};

let orderDay = '';
let orderCounter = 0;
function nextOrderId() {
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  if (today !== orderDay) {
    orderDay = today;
    orderCounter = 0;
  }
  orderCounter += 1;
  return `ord_${today}_${String(orderCounter).padStart(4, '0')}`;
}

const broker = createBroker();
const publisher = createPublisher({ broker, tracer: trace.getTracer('checkout-api') });

const deps = {
  inventory: {
    async reserve(basket, headers) {
      const state = estate.getStore();
      if (state) state.outboundHeaders = headers;
      const reservations = await reserveStock(basket, INVENTORY_URL);
      return { reservations };
    },
  },
  transport: {
    send: (message) => publisher.publish(message.queue, message),
  },
  nextOrderId,
};

const app = express();
app.disable('x-powered-by');

app.use(withCorrelationId);

app.use((req, res, next) => {
  const serverSpan = getRPCMetadata(context.active())?.span;
  const id = correlationId();
  if (serverSpan && id) serverSpan.setAttribute('correlation_id', id);
  estate.run({ serverSpan }, next);
});

// The access event. The logger is captured here, inside the request's
// context, because a `finish` callback does not reliably keep it.
app.use((req, res, next) => {
  const reqLog = log();
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    reqLog.info(
      {
        event: 'http.request',
        method: req.method,
        route: req.route ? `${req.baseUrl}${req.route.path}` : req.path,
        status: res.statusCode,
        bytes: Number(res.getHeader('content-length') ?? 0),
        duration_ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
      },
      'request served',
    );
  });
  next();
});

app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    service: 'checkout-api',
    routes: ['GET /healthz', 'GET /api/catalog?page=N', 'GET /api/basket', 'GET /api/search?q=&currency=GBP', 'POST /api/checkout'],
  });
});

app.get('/healthz', (req, res) => {
  res.type('text/plain').send('ok');
});

app.get('/api/catalog', async (req, res) => {
  res.type('application/json').send(await catalog.getPage(req.query.page));
});

app.get('/api/basket', (req, res) => {
  let sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  if (!sessions.get(sid)) {
    sid = sessions.create();
    res.setHeader('set-cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessions.TTL_S}`);
  }
  const lines = sessions.get(sid).lines;
  res.json({ lines, item_count: lines.length, currency: 'GBP', subtotal_minor: 0, shipping_minor: 0 });
});

app.get('/api/search', async (req, res) => {
  const requestTime = new Date().toISOString();
  res.json(await search(req.query.q, req.query.currency ?? 'GBP', requestTime));
});

app.post('/api/checkout', async (req, res) => {
  estate.getStore()?.serverSpan?.setAttribute('reserve.shortfall', 'none');
  await handleCheckout(req, res, deps);
});

logger.info({ event: 'config.loaded', source: 'env', log_level: logger.level }, 'configuration loaded');
if (typeof publisher.warm === 'function') {
  const connections = await publisher.warm();
  logger.info({ event: 'queue.pool_warmed', queue: 'dispatch', connections }, 'publisher pool ready');
}

const server = app.listen(PORT, () => {
  logger.info({ event: 'service.started', port: PORT, node: process.version }, 'checkout-api listening');
  background.start();
});

process.once('SIGTERM', () => {
  server.close();
  server.closeAllConnections();
  publisher.close?.().catch(() => {});
  setTimeout(() => process.exit(0), 3000).unref();
});
