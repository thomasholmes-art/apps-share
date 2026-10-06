// customers: other people using the box office. Part of box-office-estate,
// the application behind module 07, lab 07-hackathon-two-worlds.
//
// Sends browse requests through box-office's nginx, as a browser would:
// the event list, single events, seat maps and order status pages, at about
// the mix of an ordinary afternoon. It never buys a ticket.
const BASE = process.env.BOX_OFFICE_URL ?? 'http://box-office';
const HEADERS = { 'user-agent': 'Mozilla/5.0', accept: 'application/json' };

// Requests per minute for each page.
const RATES = { events: 46, event: 31, seatmap: 29, order: 7 };
// Share of seat-map views that are for arena events.
const ARENA_SHARE = 0.14;

// Historic orders, as loaded by orders-api from seed/orders.json.
const ORDER_IDS = [
  'ord_20260924_0301', 'ord_20260924_0314', 'ord_20260924_0327', 'ord_20260924_0340',
  'ord_20260924_0353', 'ord_20260924_0366', 'ord_20260924_0379', 'ord_20260925_0392',
  'ord_20260925_0405', 'ord_20260925_0418', 'ord_20260925_0431', 'ord_20260925_0444',
  'ord_20260925_0457', 'ord_20260925_0470', 'ord_20260926_0483', 'ord_20260926_0496',
  'ord_20260926_0509', 'ord_20260926_0522', 'ord_20260926_0535', 'ord_20260926_0548',
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(path) {
  try {
    const res = await fetch(`${BASE}/api${path}`, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    await res.arrayBuffer();
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

async function loadEvents() {
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/events`, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
      const events = res.ok ? await res.json() : [];
      if (Array.isArray(events) && events.length > 0) return events;
    } catch { /* not up yet */ }
    await sleep(3000);
  }
}

const events = await loadEvents();
const arena = events.filter((e) => e.venueKind === 'arena').map((e) => e.id);
const small = events.filter((e) => e.venueKind !== 'arena').map((e) => e.id);
const all = events.map((e) => e.id);

const PAGES = {
  events: () => get('/events'),
  event: () => get(`/events/${pick(all)}`),
  seatmap: () => get(`/events/${Math.random() < ARENA_SHARE && arena.length ? pick(arena) : pick(small)}/seatmap`),
  order: () => get(`/orders/${pick(ORDER_IDS)}`),
};

// One loop per page type. The gap between requests varies around the mean,
// and requests are not awaited, so several are in flight at once, as they
// are from several browsers.
for (const [page, perMinute] of Object.entries(RATES)) {
  (async () => {
    const mean = 60000 / perMinute;
    for (;;) {
      await sleep(mean * (0.5 + Math.random()));
      PAGES[page]();
    }
  })();
}
