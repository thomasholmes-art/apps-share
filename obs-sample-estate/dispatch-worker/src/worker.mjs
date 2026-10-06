// dispatch-worker consumes one job from dispatch-queue and completes the order.
// The process is started per batch and exits when the batch is done, which is
// the container-shaped stand-in for a function hop: nothing here lives long
// enough for a timed export to be relied on.
import { context, propagation, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { createLabel } from './label-client.mjs';

const tracer = trace.getTracer('dispatch-worker');

export async function handleJob(message, deps) {
  // TODO(telemetry-C): this span is named and attributed correctly and is
  // still the root of a trace of its own, because nothing rebuilt the caller's
  // context out of `message.context`. `propagation.extract` returns a context
  // object; the span has to be started inside it, and its kind has to say this
  // is the receiving end of an asynchronous message.
  return tracer.startActiveSpan(
    'dispatch.handle_job',
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        'messaging.system': 'dispatch-queue',
        'messaging.destination.name': message.queue,
        'messaging.operation': 'process',
        'dispatch.order_id': message.body.orderId,
      },
    },
    async (span) => {
      try {
        const label = await createLabel(message.body, deps);
        span.setAttribute('dispatch.label.id', label.id);
        return label;
      } catch (err) {
        span.setAttribute('error.type', err.code ?? 'dispatch_failed');
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'dispatch failed' });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}
