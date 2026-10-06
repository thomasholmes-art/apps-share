// payments-sim: telemetry bootstrap for the execution environment. Part of
// box-office-estate, the application behind module 07,
// lab 07-hackathon-two-worlds. Pre-wired; no marker in this file.
//
// The SDK is started with no instrumentations, so it records nothing until
// application code creates a span. Spans go to the collector's OTLP/HTTP
// receiver. Log export is switched off, as on the other services: log records
// reach the backend from standard output.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

process.env.OTEL_LOGS_EXPORTER = 'none';
process.env.OTEL_METRICS_EXPORTER = 'none';

export const sdk = new NodeSDK({
  serviceName: 'payments-sim',
  traceExporter: new OTLPTraceExporter({ url: 'http://otel-collector:4318/v1/traces' }),
  instrumentations: [],
});

sdk.start();

// The host shuts this environment down after it has been idle, so the
// process ends long before a timed export can be relied on. shutdown() sends
// whatever is still buffered and waits for the export to finish. A managed
// function frozen after its handler returns loses telemetry the same way.
const flushAndExit = (code) => {
  sdk.shutdown().finally(() => process.exit(code));
};

process.once('SIGTERM', () => flushAndExit(0));
process.once('SIGINT', () => flushAndExit(0));
