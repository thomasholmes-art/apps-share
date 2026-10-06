// checkout-api, module 01 build: entry point (stage 01 of obs-sample-estate,
// backing module 01 and lab 01).
//
// Started by `node src/server.js` from docker-compose.yml. Everything this
// build writes is a print-style line in whichever format its author chose;
// nothing identifies the request a line belongs to. That is the starting
// condition for lab 01. `bin/stage 02` replaces this file, and the rest of the
// module 01 build under `src/legacy/`, with the structured build lab 02 starts
// from.
//
// This directory is CommonJS (see `src/package.json`) so that stack traces
// print plain `/app/src/...` paths, as the lab 01 excerpt shows.
'use strict';

const express = require('express');
const { line, accessLog } = require('./legacy/print.js');
const catalog = require('./legacy/catalog.js');
const sessions = require('./legacy/sessions.js');
const background = require('./legacy/background.js');
const inventory = require('./legacy/inventory-client.js');
const { search } = require('./legacy/search.js');
const { mountCheckout } = require('./checkout.js');

const PORT = Number(process.env.PORT ?? 3000);
const ENV = process.env.APP_ENV ?? 'lab';
const BUILD = process.env.BUILD_ID ?? 'local';

const app = express();
app.disable('x-powered-by');
app.use(accessLog);
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

function sessionFrom(req) {
  const match = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '');
  return match?.[1];
}

app.get('/api/basket', (req, res) => {
  let sid = sessionFrom(req);
  if (!sessions.get(sid)) {
    sid = sessions.create();
    res.setHeader('set-cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessions.TTL_S}`);
  }
  const lines = sessions.get(sid).lines;
  const body = JSON.stringify({ lines, item_count: lines.length, currency: 'GBP', subtotal_minor: 0, shipping_minor: 0, note: 'basket is held in the browser; this summary is the server copy' });
  res.type('application/json').send(body.padEnd(412));
});

app.get('/api/search', async (req, res) => {
  res.json(await search(req.query.q, req.query.currency ?? 'GBP'));
});

mountCheckout(app);

app.listen(PORT, () => {
  line(`checkout-api listening on :${PORT} (env=${ENV}, build=${BUILD})`);
  inventory.warnIfDefaulted();
  background.start();
});
