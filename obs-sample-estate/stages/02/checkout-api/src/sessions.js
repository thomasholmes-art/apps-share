// checkout-api: the session store (obs-sample-estate, stage 02 onwards).
//
// Same store as the module 01 build, with module 02's never-log rule applied:
// a session id is a bearer credential, so records carry `session_ref`, the
// first 12 hex characters of its SHA-256, never the id itself
// (module 02, worked example 1).
import { createHash, randomBytes } from 'node:crypto';
import { log } from './correlation.js';

export const TTL_S = 1800;
const store = new Map();

const ref = (sid) => `sha256:${createHash('sha256').update(sid).digest('hex').slice(0, 12)}`;

export function create() {
  const sid = `sess_${randomBytes(2).toString('hex')}`;
  store.set(sid, { expires: Date.now() + TTL_S * 1000, lines: [] });
  log().info({ event: 'session.created', session_ref: ref(sid), ttl_s: TTL_S }, 'session created');
  return sid;
}

export function get(sid) {
  const s = sid && store.get(sid);
  return s && s.expires > Date.now() ? s : undefined;
}

export function prune() {
  let expired = 0;
  for (const [sid, s] of store) {
    if (s.expires <= Date.now()) {
      store.delete(sid);
      expired += 1;
    }
  }
  log().info({ event: 'session_store.pruned', expired, remaining: store.size }, 'expired sessions removed');
}
