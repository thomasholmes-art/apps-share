// checkout-api, module 01 build (stage 01 of obs-sample-estate).
//
// An in-memory session store with a 1800-second TTL. It prints raw session
// ids (`sid=sess_a19f`), which lab 01 stretch 3 identifies as a value that
// must never be logged; stage 02 logs a hash instead.
'use strict';

const { randomBytes } = require('node:crypto');
const { line } = require('./print.js');

const TTL_S = 1800;
const store = new Map();

function create() {
  const sid = `sess_${randomBytes(2).toString('hex')}`;
  store.set(sid, { expires: Date.now() + TTL_S * 1000, lines: [] });
  line(`session-store: created sid=${sid} (ttl ${TTL_S}s)`);
  return sid;
}

function get(sid) {
  const s = sid && store.get(sid);
  return s && s.expires > Date.now() ? s : undefined;
}

function prune() {
  let n = 0;
  for (const [sid, s] of store) if (s.expires <= Date.now()) { store.delete(sid); n += 1; }
  line(`session-store: pruned ${n} expired sessions`);
}

module.exports = { create, get, prune, TTL_S };
