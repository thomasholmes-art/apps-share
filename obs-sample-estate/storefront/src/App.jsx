// storefront: the sample shop (obs-sample-estate, all stages).
//
// Lists the catalogue a page at a time, searches it, keeps a basket in the
// browser and checks it out with one POST /api/checkout:
//
//   {"customer":{"id":"cus_<6 hex>"},
//    "basket":{"currency":"GBP","lines":[{"sku":"MUG-ENAMEL-01","qty":1}]}}
//
// Every request goes to /api on this page's own origin; server.mjs passes it
// to checkout-api. The page sets no x-correlation-id or traceparent header
// of its own. On any failed checkout it shows one generic message, which is
// all the customer in lab 01's brief saw.
import { useEffect, useState } from 'react';

const CURRENCY = 'GBP';

function customerId() {
  let id = localStorage.getItem('customer_id');
  if (!id) {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('');
    id = `cus_${hex}`;
    localStorage.setItem('customer_id', id);
  }
  return id;
}

const money = (minor) => `£${(minor / 100).toFixed(2)}`;

function ProductRow({ product, onAdd }) {
  return (
    <li className="product">
      <span className="name">{product.name}</span>
      <code className="sku">{product.sku}</code>
      <span className="price">{product.price_minor === undefined ? '' : money(product.price_minor)}</span>
      <button type="button" onClick={() => onAdd(product)}>Add to basket</button>
    </li>
  );
}

export default function App() {
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState({ pages: 1, products: [] });
  const [catalogError, setCatalogError] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(undefined);
  const [searching, setSearching] = useState(false);
  const [basket, setBasket] = useState([]);
  const [outcome, setOutcome] = useState(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/catalog?page=${page}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body) => { if (live) { setCatalog(body); setCatalogError(''); } })
      .catch(() => { if (live) setCatalogError('The catalogue could not be loaded. Reload the page to try again.'); });
    return () => { live = false; };
  }, [page]);

  const add = (product) => {
    setOutcome(undefined);
    setBasket((lines) => {
      const found = lines.find((l) => l.sku === product.sku);
      if (found) return lines.map((l) => (l.sku === product.sku ? { ...l, qty: l.qty + 1 } : l));
      return [...lines, { sku: product.sku, name: product.name, price_minor: product.price_minor, qty: 1 }];
    });
  };

  const changeQty = (sku, delta) => {
    setOutcome(undefined);
    setBasket((lines) => lines
      .map((l) => (l.sku === sku ? { ...l, qty: l.qty + delta } : l))
      .filter((l) => l.qty > 0));
  };

  const search = async (event) => {
    event.preventDefault();
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&currency=${CURRENCY}`);
      const body = await res.json();
      setResults(body.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const checkout = async () => {
    setBusy(true);
    setOutcome(undefined);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer: { id: customerId() },
          basket: { currency: CURRENCY, lines: basket.map(({ sku, qty }) => ({ sku, qty })) },
        }),
      });
      if (res.status === 201) {
        const body = await res.json();
        setOutcome({ ok: true, text: `Order placed: ${body.id ?? body.order_id}` });
        setBasket([]);
      } else {
        setOutcome({ ok: false, text: 'Something went wrong, please try again.' });
      }
    } catch {
      setOutcome({ ok: false, text: 'Something went wrong, please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const total = basket.reduce((sum, l) => sum + (l.price_minor ?? 0) * l.qty, 0);

  return (
    <main>
      <header>
        <h1>Sample shop</h1>
        <form className="search" onSubmit={search}>
          <input
            type="search"
            aria-label="Search products"
            placeholder="Search products"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" disabled={searching}>{searching ? 'Searching' : 'Search'}</button>
        </form>
      </header>

      <div className="columns">
        <section>
          {results !== undefined && (
            <>
              <h2>Search results <button type="button" className="link" onClick={() => setResults(undefined)}>Clear</button></h2>
              {results.length === 0 ? <p>No products match.</p> : (
                <ul className="products">
                  {results.map((p) => <ProductRow key={p.sku} product={p} onAdd={add} />)}
                </ul>
              )}
            </>
          )}

          <h2>Catalogue, page {page} of {catalog.pages}</h2>
          {catalogError && <p className="error">{catalogError}</p>}
          <ul className="products">
            {catalog.products.map((p) => <ProductRow key={p.sku} product={p} onAdd={add} />)}
          </ul>
          <nav className="pager">
            {Array.from({ length: catalog.pages }, (_, i) => i + 1).map((n) => (
              <button type="button" key={n} disabled={n === page} onClick={() => setPage(n)}>{n}</button>
            ))}
          </nav>
        </section>

        <aside>
          <h2>Basket</h2>
          {basket.length === 0 ? <p>The basket is empty.</p> : (
            <ul className="basket">
              {basket.map((l) => (
                <li key={l.sku}>
                  <span className="name">{l.name}</span>
                  <code className="sku">{l.sku}</code>
                  <span className="qty">
                    <button type="button" aria-label={`One fewer ${l.name}`} onClick={() => changeQty(l.sku, -1)}>-</button>
                    {l.qty}
                    <button type="button" aria-label={`One more ${l.name}`} onClick={() => changeQty(l.sku, 1)}>+</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="total">Items: {money(total)}</p>
          <button type="button" className="checkout" disabled={basket.length === 0 || busy} onClick={checkout}>
            {busy ? 'Placing order' : 'Check out'}
          </button>
          {outcome && <p className={outcome.ok ? 'ok' : 'error'} role="status">{outcome.text}</p>}
        </aside>
      </div>
    </main>
  );
}
