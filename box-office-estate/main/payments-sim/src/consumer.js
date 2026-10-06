// payments-sim: the queue consumer. Part of box-office-estate, the
// application behind module 07, lab 07-hackathon-two-worlds.
//
// handle() is called once per payment job, inside the execution environment.
// The job's body is decoded against a fixed schema that keeps only the keys
// below, so anything added inside the body is dropped. Keys on the envelope
// beside the body reach handle() unchanged.
import { tokenise, authorise } from './provider.js';

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
  // TODO(telemetry-A): the consumer writes no log output, and the correlation identifier on the envelope is never read.
  const job = decode(envelope.body);

  // TODO(telemetry-C): the handler's work runs outside any span, and the envelope's trace context is never read.
  const token = job.token ?? tokenise(job.payment);
  const { authRef } = await authorise(token, job.amountMinor, job.currency);
  return {
    id: envelope.id,
    orderId: job.orderId,
    auth_ref: authRef,
    status: 'authorised',
    correlation_id: envelope.correlation_id,
  };
}
