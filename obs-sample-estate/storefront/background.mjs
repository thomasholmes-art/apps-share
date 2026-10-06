// storefront: background traffic (obs-sample-estate, all stages).
//
// Two loops, both calling checkout-api directly from this container, so every
// request arrives from one client address as in lab 01's excerpt:
//
//   health probe   GET /healthz every 5 seconds
//   browsing       one request every 5 to 10 seconds: a catalogue page
//                  (GET /api/catalog?page=N), the basket (GET /api/basket)
//                  or the favicon (GET /favicon.ico, which checkout-api
//                  answers 404), with user agent `Mozilla/5.0`
//
// The browsing loop keeps the session cookie checkout-api sets and drops it
// now and then, so new sessions are created at a steady rate. Lab 04's
// latency panel compares checkout with the catalogue, and lab 06's ratio
// query is diluted by catalogue traffic, so this traffic must keep running
// in every lab.
const HEALTH_MS = 5_000;
const BROWSE_MIN_MS = 5_000;
const BROWSE_MAX_MS = 10_000;
const AGENT = 'Mozilla/5.0';

const between = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

async function call(base, path, cookie) {
  const res = await fetch(new URL(path, base), {
    headers: { 'user-agent': AGENT, ...(cookie ? { cookie } : {}) },
    signal: AbortSignal.timeout(5_000),
  });
  await res.arrayBuffer();
  return res.headers.get('set-cookie')?.split(';')[0];
}

export function startBackground(base) {
  setInterval(() => {
    call(base, '/healthz').catch(() => {});
  }, HEALTH_MS);

  let cookie;
  const browse = async () => {
    const pick = Math.random();
    try {
      if (pick < 0.6) {
        const page = Math.random() < 0.6 ? between(1, 2) : between(3, 6);
        await call(base, `/api/catalog?page=${page}`, cookie);
      } else if (pick < 0.85) {
        if (Math.random() < 0.3) cookie = undefined;
        cookie = (await call(base, '/api/basket', cookie)) ?? cookie;
      } else {
        await call(base, '/favicon.ico', cookie);
      }
    } catch {
      // checkout-api is restarting or stopped; the next round tries again.
    }
    setTimeout(browse, between(BROWSE_MIN_MS, BROWSE_MAX_MS));
  };
  setTimeout(browse, between(1_000, 3_000));
}
