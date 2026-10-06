// checkout-api, module 01 build (stage 01 of obs-sample-estate).
//
// GET /api/search for the storefront's search box. It has module 04's cost
// profile from the start (about 18 ms to read the product table, about 641 ms
// to rebuild a price list that is never found in its cache, about 35 ms
// elsewhere), but in the module 01 build it writes no lines and no spans.
// Stage 02 replaces it with the version module 04's worked example traces.
'use strict';

const { data } = require('./catalog.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(q, currency) {
  await sleep(17);
  await sleep(18);
  const needle = String(q ?? '').toLowerCase();
  const hits = data.products.filter((p) => p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle));
  await sleep(641);
  await sleep(18);
  return { q: needle, currency, results: hits.slice(0, 20).map(({ sku, name, price_minor }) => ({ sku, name, price_minor })) };
}

module.exports = { search };
