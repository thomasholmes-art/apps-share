// checkout-api's own queue client. It publishes a job that dispatch-worker
// consumes. A message is a plain object: there are no HTTP headers on this hop.
import { log, correlationId } from './correlation.js';

export async function publish(queue, body, transport) {
  // TASK 3b: nothing in this envelope tells dispatch-worker which request
  // produced the job, so the trail ends here. `correlationId()` is imported
  // above and currently unused.
  const message = { queue, body };

  log().info(
    { event: 'dispatch.published', queue, lines: body.lines.length },
    'job queued for dispatch',
  );

  return transport.send(message);
}
