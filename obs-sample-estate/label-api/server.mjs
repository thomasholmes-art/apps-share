// label-api: the courier's label service (obs-sample-estate; first used by
// lab 05, where dispatch-worker calls it).
//
// A supplier's service, not one of the estate's four processes, so it is
// defined in lab 05's `docker-compose.dispatch.yml` rather than in the
// estate's own compose file. Its behaviour is fixed, because lab 05's trace
// and module 06's worked example 4 read figures from it:
//
//   POST /labels   per order (`orderId` in the body), attempts 1 and 2
//                  answer 503 and attempt 3 onwards answers 200 with a label.
//                  Every answer takes 29-34 ms and never more than a second.
//   GET /healthz   200 "ok".
//
// With label-client.mjs's defaults (3 attempts, 400 ms backoff) that gives
// `dispatch.create_label` of about 900 ms, of which about 94 ms is on the
// wire. Node built-ins only.
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 9100);
const FORGET_MS = 5_000;
const attempts = new Map();
let issued = 0;

const between = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const logLine = (fields) => process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), service_name: 'label-api', ...fields })}\n`);

function reply(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (req.method !== 'POST' || req.url !== '/labels') {
    reply(res, 404, { error: 'not_found' });
    return;
  }
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    let orderId = 'unknown';
    try {
      orderId = JSON.parse(raw).orderId ?? 'unknown';
    } catch {
      // An unreadable body is still answered; the order key falls back.
    }
    // An order's attempt count is forgotten after FORGET_MS (5 s) without a
    // call. One job's retries are 400 ms apart, and checkout-api numbers
    // orders from 0001 again after a restart, so a reused order id starts
    // from attempt 1 rather than being answered 200 first time.
    const seen = attempts.get(orderId);
    const attempt = seen && Date.now() - seen.at < FORGET_MS ? seen.attempt + 1 : 1;
    attempts.delete(orderId);
    attempts.set(orderId, { attempt, at: Date.now() });
    if (attempts.size > 10_000) attempts.delete(attempts.keys().next().value);
    setTimeout(() => {
      if (attempt < 3) {
        logLine({ level: 'warn', event: 'label.busy', order_id: orderId, attempt, status: 503, msg: 'label queue busy' });
        reply(res, 503, { error: 'label_service_busy', retry_after_ms: 400 });
        return;
      }
      issued += 1;
      logLine({ level: 'info', event: 'label.issued', order_id: orderId, attempt, status: 200, msg: 'label issued' });
      reply(res, 200, { id: `lbl_${String(issued).padStart(5, '0')}`, carrier: 'royal-mail', service: 'tracked-48' });
    }, between(29, 34));
  });
}).listen(PORT, () => logLine({ level: 'info', event: 'service.started', port: PORT, msg: 'label-api listening' }));
