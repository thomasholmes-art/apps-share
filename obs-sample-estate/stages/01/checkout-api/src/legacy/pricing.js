// checkout-api, module 01 build (stage 01 of obs-sample-estate).
//
// Prices the lines inventory reserved, in GBP minor units, and writes the
// `pricing:` line. Only reserved lines are priced, which is why the failing
// basket in lab 01 prices at 2450 (mug plus cap) although it has three lines.
'use strict';

const { data, product } = require('./catalog.js');
const { line } = require('./print.js');

function price(basket, reservations) {
  const reserved = new Set(reservations.map((r) => r.sku));
  const subtotal = basket.lines
    .filter((l) => reserved.has(l.sku))
    .reduce((sum, l) => sum + (product(l.sku)?.price_minor ?? 0) * l.qty, 0);
  const shipping = subtotal >= data.shipping.free_from_minor ? 0 : data.shipping.flat_minor;
  line(`pricing: subtotal ${subtotal} ${basket.currency}, shipping ${shipping} ${basket.currency}`);
  return { subtotal, shipping, total: subtotal + shipping };
}

module.exports = { price };
