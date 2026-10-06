// storefront: the container's process (obs-sample-estate, all stages).
//
// Serves the built React app (`dist/`, from `vite build`) on port 5173 and
// passes every /api request to checkout-api unchanged: method, path, query,
// headers and body go through as they arrived, and checkout-api's status,
// headers (including x-correlation-id from lab 02 on) and body come back. It
// adds no header of its own, so checkout-api sees only what the browser sent.
// Serving a static build rather than a Vite dev server keeps hot-reload
// sockets out of the hosted lab proxy and needs no allowedHosts setting.
//
// It also starts background.mjs: the browsing traffic and the health probe
// lab 01's log excerpt shows arriving from one client address.
//
// Node built-ins only.
import { createServer, request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { startBackground } from './background.mjs';

const PORT = Number(process.env.PORT ?? 5173);
const API = new URL(process.env.CHECKOUT_API_URL ?? 'http://checkout-api:3000');
const DIST = new URL('./dist/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

const log = (level, event, msg, fields = {}) =>
  process.stdout.write(`${JSON.stringify({ level, time: new Date().toISOString(), service_name: 'storefront', event, ...fields, msg })}\n`);

function proxy(req, res) {
  const headers = { ...req.headers, host: API.host };
  const upstream = request({ hostname: API.hostname, port: API.port, method: req.method, path: req.url, headers }, (up) => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  upstream.on('error', (err) => {
    log('warn', 'proxy.upstream_failed', 'checkout-api did not answer', { path: req.url.split('?')[0], error: err.code ?? err.message });
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'checkout_api_unavailable' }));
  });
  req.pipe(upstream);
}

async function serveStatic(req, res) {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  if (!file.startsWith(DIST) || path === '/' || !extname(path)) file = join(DIST, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': body.length });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}

const server = createServer((req, res) => {
  if (req.url === '/api' || req.url.startsWith('/api/')) {
    proxy(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  log('info', 'service.started', 'storefront listening', { port: PORT, checkout_api: API.origin });
  startBackground(API);
});

process.once('SIGTERM', () => {
  server.close();
  server.closeAllConnections();
  process.exit(0);
});
