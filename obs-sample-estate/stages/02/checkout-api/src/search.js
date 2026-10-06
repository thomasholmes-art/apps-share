// checkout-api: GET /api/search (obs-sample-estate, stage 02 onwards; module
// 04 worked example 2, "an unreported 694-millisecond search request").
//
// The defect is a price-list cache keyed on the request's own time to the
// millisecond, `price-list:<currency>:<ISO time>`, so no two searches share an
// entry, every lookup misses, and every search rebuilds the list (about
// 641 ms). The request still answers 200 and never errors.
//
// Spans, through the sample application's `withSpan` helper (no-ops until
// lab 03 loads the SDK):
//   SELECT products      about 18 ms, a manual span because the product
//                         table is in-process and no instrumentation sees it
//   catalog.price_list   about 641 ms, no children
// About 35 ms of the request sits outside both, as in the module's waterfall.
//
// The `price_list.cache_lookup` debug record is written inside the
// `catalog.price_list` span, so from lab 03 on it carries that span's trace
// context and appears on the span's Logs tab. Every wait is a timer rather
// than CPU work, so a slow search does not slow concurrent checkouts.
import { trace } from '@opentelemetry/api';
import { log } from './correlation.js';
import { withSpan } from './spans.mjs';
import { data } from './catalog.js';

const tracer = trace.getTracer('checkout-api');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PRICE_LIST_BUILD_MS = 641;
const priceLists = new Map();

function remember(key, value) {
  priceLists.set(key, value);
  if (priceLists.size > 200) priceLists.delete(priceLists.keys().next().value);
}

export async function search(q, currency, requestTime) {
  await sleep(17);
  const needle = String(q ?? '').toLowerCase();

  const hits = await withSpan(
    tracer,
    'SELECT products',
    { 'db.system.name': 'other_sql', 'db.operation.name': 'SELECT', 'db.collection.name': 'products' },
    async () => {
      await sleep(18);
      return data.products.filter((p) => p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle));
    },
  );

  const prices = await withSpan(tracer, 'catalog.price_list', { 'catalog.currency': currency }, async () => {
    const key = `price-list:${currency}:${requestTime}`;
    const cached = priceLists.get(key);
    log().debug(
      { event: 'price_list.cache_lookup', hit: cached !== undefined, cache_key: key },
      cached ? 'price list found in cache' : 'price list not cached; rebuilding',
    );
    if (cached) return cached;
    await sleep(PRICE_LIST_BUILD_MS);
    const built = new Map(data.products.map((p) => [p.sku, p.price_minor]));
    remember(key, built);
    return built;
  });

  await sleep(17);
  return {
    q: needle,
    currency,
    results: hits.slice(0, 20).map(({ sku, name }) => ({ sku, name, price_minor: prices.get(sku) })),
  };
}
