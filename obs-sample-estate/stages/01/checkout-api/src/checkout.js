// checkout-api, module 01 build: the checkout handler (stage 01 of
// obs-sample-estate, backing module 01 and lab 01).
//
// This is the code behind lab 01's failing checkout. Lab 01 learners are told
// not to read it; it is here so the fault is real and reproducible.
//
// The fault. inventory answers POST /reserve with 200 and one reservation per
// basket line it could hold, so a basket containing TS-SHIRT-XL-BLK (no stock
// record) comes back with two reservations for three lines. The handler
// notices the mismatch, prints it with no timestamp and no severity, and then
// builds the order payload anyway by pairing basket lines with reservations by
// position. The third line has no reservation, reading `.id` of undefined
// throws a TypeError, the handler prints the stack, abandons the order and
// answers 500.
//
// The layout of this file is deliberate: `buildOrderPayload` is passed
// straight to `Array.prototype.map` at line 84, column 29, inside the
// anonymous route handler, and the `.id` read sits at line 87, column 34, so
// the stack trace matches the lab 01 excerpt frame for frame:
//
//   TypeError: Cannot read properties of undefined (reading 'id')
//       at buildOrderPayload (/app/src/checkout.js:87:34)
//       at Array.map (<anonymous>)
//       at /app/src/checkout.js:84:29
//       at process.processTicksAndRejections (node:internal/process/task_queues:...)
//
// Response bodies are padded with trailing JSON whitespace to the sizes in the
// excerpt's access lines: 62 bytes for the 500 and 118 for the 201.
// Stage 02 replaces this file with lab 02's starter `checkout.js`.
//
// The start, basket, inventory and pricing lines are timestamped. The
// mismatch line is not, because its author used a bare print.
'use strict';

const { line, bare } = require('./legacy/print.js');
const inventory = require('./legacy/inventory-client.js');
const { price } = require('./legacy/pricing.js');
const queue = require('./legacy/queue-client.js');

const FAILED_BODY = JSON.stringify({ error: 'checkout_failed', retry: true }).padEnd(62);
let day = '';
let counter = 0;

function nextOrderId() {
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  if (today !== day) {
    day = today;
    counter = 0;
  }
  counter += 1;
  return `ord_${today}_${String(counter).padStart(4, '0')}`;
}

function describe(lines) {
  return lines.map((l) => `${l.sku} x${l.qty}`).join(', ');
}

function mountCheckout(app) {
  app.post('/api/checkout', async (req, res) => {
    const order = req.body?.basket ?? { currency: 'GBP', lines: [] };
    const items = order.lines;
    const customer = req.body?.customer?.id ?? 'anonymous';
    line(`checkout: start customer=${customer} lines=${order.lines.length} currency=${order.currency}`);
    line(`checkout: basket ${describe(order.lines)}`);

    let reserved = [];
    try {
      const reply = await inventory.reserve(order);
      reserved = reply.reservations ?? [];
      const totals = price(order, reserved);

      if (reserved.length !== items.length) {
        bare(`checkout: reservations ${reserved.length} / lines ${items.length}`);
        line('checkout: building order payload');
      }

      // The defect lab 01 finds. The mismatch above is reported and then
      // ignored: the payload pairs each basket line with the reservation at
      // the same position in inventory's reply, as if the reply always held
      // one reservation per line in basket order. A short reply leaves the
      // last line paired with undefined and the `.id` read below throws.
      // Matching on `sku` instead of position, and refusing the order when a
      // line has no reservation, is the fix lab 02's starter already carries.
      const payload = items.map(buildOrderPayload);
      function buildOrderPayload(entry, i) {
        return { sku: entry.sku, qty: entry.qty,
        reservation: reserved[i].id };
      }

      const orderId = nextOrderId();
      await queue.publish('dispatch', { orderId, lines: payload });
      line(`checkout: order created ${orderId}`);
      const created = JSON.stringify({ order_id: orderId, status: 'created', subtotal: totals.subtotal,
        shipping: totals.shipping, total: totals.total, currency: order.currency });
      res.status(201).type('application/json').send(created.padEnd(118));
    } catch (err) {
      line(String(err.stack));
      line(`checkout: order abandoned, releasing ${reserved.length} reservation(s)`);
      res.status(500).type('application/json').send(FAILED_BODY);
    }
  });
}

module.exports = { mountCheckout, nextOrderId };
