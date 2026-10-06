#!/usr/bin/env python3
"""Build helper for box-office-estate (module 07, lab 07-hackathon-two-worlds).

Regenerates gate-a-reference/, gate-b-reference/ and gate-c-reference/ from
main/ by exact text replacement: each snapshot is the previous one with one
gate's markers resolved (spec section 2.2 and section 4.2). Every replacement
must match exactly once, so a change to main/ that moves a marker's text
stops the script instead of producing a snapshot that silently differs.

Usage: test/make-gates.py [estate-dir]
The estate directory defaults to the parent of this script's directory.
"""
import os, shutil, sys
E = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def edit(root, rel, old, new):
    p = os.path.join(root, rel); s = open(p).read()
    if s.count(old) != 1: sys.exit(f'{rel}: expected one match for {old[:60]!r}, found {s.count(old)}')
    open(p, 'w').write(s.replace(old, new))
def snapshot(src, dst):
    d = os.path.join(E, dst); shutil.rmtree(d, ignore_errors=True); shutil.copytree(os.path.join(E, src), d); return d

# ---- gate A: markers 1, 2, 3 and the agent flag
a = snapshot('main', 'gate-a-reference')
edit(a, 'orders-api/src/orders/handler.ts',
"import { orders, nextOrderId } from './store.js';\n",
"import { orders, nextOrderId } from './store.js';\nimport { log, correlationId } from '../correlation.js';\n")
edit(a, 'orders-api/src/orders/handler.ts',
"""// TODO(telemetry-A): say() writes plain text and discards the level, event name and fields it is given, and the payment job envelope built in createOrder() carries no correlation identifier.
function say(level: Level, event: string, msg: string, fields: Fields = {}): void {
  console.log(`${new Date().toISOString()} orders: ${msg}`);
  if (fields.err instanceof Error) console.log(fields.err.stack);
}""",
"""// Every order-path line goes through the request's logger: one JSON object,
// levelled, named, and carrying the request's correlation_id.
function say(level: Level, event: string, msg: string, fields: Fields = {}): void {
  log()[level]({ event, ...fields }, msg);
}""")
edit(a, 'orders-api/src/orders/handler.ts',
"""    id: randomUUID(),
    queue: 'payments',
    body: {""",
"""    id: randomUUID(),
    queue: 'payments',
    correlation_id: correlationId(),
    body: {""")
edit(a, 'payments-sim/src/consumer.js',
"import { tokenise, authorise } from './provider.js';\n",
"import { tokenise, authorise } from './provider.js';\nimport { logger } from '../shared/logger.js';\n")
edit(a, 'payments-sim/src/consumer.js',
"""  // TODO(telemetry-A): the consumer writes no log output, and the correlation identifier on the envelope is never read.
  const job = decode(envelope.body);

  // TODO(telemetry-C): the handler's work runs outside any span, and the envelope's trace context is never read.
  const token = job.token ?? tokenise(job.payment);
  const { authRef } = await authorise(token, job.amountMinor, job.currency);
  return {""",
"""  // Every record this handler writes carries the purchase's correlation_id,
  // read from the envelope beside the payload.
  const log = logger.child({ correlation_id: envelope.correlation_id });
  const job = decode(envelope.body);

  // TODO(telemetry-C): the handler's work runs outside any span, and the envelope's trace context is never read.
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
  return {""")
edit(a, 'seatmap/src/main/resources/logback-spring.xml',
"""      <!-- TODO(telemetry-A): this pattern prints no trace context, and the OpenTelemetry agent is not on seatmap's launch command in docker-compose.yml. -->
      <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} %5p ${PID:- } --- [%15.15t] %logger{20} : %m%n</pattern>""",
"""      <!-- trace_id and span_id are put in the MDC by the OpenTelemetry agent's logback-mdc instrumentation. -->
      <pattern>%d{HH:mm:ss.SSS} %-5level [%X{trace_id} %X{span_id}] %logger{20} - %msg%n</pattern>""")
edit(a, 'docker-compose.yml',
"    command: java -jar /app/seatmap.jar\n",
"    command: java -javaagent:/opt/otel/opentelemetry-javaagent-2.31.1.jar -jar /app/seatmap.jar\n")

# ---- gate B: markers 4, 5
b = snapshot('gate-a-reference', 'gate-b-reference')
edit(b, 'docker-compose.yml',
"""    # TODO(telemetry-B): seatmap has no exporter settings.
    command""", "    command")
edit(b, 'docker-compose.yml',
"""      LOGGING_CONFIG: /app/config/logback-spring.xml
      OTEL_LOGS_EXPORTER: none
""",
"""      LOGGING_CONFIG: /app/config/logback-spring.xml
      OTEL_LOGS_EXPORTER: none
      OTEL_SERVICE_NAME: seatmap
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
""")
edit(b, 'docker-compose.yml',
"""    # TODO(telemetry-B): orders-api starts with no telemetry attached.
    command: node dist/server.js
""", "    command: node --import ./instrumentation.mjs dist/server.js\n")
edit(b, 'docker-compose.yml',
"""      SERVICE_NAME: orders-api
      OTEL_LOGS_EXPORTER: none
""",
"""      SERVICE_NAME: orders-api
      OTEL_LOGS_EXPORTER: none
      OTEL_SERVICE_NAME: orders-api
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
""")

# ---- gate C: markers 6, 7
c = snapshot('gate-b-reference', 'gate-c-reference')
edit(c, 'orders-api/src/payments/queue-client.ts',
"import { context, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';",
"import { context, propagation, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';")
edit(c, 'orders-api/src/payments/queue-client.ts',
"""    // TODO(telemetry-C): the envelope is written to the queue with no trace context in it.
    return publish(envelope);""",
"""    // The trace context goes in its own map beside the payload, as lab 05 did.
    envelope.context = {};
    propagation.inject(context.active(), envelope.context);
    return publish(envelope);""")
edit(c, 'payments-sim/src/consumer.js',
"import { tokenise, authorise } from './provider.js';\n",
"import { context, propagation, trace, SpanKind } from '@opentelemetry/api';\nimport { tokenise, authorise } from './provider.js';\n")
edit(c, 'payments-sim/src/consumer.js',
"import { logger } from '../shared/logger.js';\n",
"import { logger } from '../shared/logger.js';\n\nconst tracer = trace.getTracer('payments-sim');\n")
edit(c, 'payments-sim/src/consumer.js',
"""  // TODO(telemetry-C): the handler's work runs outside any span, and the envelope's trace context is never read.
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
}""",
"""  // Rebuild the publisher's context from the envelope and pass it as the
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
}""")
print('ok')
