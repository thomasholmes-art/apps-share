// orders-api: the HTTP client for seatmap. Part of box-office-estate, the
// application behind module 07, lab 07-hackathon-two-worlds.
//
// Every request carries x-correlation-id through outboundHeaders(), which is
// lab 02's pattern for HTTP calls.
import { outboundHeaders } from '../correlation.js';

const base = process.env.SEATMAP_URL ?? 'http://seatmap:8080';

export interface Upstream {
  status: number;
  body: Buffer;
}

export async function get(path: string): Promise<Upstream> {
  const res = await fetch(`${base}${path}`, { headers: outboundHeaders({ accept: 'application/json' }) });
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
}

async function post<T>(path: string, payload: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: outboundHeaders({ 'content-type': 'application/json', accept: 'application/json' }),
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as T };
}

export interface HoldResult {
  status: number;
  holdIds: string[];
  priceMinor: number;
  refused: number[];
}

export async function holdSeats(eventId: number, seatIds: number[], orderRef: string): Promise<HoldResult> {
  const { status, json } = await post<Partial<HoldResult>>('/holds', { eventId, seatIds, orderRef });
  return {
    status,
    holdIds: json.holdIds ?? [],
    priceMinor: json.priceMinor ?? 0,
    refused: json.refused ?? [],
  };
}

export async function releaseHolds(holdIds: string[]): Promise<void> {
  await post('/holds/release', { holdIds });
}
