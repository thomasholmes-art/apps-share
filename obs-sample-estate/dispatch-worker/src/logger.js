// dispatch-worker: its logger (obs-sample-estate, all stages; read by lab 02's
// query Q3 and lab 04's next-PR note).
//
// Newline-delimited JSON on standard output in the shape lab 02 agrees for
// checkout-api: `time`, `level` as a name, `service_name`, `event`, `msg`.
// `correlation_id` is bound per job only when the envelope carries one; the
// worker never creates its own, so lab 02's Q3 returns no worker rows until
// checkout-api's queue client puts the id in the envelope (lab 02 task 3b).
import pino from 'pino';

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service_name: 'dispatch-worker' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  },
  pino.destination({ dest: 1, sync: true }),
);

export function forMessage(message) {
  return message.correlation_id ? logger.child({ correlation_id: message.correlation_id }) : logger;
}
