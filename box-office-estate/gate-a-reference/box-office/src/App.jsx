// box-office: the ticket purchase screens. Part of box-office-estate, the
// application behind module 07, lab 07-hackathon-two-worlds.
//
// Event list, seat map, payment form, then a confirmation page or the error
// page. Every call goes to /api/, which nginx forwards to orders-api. The
// front end is out of scope for instrumentation and sends no correlation
// header.
import { useEffect, useState } from 'react';

const DEFAULT_EVENT = 842;
const MAX_SEATS = 6;
const TEST_CARD = { card_number: '4111 1111 1111 1111', expiry: '12/29', cvv: '123' };

const pounds = (minor) => `£${(minor / 100).toFixed(2)}`;
const when = (iso) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

async function getJson(path) {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function EventList({ events, current, onPick }) {
  return (
    <nav className="events">
      {events.map((e) => (
        <button key={e.id} className={e.id === current ? 'event current' : 'event'} onClick={() => onPick(e.id)}>
          <strong>{e.name}</strong>
          <span>{e.venue}, {when(e.startsAt)}</span>
          <span>{pounds(e.priceMinor)}</span>
        </button>
      ))}
    </nav>
  );
}

function SeatMap({ seatmap, chosen, onToggle }) {
  if (!seatmap) return <p className="loading">Loading seats</p>;
  return (
    <div className="seatmap">
      <p>{seatmap.free} seats free at {seatmap.venue}. Choose up to {MAX_SEATS}.</p>
      {seatmap.rows.filter((r) => r.seats.length > 0).map((r) => (
        <div className="row" key={r.row}>
          <span className="label">{r.row}</span>
          {r.seats.map((s) => (
            <button key={s.id} className={chosen.includes(s.id) ? 'seat chosen' : 'seat'} onClick={() => onToggle(s.id)} title={`${r.row} seat ${s.n}`}>
              {s.n}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function PaymentForm({ event, chosen, onPay, busy }) {
  const [email, setEmail] = useState('buyer@example.test');
  const [card, setCard] = useState(TEST_CARD);
  const set = (k) => (ev) => setCard({ ...card, [k]: ev.target.value });
  return (
    <form className="payment" onSubmit={(ev) => { ev.preventDefault(); onPay(email, card); }}>
      <h2>Pay for {chosen.length} {chosen.length === 1 ? 'seat' : 'seats'}: {pounds(event.priceMinor * chosen.length)}</h2>
      <label>Email <input type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} required /></label>
      <label>Card number <input value={card.card_number} onChange={set('card_number')} required /></label>
      <label>Expiry <input value={card.expiry} onChange={set('expiry')} required /></label>
      <label>Security code <input value={card.cvv} onChange={set('cvv')} required /></label>
      <button type="submit" disabled={busy || chosen.length === 0}>{busy ? 'Processing' : 'Buy tickets'}</button>
    </form>
  );
}

export function App() {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState(DEFAULT_EVENT);
  const [seatmap, setSeatmap] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);

  useEffect(() => { getJson('/events').then(setEvents).catch(() => setEvents([])); }, []);
  useEffect(() => {
    setSeatmap(null);
    setChosen([]);
    getJson(`/events/${eventId}/seatmap`).then(setSeatmap).catch(() => setSeatmap({ venue: '', free: 0, rows: [] }));
  }, [eventId, outcome]);

  const event = events.find((e) => e.id === eventId);
  const toggle = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < MAX_SEATS ? [...c, id] : c));

  async function pay(email, card) {
    setBusy(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId, seatIds: chosen, currency: 'GBP', customer: { email }, payment: card }),
      });
      const body = await res.json().catch(() => ({}));
      setOutcome(res.ok ? { ok: true, ...body } : { ok: false, status: res.status });
    } catch {
      setOutcome({ ok: false, status: 0 });
    } finally {
      setBusy(false);
    }
  }

  if (outcome?.ok) {
    return (
      <main className="page">
        <h1>Order confirmed</h1>
        <p>Order {outcome.orderId}, payment reference {outcome.authRef}.</p>
        <button onClick={() => setOutcome(null)}>Back to the events</button>
      </main>
    );
  }
  if (outcome && !outcome.ok) {
    return (
      <main className="page error">
        <h1>Something went wrong</h1>
        <p>The order was not completed and no payment was taken. Try again.</p>
        <button onClick={() => setOutcome(null)}>Back to the seats</button>
      </main>
    );
  }
  return (
    <main className="page">
      <h1>Box office</h1>
      <EventList events={events} current={eventId} onPick={setEventId} />
      <SeatMap seatmap={seatmap} chosen={chosen} onToggle={toggle} />
      {event && <PaymentForm event={event} chosen={chosen} onPay={pay} busy={busy} />}
    </main>
  );
}
