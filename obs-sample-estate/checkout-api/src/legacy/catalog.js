// checkout-api, module 01 build (stage 01 of obs-sample-estate).
//
// Catalogue pages with an in-process cache. A miss waits 40-56 ms, standing in
// for the origin fetch; a hit waits about 9 ms. Writes the `cache:` lines from
// the lab 01 excerpt. Page bodies are padded with trailing JSON whitespace to
// the byte counts the excerpt shows (8842 for page 1, 7731 for the others).
'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { line } = require('./print.js');

const data = JSON.parse(readFileSync(join(__dirname, '..', 'catalog-data.json'), 'utf8'));
const PAGES = Math.ceil(data.products.length / data.page_size);
const CACHE_TTL_MS = 60_000;
const cache = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const between = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

function body(page) {
  const products = data.products.filter((p) => p.page === page);
  const json = JSON.stringify({ page, pages: PAGES, currency: data.currency, products });
  return json.padEnd(page === 1 ? 8842 : 7731);
}

async function getPage(raw) {
  const page = Math.min(Math.max(Number.parseInt(raw, 10) || 1, 1), PAGES);
  const cached = cache.get(page);
  if (cached && cached.until > Date.now()) {
    await sleep(between(8, 10));
    line(`cache: catalog page ${page} hit`);
    return cached.body;
  }
  const ms = between(40, 56);
  await sleep(ms);
  const fresh = body(page);
  cache.set(page, { body: fresh, until: Date.now() + CACHE_TTL_MS });
  line(`cache: catalog page ${page} miss, fetched in ${ms}ms`);
  return fresh;
}

function product(sku) {
  return data.products.find((p) => p.sku === sku);
}

module.exports = { data, getPage, product, PAGES };
