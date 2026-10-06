// Sends one purchase through the box office for ./verify.sh. Part of
// box-office-estate, the application behind module 07, lab
// 07-hackathon-two-worlds.
//
// Buys two free seats in one row of event 842, with the request body the
// browser sends, card details and email address included, so that gate A's
// never-emit check has something to find if a service logs the body. A row
// whose seats were taken in the meantime is answered 409 and never reaches
// payments-sim, so a 409 is retried on another row, up to three times.
//
// Usage: node tools/purchase.mjs [box-office-url]
// Prints one line to standard output: the HTTP status of the purchase, or 0
// when the box office did not answer.
const base = process.argv[2] ?? process.env.BOX_OFFICE_URL ?? 'http://localhost:5180';
const EVENT_ID = 842;
const ATTEMPTS = 3;

async function seatsInOneRow() {
  const res = await fetch(`${base}/api/events/${EVENT_ID}/seatmap`, { signal: AbortSignal.timeout(15000) });
  const map = await res.json();
  const rows = (map.rows ?? []).filter((r) => r.seats.length >= 2);
  if (rows.length === 0) return null;
  const row = rows[Math.floor(Math.random() * rows.length)];
  return row.seats.slice(0, 2).map((s) => s.id);
}

async function buy(seatIds) {
  const res = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0' },
    body: JSON.stringify({
      eventId: EVENT_ID, seatIds, currency: 'GBP',
      customer: { email: 'buyer@example.test' },
      payment: { card_number: '4111 1111 1111 1111', expiry: '12/29', cvv: '123' },
    }),
    signal: AbortSignal.timeout(30000),
  });
  await res.arrayBuffer();
  return res.status;
}

let status = 0;
try {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const seatIds = await seatsInOneRow();
    if (!seatIds) break;
    status = await buy(seatIds);
    if (status !== 409) break;
  }
} catch {
  status = 0;
}
console.log(status);
