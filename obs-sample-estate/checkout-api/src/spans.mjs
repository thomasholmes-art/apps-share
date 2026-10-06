// The span helper checkout-api uses everywhere it names a business operation.
// It is the `startActiveSpan` pattern from module 03 with the boilerplate in
// one place: attributes on, status set on failure, and `end()` in a `finally`
// so an exception cannot leave a span open and unexported.
//
// The tracer is injected rather than imported. In the running container it is
// the OpenTelemetry tracer built by `instrumentation.mjs`; in the test suite it
// is a recorder, which is what lets this file run with nothing else up.
export async function withSpan(tracer, name, attributes, fn) {
  return tracer.startActiveSpan(name, async (span) => {
    for (const [key, value] of Object.entries(attributes ?? {})) {
      span.setAttribute(key, value);
    }
    try {
      return await fn(span);
    } catch (err) {
      span.setAttribute('error.type', err.code ?? 'dispatch_failed');
      span.setStatus({ code: 2, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}
