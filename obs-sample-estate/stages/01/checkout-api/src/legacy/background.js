// checkout-api, module 01 build (stage 01 of obs-sample-estate).
//
// The timers that put unrelated lines into the module 01 stream: the session
// prune (about every 35 s), a metrics exporter that fails to reach its
// scraper (about every 25 s), a garbage-collection report (once a minute,
// epoch-millisecond prefix, real figures from the V8 gc observer) and the
// DEP0169 deprecation warning a few seconds after start. They exist so the
// failing request has to be separated from noise, as in the lab 01 excerpt.
'use strict';

const { PerformanceObserver } = require('node:perf_hooks');
const { line, epoch } = require('./print.js');
const sessions = require('./sessions.js');

const DEP0169 = '(node:1) [DEP0169] DeprecationWarning: url.parse() behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for url.parse() vulnerabilities.';

function start() {
  setTimeout(sessions.prune, 2_000).unref();
  setInterval(sessions.prune, 35_000).unref();
  setTimeout(() => line(DEP0169), 6_000).unref();
  setInterval(() => line('metrics-scrape: read ECONNRESET'), 25_000).unref();

  let lastScavengeMs = 1;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) lastScavengeMs = Math.max(1, Math.round(entry.duration));
  }).observe({ entryTypes: ['gc'] });
  setInterval(() => {
    const heapMb = Math.round(process.memoryUsage().heapUsed / 1048576);
    epoch(`gc: scavenge ${lastScavengeMs}ms, heap ${heapMb}MB`);
  }, 60_000).unref();
}

module.exports = { start };
