// payments-sim: the queue consumer. Part of box-office-estate, the
// application behind module 07, lab 07-hackathon-two-worlds.
//
// handle() is called once per payment job, inside the execution environment.
// The job's body is decoded against a fixed schema that keeps only the keys
// below, so anything added inside the body is dropped. Keys on the envelope
// beside the body reach handle() unchanged.
import { context, propagation, trace, SpanKind } from '@opentelemetry/api';
import { tokenise, authorise } from './provider.js';
import { logger } from '../shared/logger.js';

const tracer = trace.getTracer('payments-sim');

function decode(body) {
  const b = body ?? {};
  const p = b.payment ?? {};
  return {
    orderId: String(b.orderId ?? ''),
    amountMinor: Number(b.amountMinor ?? 0),
    currency: String(b.currency ?? 'GBP'),
    payment: {
      card_number: String(p.card_number ?? ''),
      expiry: String(p.expiry ?? ''),
      cvv: String(p.cvv ?? ''),
    },
    token: typeof b.token === 'string' ? b.token : undefined,
  };
}

// envelope:   { id, queue, published_at, timeout_ms, body, ... }
// invocation: { invocationId, coldStart, queuedMs, idleTimeoutS }
export async function handle(envelope, invocation) {
  // Every record this handler writes carries the purchase's correlation_id,
  // read from the envelope beside the payload.
  const log = logger.child({ correlation_id: envelope.correlation_id });
  const job = decode(envelope.body);

  // Rebuild the publisher's context from the envelope and pass it as the
  // span's parent, so the handler span joins the purchase's trace.
  const parent = propagation.extract(context.active(), envelope.context ?? {});
  return tracer.startActiveSpan('payments.handle', {
    kind: SpanKind.CONSUMER,
    attributes: {
      'messaging.operation': 'process',
      'faas.coldstart': invocation.coldStart,
      'queue.wait_ms': invocation.queuedMs,
      'idle.timeout_s': invocation.idleTimeoutS,
    },
  }, parent, async (span) => {
    try {
      const started = Date.now();
      const token = job.token ?? tokenise(job.payment);
      const { authRef } = await authorise(token, job.amountMinor, job.currency);
      const ms = Date.now() - started;
      if (Date.now() - Number(envelope.published_at) > Number(envelope.timeout_ms)) {
        log.warn({ event: 'payment.authorised.late', auth_ref: authRef, duration_ms: ms },
          `authorisation completed after the caller abandoned, auth ref ${authRef}`);
      } else {
        log.info({ event: 'payment.authorised', auth_ref: authRef, duration_ms: ms },
          `authorisation completed in ${ms} ms, auth ref ${authRef}`);
      }
      return {
        id: envelope.id,
        orderId: job.orderId,
        auth_ref: authRef,
        status: 'authorised',
        correlation_id: envelope.correlation_id,
      };
    } finally {
      span.end();
    }
  });
}
