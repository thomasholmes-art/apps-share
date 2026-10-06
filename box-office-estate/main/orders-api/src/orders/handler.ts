// orders-api: the purchase. POST /orders and GET /orders/:id. Part of
// box-office-estate, the application behind module 07,
// lab 07-hackathon-two-worlds.
//
// A purchase holds the seats in seatmap, publishes a payment job to
// payments-sim and waits for the authorisation. If the authorisation does not
// arrive in time, the holds are released and the customer gets a 502.
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { authorise, onUnmatchedReply, CLIENT_TIMEOUT_MS, type Envelope } from '../payments/queue-client.js';
import { holdSeats, releaseHolds } from '../seatmap/client.js';
import { orders, nextOrderId } from './store.js';

type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

// TODO(telemetry-A): say() writes plain text and discards the level, event name and fields it is given, and the payment job envelope built in createOrder() carries no correlation identifier.
function say(level: Level, event: string, msg: string, fields: Fields = {}): void {
  console.log(`${new Date().toISOString()} orders: ${msg}`);
  if (fields.err instanceof Error) console.log(fields.err.stack);
}

export function announce(port: number): void {
  say('info', 'server.started', `listening on :${port}`);
}

interface OrderRequest {
  eventId: number;
  seatIds: number[];
  currency: string;
  payment: { card_number: string; expiry: string; cvv: string };
}

function parse(body: unknown): OrderRequest | null {
  const b = (body ?? {}) as Record<string, any>;
  const seatIds = Array.isArray(b.seatIds) ? b.seatIds.map(Number) : [];
  const p = b.payment ?? {};
  if (!Number.isInteger(b.eventId)) return null;
  if (seatIds.length === 0 || seatIds.length > 10 || !seatIds.every(Number.isInteger)) return null;
  if (typeof p.card_number !== 'string' || typeof p.expiry !== 'string' || typeof p.cvv !== 'string') return null;
  return {
    eventId: b.eventId,
    seatIds,
    currency: typeof b.currency === 'string' ? b.currency : 'GBP',
    payment: { card_number: p.card_number, expiry: p.expiry, cvv: p.cvv },
  };
}

// A reply for a purchase that has already been abandoned.
onUnmatchedReply((reply) => {
  const fields = { correlation_id: reply.correlation_id, order_id: reply.orderId, auth_ref: reply.auth_ref };
  say('info', 'payment.authorised', `payment authorised auth_ref=${reply.auth_ref} order ${reply.orderId}`, fields);
  say('warn', 'payment.discarded', `no pending order for auth_ref=${reply.auth_ref}, discarding`, fields);
});

export async function createOrder(req: Request, res: Response): Promise<void> {
  const order = parse(req.body);
  if (!order) {
    res.status(400).json({ error: 'malformed_order' });
    return;
  }
  const orderId = nextOrderId();
  say('info', 'order.received', `new order seats=${order.seatIds.length} event=${order.eventId} currency=${order.currency}`,
    { order_id: orderId, event_id: order.eventId, seats: order.seatIds.length });

  let hold;
  try {
    hold = await holdSeats(order.eventId, order.seatIds, orderId);
  } catch (err) {
    say('error', 'hold.failed', `seatmap did not answer for order ${orderId}`, { order_id: orderId, err });
    res.status(502).json({ error: 'seatmap_unavailable' });
    return;
  }
  if (hold.status === 409) {
    say('warn', 'hold.refused', `seats unavailable for order ${orderId}`, { order_id: orderId, refused: hold.refused });
    res.status(409).json({ error: 'seats_unavailable', seatIds: hold.refused });
    return;
  }
  if (hold.status !== 201) {
    res.status(hold.status === 404 ? 404 : 400).json({ error: 'hold_rejected' });
    return;
  }
  orders.set(orderId, { orderId, status: 'pending', eventId: order.eventId, seats: order.seatIds.length, holdIds: hold.holdIds });

  say('info', 'payment.published', 'seats held, publishing payment job', { order_id: orderId, hold_ids: hold.holdIds });
  const envelope: Envelope = {
    id: randomUUID(),
    queue: 'payments',
    body: {
      orderId,
      amountMinor: hold.priceMinor * order.seatIds.length,
      currency: order.currency,
      payment: order.payment,
    },
  };

  try {
    const reply = await authorise(envelope);
    say('info', 'payment.authorised', `payment authorised auth_ref=${reply.auth_ref} order ${orderId}`,
      { order_id: orderId, auth_ref: reply.auth_ref });
    orders.set(orderId, { orderId, status: 'confirmed', eventId: order.eventId, seats: order.seatIds.length, authRef: reply.auth_ref, holdIds: hold.holdIds });
    say('info', 'order.confirmed', `order confirmed ${orderId}`, { order_id: orderId, auth_ref: reply.auth_ref });
    res.status(201).json({ orderId, status: 'confirmed', authRef: reply.auth_ref, holdIds: hold.holdIds });
  } catch (err) {
    say('error', 'payment.abandoned', `payment call abandoned after ${CLIENT_TIMEOUT_MS}ms`, { order_id: orderId, err });
    say('warn', 'hold.released', `releasing holds for order ${orderId}`, { order_id: orderId, hold_ids: hold.holdIds });
    try { await releaseHolds(hold.holdIds); } catch { /* the holds stay until the next reset */ }
    orders.set(orderId, { orderId, status: 'abandoned', eventId: order.eventId, seats: order.seatIds.length, holdIds: hold.holdIds });
    res.status(502).json({ error: 'payment_unavailable', message: 'payment authorisation did not respond' });
  }
}

export function getOrder(req: Request, res: Response): void {
  const o = orders.get(String(req.params.id));
  if (!o) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ orderId: o.orderId, status: o.status, eventId: o.eventId, seats: o.seats, authRef: o.authRef });
}
