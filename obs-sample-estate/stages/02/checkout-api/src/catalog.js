// checkout-api: catalogue pages with an in-process cache (obs-sample-estate,
// stage 02 onwards; the structured events of module 02's worked example 1).
//
// A miss waits 40-56 ms, standing in for the origin fetch, and logs
// `catalog.cache_miss` at debug with the request's correlation id. A hit
// waits about 9 ms and logs nothing. A timer refreshes all six pages about
// every 105 s and logs `catalog.refresh_completed` with no correlation id,
// because no request caused it.
import { readFileSync } from 'node:fs';
import { log } from './correlation.js';

export const data = JSON.parse(readFileSync(new URL('./catalog-data.json', import.meta.url), 'utf8'));
export const PAGES = Math.ceil(data.products.length / data.page_size);

const CACHE_TTL_MS = 60_000;
const cache = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const between = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

function body(page) {
  const products = data.products.filter((p) => p.page === page);
  return JSON.stringify({ page, pages: PAGES, currency: data.currency, products });
}

export async function getPage(raw) {
  const page = Math.min(Math.max(Number.parseInt(raw, 10) || 1, 1), PAGES);
  const cached = cache.get(page);
  if (cached && cached.until > Date.now()) {
    await sleep(between(8, 10));
    return cached.body;
  }
  const ms = between(40, 56);
  await sleep(ms);
  const fresh = body(page);
  cache.set(page, { body: fresh, until: Date.now() + CACHE_TTL_MS });
  log().debug({ event: 'catalog.cache_miss', page, duration_ms: ms }, 'catalog page fetched from origin');
  return fresh;
}

export async function refreshAll() {
  const started = Date.now();
  for (let page = 1; page <= PAGES; page += 1) {
    await sleep(between(18, 30));
    cache.set(page, { body: body(page), until: Date.now() + CACHE_TTL_MS });
  }
  log().debug(
    { event: 'catalog.refresh_completed', pages: PAGES, duration_ms: Date.now() - started },
    'catalog cache refreshed',
  );
}

export function product(sku) {
  return data.products.find((p) => p.sku === sku);
}
