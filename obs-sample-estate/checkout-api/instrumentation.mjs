// checkout-api telemetry bootstrap. Node has to load it before any
// application code, which is the launch command's job (task 2).
//
// As shipped this prints spans to the terminal, and nothing reaches SigNoz.
import { register } from 'node:module';

// The HTTP instrumentation patches `node:http` as it is imported, and an ES
// module import cannot be intercepted without this hook. Without it the
// outbound call is still traced, through a different mechanism, and the
// inbound request produces no server span at all. Registered here, before the
// SDK is built, so it is in place when the service imports anything.
register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

// TODO(telemetry-B): replace the console exporter with an OTLP trace exporter,
// reading its base address from OTEL_EXPORTER_OTLP_ENDPOINT
// TODO(telemetry-B): set the service name so SigNoz does not list it as `unknown_service:node`
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://otel-sidecar:4318';

export const sdk = new NodeSDK({
  traceExporter: new ConsoleSpanExporter(),
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${base}/v1/traces` }),
      exportIntervalMillis: 15000,
    }),
  ],
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
