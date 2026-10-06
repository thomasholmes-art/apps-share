// checkout-api's queue client. The checkout handler awaits `publish` before it
// answers the browser, so everything this file does lands on the customer's
// response time.
//
// `messaging.system` and `messaging.destination.name` below are OpenTelemetry
// semantic conventions. `messaging.connection.reused` is not: it is a
// service-local attribute the sample application adds.
import { withSpan } from './spans.mjs';

export function createPublisher({ broker, tracer }) {
  // TASK 5a: nothing here survives from one publish to the next.
  return {
    async publish(topic, job) {
      return withSpan(
        tracer,
        'dispatch.publish',
        { 'messaging.system': 'dispatch-queue', 'messaging.destination.name': topic },
        // TASK 5d: assertion 5 reads messaging.connection.reused on this
        // dispatch.publish span as well. withSpan passes the span to this callback.
        async () => {
          // TASK 5b: what this call costs, and how often it runs.
          const connection = await withSpan(
            tracer,
            'dispatch.connect',
            { 'messaging.connection.reused': false },
            () => broker.connect(),
          );
          const result = await connection.send({ topic, ...job });
          // TASK 5c: what this line does decides what the next publish pays.
          await connection.close();
          return result;
        },
      );
    },
  };
}
