// box-office-estate: orders-api's correlation middleware. Lab 02's solution
// correlation.js, with the logger imported from the shared module. Part of
// the application behind module 07, lab 07-hackathon-two-worlds. Pre-wired;
// no marker in this file.
//
// The correlation ID: created at the edge of this service, carried on every log
// record the request writes, and forwarded on every call the request makes.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { logger } from '../shared/logger.js';

export const CORRELATION_HEADER = 'x-correlation-id';

// An inbound header is attacker-controlled input that ends up written onto
// every log record for this request, so it gets a bounded length and a bounded
// alphabet before it is trusted (CWE-117, log injection).
export const VALID_ID = /^[A-Za-z0-9-]{8,64}$/;

// The trust decision, kept in one named place so the middleware reads as a rule
// rather than as an expression. Bounded on both sides: a value short enough to
// collide is not an identifier, and a value with no ceiling is what makes an
// unvalidated header a log-injection vector.
export function acceptable(inbound) {
  return VALID_ID.test(inbound ?? '');
}

const store = new AsyncLocalStorage();

// Express middleware, registered before every route so that no line written
// during this request is missing the identifier.
export function withCorrelationId(req, res, next) {
  // Generate-if-absent. A valid inbound value is reused, so the storefront's
  // identifier and this service's identifier are the same string. Anything else
  // is replaced rather than rejected: a malformed header is not a reason to
  // fail a customer's checkout.
  const inbound = req.headers?.[CORRELATION_HEADER];
  const correlationId = acceptable(inbound) ? inbound : randomUUID();

  // Echoed on the response so the value reaches the browser's network tab, and
  // from there a support ticket.
  res.setHeader(CORRELATION_HEADER, correlationId);

  // A child logger carries these fields on every record written through it, so
  // no call site has to remember them.
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

// Every outbound HTTP call gets the header. The caller's own headers are kept.
export function outboundHeaders(extra = {}) {
  const id = correlationId();
  return id ? { ...extra, [CORRELATION_HEADER]: id } : { ...extra };
}
