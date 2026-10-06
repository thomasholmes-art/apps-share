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
    base: { service_name: 'checkout-api' },

    timestamp: pino.stdTimeFunctions.isoTime,

    formatters: {
      // Write the level name rather than pino's numeric level. Pino's numbers
      // (10-60) are not OpenTelemetry SeverityNumbers (1-24); filtering on the
      // name avoids the confusion entirely.
      level: (label) => ({ level: label }),
    },

    // TASK 1b: this list is a stub. Extend it with the never-log paths for a
    // checkout service. `remove: true` drops the key outright rather than
    // writing "[Redacted]" in its place.
    redact: {
      paths: ['req.headers.authorization'],
      remove: true,
    },
  },
  destination,
);
