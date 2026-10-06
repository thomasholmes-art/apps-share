// orders-api: the client for the payments queue. Part of box-office-estate,
// the application behind module 07, lab 07-hackathon-two-worlds.
//
// payments-sim is invoked as a function over a local queue. This client keeps
// one TCP connection to the queue, opened at start-up, and writes one JSON
// envelope per line. Replies come back on the same connection, matched to the
// waiting caller by envelope id. A caller waits at most CLIENT_TIMEOUT_MS; a
// reply that arrives later finds nobody waiting and goes to the handler
// registered with onUnmatchedReply().
//
// The connection is plain TCP rather than HTTP, so no instrumentation library
// adds anything to what is written on it.
import net from 'node:net';
import { context, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';

export const CLIENT_TIMEOUT_MS = 2000;

export interface PaymentJob {
  orderId: string;
  amountMinor: number;
  currency: string;
  payment: { card_number: string; expiry: string; cvv: string };
  token?: string;
}

export interface Envelope {
  id: string;
  queue: string;
  published_at?: number;
  timeout_ms?: number;
  correlation_id?: string;
  context?: Record<string, string>;
  body: PaymentJob;
}

export interface Reply {
  id: string;
  orderId?: string;
  auth_ref?: string;
  status?: string;
  correlation_id?: string;
}

const tracer = trace.getTracer('orders-api');
const [queueHost, queuePort] = (process.env.PAYMENTS_QUEUE ?? 'payments-sim:7070').split(':');

const waiting = new Map<string, (reply: Reply) => void>();
let unmatched: (reply: Reply) => void = () => {};

export function onUnmatchedReply(handler: (reply: Reply) => void): void {
  unmatched = handler;
}

// The connection. Lines written while it is down are held and sent once it
// is back; a caller still gives up at its timeout.
let socket: net.Socket | null = null;
let connected = false;
const outbox: string[] = [];

function connect(): void {
  const s = net.createConnection({ host: queueHost, port: Number(queuePort) });
  socket = s;
  let partial = '';
  s.setNoDelay(true);
  s.on('connect', () => {
    connected = true;
    while (outbox.length > 0) s.write(outbox.shift()!);
  });
  s.on('data', (chunk) => {
    partial += chunk.toString('utf8');
    let newline;
    while ((newline = partial.indexOf('\n')) >= 0) {
      const line = partial.slice(0, newline);
      partial = partial.slice(newline + 1);
      if (line.trim() === '') continue;
      let reply: Reply;
      try { reply = JSON.parse(line) as Reply; } catch { continue; }
      const resolve = waiting.get(reply.id);
      if (resolve) resolve(reply);
      else unmatched(reply);
    }
  });
  s.on('error', () => {});
  s.on('close', () => {
    connected = false;
    socket = null;
    setTimeout(connect, 1000);
  });
}
connect();

function write(line: string): void {
  if (connected && socket) socket.write(line);
  else outbox.push(line);
}

function publish(envelope: Envelope): Promise<Reply | null> {
  envelope.published_at = Date.now();
  envelope.timeout_ms = CLIENT_TIMEOUT_MS;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(envelope.id);
      resolve(null);
    }, CLIENT_TIMEOUT_MS);
    waiting.set(envelope.id, (reply) => {
      clearTimeout(timer);
      waiting.delete(envelope.id);
      resolve(reply);
    });
    write(`${JSON.stringify(envelope)}\n`);
  });
}

// Publishes the payment job and waits for the authorisation. The span covers
// the wait, so its duration is the time the caller spent waiting.
export async function authorise(envelope: Envelope): Promise<Reply> {
  const span = tracer.startSpan('payments.authorize', {
    kind: SpanKind.CLIENT,
    attributes: {
      'messaging.system': 'local-queue',
      'messaging.operation': 'publish',
      'client.timeout_ms': CLIENT_TIMEOUT_MS,
    },
  });
  const reply = await context.with(trace.setSpan(context.active(), span), () => {
    // TODO(telemetry-C): the envelope is written to the queue with no trace context in it.
    return publish(envelope);
  });
  if (!reply) {
    const err = new Error('payment authorisation did not respond');
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    span.end();
    throw err;
  }
  span.end();
  return reply;
}
