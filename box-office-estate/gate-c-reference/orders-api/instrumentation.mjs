// orders-api telemetry bootstrap. Part of box-office-estate, the application
// behind module 07, lab 07-hackathon-two-worlds. Lab 03's instrumentation.mjs
// with no fallback endpoint and no fallback service name: both come only from
// OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_SERVICE_NAME.
//
// Nothing loads this file until the launch command does, with
//   node --import ./instrumentation.mjs dist/server.js
// so the SDK can patch the HTTP and database libraries before the service
// imports them.
import { register } from 'node:module';

// The HTTP instrumentation patches `node:http` as it is imported, and an ES
// module import cannot be intercepted without this hook. Without it the
// outbound call is still traced, through a different mechanism, and the
// inbound request produces no server span at all.
register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

// Both exporters read OTEL_EXPORTER_OTLP_ENDPOINT and add the signal path
// (/v1/traces, /v1/metrics). The service name comes from OTEL_SERVICE_NAME.
export const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 15000,
    }),
  ],
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// Without this the last 15 seconds of telemetry is lost on every restart.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    sdk.shutdown().finally(() => process.exit(0));
  });
}
