// The checkout request path. `deps` is injected so the path is testable without
// the other services running: `deps.inventory.reserve` is the HTTP call to the
// inventory service, `deps.transport.send` is the queue.
import { log, outboundHeaders } from './correlation.js';
import { publish } from './dispatch-queue.js';

export async function handleCheckout(req, res, deps) {
  const { customer, basket } = req.body;

  // TASK 1a: four print-style lines, written by four people on four different
  // days. Replace each with a levelled, structured event through `log()`. Keep
  // every fact that is already here, give each one a name, and add an `event`
  // name that a query can filter on.
  //
  // Three field names are asserted exactly, on the shortfall event: `requested`
  // (basket lines asked for), `reserved` (lines inventory came back with) and
  // `missing_skus` (the array of SKUs it could not reserve). The rest are free.
  console.log(
    `checkout: start customer=${customer.id} lines=${basket.lines.length} currency=${basket.currency}`,
  );

  const reply = await deps.inventory.reserve(
    basket,
    outboundHeaders({ 'content-type': 'application/json' }),
  );

  const reserved = reply.reservations.map((r) => r.sku);
  const missing = basket.lines.map((l) => l.sku).filter((sku) => !reserved.includes(sku));

  console.log(`checkout: reservations ${reply.reservations.length} / lines ${basket.lines.length}`);

  if (missing.length > 0) {
    console.log(`checkout: order abandoned, releasing ${reply.reservations.length} reservation(s)`);
    res.status(500).json({ error: 'reservation_incomplete' });
    return;
  }

  const orderId = deps.nextOrderId();
  await publish('dispatch', { orderId, lines: basket.lines }, deps.transport);

  console.log(`checkout: order created ${orderId}`);
  res.status(201).json({ id: orderId });
}
