// box-office-estate: the shared logger, imported by orders-api (through
// correlation.js) and by payments-sim. Lab 02's solution logger.js, with the
// service name read from SERVICE_NAME. Part of the application behind
// module 07, lab 07-hackathon-two-worlds. Pre-wired; no marker in this file.
//
// One logger for the whole service.
//
// Everything written through it lands on standard output as newline-delimited
// JSON. The OpenTelemetry Collector already running on the host tails the
// container's output and forwards it to SigNoz, so no export configuration
// belongs in this file. Changing the backend changes the collector, not this.
import pino from 'pino';

// `LOG_FILE` exists so the test suite can read back what was written. In the
// running container the variable is unset and pino writes to file descriptor 1.
const destination = pino.destination({
  dest: process.env.LOG_FILE ?? 1,
  sync: true,
});

export const logger = pino(
  {
    // The production log level comes from the environment, never from code, so an
    // investigation can drop to debug for an hour without a deployment.
    level: process.env.LOG_LEVEL ?? 'info',

    // Fields on every record this service writes.
    base: { service_name: process.env.SERVICE_NAME },

    timestamp: pino.stdTimeFunctions.isoTime,

    formatters: {
      // Write the level name rather than pino's numeric level. Pino's numbers
      // (10-60) are not OpenTelemetry SeverityNumbers (1-24); filtering on the
      // name avoids the confusion entirely.
      level: (label) => ({ level: label }),
    },

    // The never-log half of the required-fields agreement, enforced in the one
    // place every event passes through. `remove: true` drops the key outright
    // rather than writing "[Redacted]" in its place, so nothing downstream can
    // reconstruct it and no query can group by it.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'session_id',
        'customer.email',
        'customer.phone',
        'payment.card_number',
        'payment.card_last4',
        'payment.cvv',
        'password',
        '*.password',
        'token',
        '*.token',
      ],
      remove: true,
    },
  },
  destination,
);
