// checkout-api asks inventory to hold every basket line while the order is
// confirmed. Auto-instrumentation records the outbound HTTP call as a span
// named `POST`, which records nothing about baskets, reservations or the
// mismatch that broke the order in module 01.
//
// TODO(telemetry-C): wrap this operation in a manual span named
// `checkout.reserve_stock`, carrying enough about the basket and the reply that
// somebody reading the trace can tell a correct reservation from a wrong one.
// The seven assertions in tests/span-contract.test.mjs are the rest of it.
//
// The structure of the code is below, commented out. It is the same three steps as the worked
// example: get a tracer, start an active span around the work, end it in a
// `finally`. Which attributes go on, what counts as a short reply and where
// the status belongs are the decisions left to make.
//
// import { trace, SpanStatusCode } from '@opentelemetry/api';
//
// const tracer = trace.getTracer('checkout-api');
//
// export async function reserveStock(basket, inventoryUrl) {
//   return tracer.startActiveSpan('...', async (span) => {
//     // attributes known before the call go here
//     try {
//       // the fetch below, unchanged
//       return reservations;
//     } catch (err) {
//       // an attribute naming the failure, and the Error status
//       throw err;
//     } finally {
//       span.end();
//     }
//   });
// }

export async function reserveStock(basket, inventoryUrl) {
  const reply = await fetch(inventoryUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(basket),
  });
  const { reservations } = await reply.json();
  return reservations;
}
