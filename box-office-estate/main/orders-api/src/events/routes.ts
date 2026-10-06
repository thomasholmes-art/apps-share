// orders-api: the browse routes. Each one forwards to seatmap and returns its
// body unchanged. Part of box-office-estate, the application behind module 07,
// lab 07-hackathon-two-worlds.
import { Router, type Request, type Response } from 'express';
import { context, trace } from '@opentelemetry/api';
import { getRPCMetadata } from '@opentelemetry/core';
import { get } from '../seatmap/client.js';

export const eventRoutes = Router();

async function forward(res: Response, path: string): Promise<void> {
  try {
    const upstream = await get(path);
    if (upstream.status === 404) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(upstream.status).type('application/json').send(upstream.body);
  } catch {
    res.status(502).json({ error: 'seatmap_unavailable' });
  }
}

// The span for the inbound request. With no telemetry attached both lookups
// return nothing and the attribute is not set.
function requestSpan() {
  return getRPCMetadata(context.active())?.span ?? trace.getActiveSpan();
}

const eventId = (req: Request) => String(Number.parseInt(String(req.params.id), 10));

eventRoutes.get('/events', (req, res) => forward(res, '/events'));

eventRoutes.get('/events/:id', (req, res) => forward(res, `/events/${eventId(req)}`));

eventRoutes.get('/events/:id/seatmap', (req, res) => {
  requestSpan()?.setAttribute('event.id', Number(eventId(req)));
  return forward(res, `/events/${eventId(req)}/seats`);
});
