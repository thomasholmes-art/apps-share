// orders-api: the HTTP entry point of box-office-estate. Part of the
// application behind module 07, lab 07-hackathon-two-worlds.
//
// Routes: the browse routes (events/routes.ts), POST /orders and
// GET /orders/:id (orders/handler.ts), and GET /healthz for the container
// health check. box-office's nginx forwards /api/* here with the prefix removed.
import express, { type NextFunction, type Request, type Response } from 'express';
import morgan from 'morgan';
import { withCorrelationId } from './correlation.js';
import { eventRoutes } from './events/routes.js';
import { createOrder, getOrder, announce } from './orders/handler.js';

const port = Number(process.env.PORT ?? 4000);
const app = express();
app.set('x-powered-by', false);

// The health probe runs every 5 seconds. It gets one short line of its own
// and stays out of the access log.
const clock = (d: Date) => d.toISOString().slice(11, 19);
app.get('/healthz', (req: Request, res: Response) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Math.max(1, Math.round(Number(process.hrtime.bigint() - started) / 1e6));
    console.log(`${clock(new Date())} GET /healthz ${res.statusCode} ${ms}ms`);
  });
  res.json({ status: 'ok' });
});

app.use(morgan('combined'));
app.use(withCorrelationId);
app.use(express.json({ limit: '64kb' }));

app.use(eventRoutes);
app.post('/orders', createOrder);
app.get('/orders/:id', getOrder);

// A body that is not JSON is a client error, answered without a stack trace.
app.use((err: Error & { status?: number }, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  const status = err.status && err.status < 500 ? err.status : 500;
  res.status(status).json({ error: status === 400 ? 'malformed_body' : 'internal_error' });
});

app.listen(port, () => announce(port));
