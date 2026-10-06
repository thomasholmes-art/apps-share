// orders-api: the in-memory order store. Part of box-office-estate, the
// application behind module 07, lab 07-hackathon-two-worlds.
//
// Orders live in this process only. About twenty historic orders are loaded
// from seed/orders.json at start-up so that GET /orders/:id has something to
// return; everything else is lost on restart.
import { readFileSync } from 'node:fs';

export interface Order {
  orderId: string;
  status: 'pending' | 'confirmed' | 'abandoned';
  eventId: number;
  seats: number;
  authRef?: string;
  holdIds?: string[];
}

export const orders = new Map<string, Order>();

const seed = JSON.parse(readFileSync(new URL('../../seed/orders.json', import.meta.url), 'utf8')) as Order[];
for (const o of seed) orders.set(o.orderId, o);

// Order IDs are ord_<yyyymmdd>_<4-digit daily sequence>. The sequence starts
// at the minute of the day when the process starts, so IDs issued after a
// restart do not repeat earlier ones from the same day.
let day = '';
let sequence = 0;
export function nextOrderId(now = new Date()): string {
  const today = now.toISOString().slice(0, 10).replaceAll('-', '');
  if (today !== day) {
    day = today;
    sequence = now.getUTCHours() * 60 + now.getUTCMinutes();
  }
  sequence += 1;
  return `ord_${day}_${String(sequence % 10000).padStart(4, '0')}`;
}
