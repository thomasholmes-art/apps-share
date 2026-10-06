// Build-test helper for box-office-estate (module 07, lab 07-hackathon-two-worlds).
// Buys two free seats for an event through box-office, as the browser does,
// and prints one JSON line: { status, ms, body, at }.
// Usage: node purchase.mjs [eventId] [baseUrl]
const eventId = Number(process.argv[2] ?? 842);
const base = process.argv[3] ?? 'http://localhost:5180';

const map = await (await fetch(`${base}/api/events/${eventId}/seatmap`)).json();
const rows = map.rows.filter((r) => r.seats.length >= 2);
const row = rows[Math.floor(Math.random() * rows.length)];
const seatIds = row.seats.slice(0, 2).map((s) => s.id);

const at = Date.now();
const res = await fetch(`${base}/api/orders`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0' },
  body: JSON.stringify({
    eventId, seatIds, currency: 'GBP',
    customer: { email: 'buyer@example.test' },
    payment: { card_number: '4111 1111 1111 1111', expiry: '12/29', cvv: '123' },
  }),
});
const body = await res.json().catch(() => ({}));
console.log(JSON.stringify({ status: res.status, ms: Date.now() - at, body, at }));
