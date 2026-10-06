// checkout-api, module 01 build (stage 01 of obs-sample-estate).
//
// The print helpers every part of the module 01 build writes through. Each
// author picked a format, so this file offers several: an ISO-timestamped
// line, an untimestamped line, a clock-time line for the health logger and an
// Apache "combined" access line. None of them carries a request identifier,
// which is the condition lab 01 investigates. Stage 02 replaces all of this
// with the pino logger from lab 02.
'use strict';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n, w = 2) => String(n).padStart(w, '0');

function iso() {
  return new Date().toISOString();
}

// `<ISO> <text>`: the most common shape in the lab 01 excerpt.
function line(text) {
  process.stdout.write(`${iso()} ${text}\n`);
}

// No timestamp and no severity: the mismatch line and the config warning.
function bare(text) {
  process.stdout.write(`${text}\n`);
}

// `HH:MM:SS GET /healthz 200 1ms`: the health logger's own format.
function clock(text) {
  const d = new Date();
  process.stdout.write(`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${text}\n`);
}

// `<epoch-ms> <text>`: the garbage-collection reporter's format.
function epoch(text) {
  process.stdout.write(`${Date.now()} ${text}\n`);
}

function clientAddress(req) {
  const addr = req.socket?.remoteAddress ?? '-';
  return addr.includes(':') ? addr : `::ffff:${addr}`;
}

function combinedDate(d) {
  return `${pad(d.getUTCDate())}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}:` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

// Access middleware. `/healthz` goes to the health logger instead, so the
// combined log never shows it. Both write when the response has finished.
function accessLog(req, res, next) {
  const started = process.hrtime.bigint();
  const at = new Date();
  res.on('finish', () => {
    if (req.path === '/healthz') {
      const ms = Math.max(1, Math.round(Number(process.hrtime.bigint() - started) / 1e6));
      clock(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
      return;
    }
    const bytes = res.getHeader('content-length') ?? '-';
    const referrer = req.headers.referer ?? '-';
    const agent = req.headers['user-agent'] ?? '-';
    bare(`${clientAddress(req)} - - [${combinedDate(at)}] "${req.method} ${req.originalUrl} HTTP/${req.httpVersion}" ` +
      `${res.statusCode} ${bytes} "${referrer}" "${agent}"`);
  });
  next();
}

module.exports = { iso, line, bare, clock, epoch, accessLog };
