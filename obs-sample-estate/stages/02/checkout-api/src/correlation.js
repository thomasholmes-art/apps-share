// The correlation ID: created at the edge of this service, carried on every log
// record the request writes, and forwarded on every call the request makes.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';

export const CORRELATION_HEADER = 'x-correlation-id';

// An inbound header is attacker-controlled input that ends up written onto
// every log record for this request (CWE-117, log injection).
export function acceptable(inbound) {
  // TASK 2b: decide what this service is willing to write onto every record of
  // a request. Return true for a value worth reusing and false for one that is
  // not. The rejected examples in tests/logging.test.js are the contract; no
  // rule is given, because the rule is the decision.
  return true;
}

const store = new AsyncLocalStorage();

// Express middleware, registered before every route so that no line written
// during this request is missing the identifier.
export function withCorrelationId(req, res, next) {
  // TASK 2a: whatever arrived on the request is reused here without being
  // looked at, so a forged header writes itself onto every record this request
  // produces. Keep the generate-if-absent rule and put `acceptable` in front of
  // it, so a value that is not worth trusting is replaced rather than rejected.
  const inbound = req.headers?.[CORRELATION_HEADER];
  const correlationId = inbound ?? randomUUID();

  res.setHeader(CORRELATION_HEADER, correlationId);
  const log = logger.child({ correlation_id: correlationId });
  store.run({ correlationId, log }, next);
}

// The per-request logger. Falls back to the bare logger outside a request, so
// start-up lines still get written.
export function log() {
  return store.getStore()?.log ?? logger;
}

export function correlationId() {
  return store.getStore()?.correlationId;
}

// TASK 3a: an outbound HTTP call currently carries nothing that identifies the
// request that caused it. Add the header, and leave the caller's own headers
// alone.
export function outboundHeaders(extra = {}) {
  return { ...extra };
}
