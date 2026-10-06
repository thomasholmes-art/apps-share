// checkout-api: the dispatch-queue broker client (obs-sample-estate, stage 02
// onwards; the connection cost behind lab 04's bottleneck).
//
// Same interface as the stand-in in lab 04's `code/starter/broker.mjs`:
// `connect()` resolves to a connection with `send(message)`, `close()` and a
// `closed` flag. Here the costs are real waits: opening a connection takes
// DISPATCH_CONNECT_MS (617 ms in the sample application, a round trip plus a handshake)
// and a send takes DISPATCH_SEND_MS (about 25 ms). Whether that 617 ms lands
// on every checkout depends only on the publisher above this client
// (`dispatch-publisher.mjs`), which is what lab 04 changes.
//
// The transport is a spool directory on a volume shared with dispatch-worker:
// each message is written to `tmp/` and renamed into `new/`, so the worker
// never reads a half-written file. There is no broker container, because the
// sample application has four processes.
//
// Opening and closing log debug records through `log()` from
// `correlation.js`, so inside a request they carry its correlation id
// (lab 04 artefact `checkout-api-logs-slow-request.jsonl`). The opening
// record is written when the handshake starts, and `open_ms` on the closing
// record counts from then, as in that artefact.
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { log } from './correlation.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createBroker({
  connectMs = Number(process.env.DISPATCH_CONNECT_MS ?? 617),
  sendMs = Number(process.env.DISPATCH_SEND_MS ?? 25),
  spoolDir = process.env.DISPATCH_SPOOL_DIR ?? '/var/spool/dispatch',
} = {}) {
  for (const dir of ['tmp', 'new']) mkdirSync(join(spoolDir, dir), { recursive: true });
  let connects = 0;
  let sends = 0;
  const open = new Set();

  return {
    stats: () => ({ connects, sends, openConnections: open.size }),

    async connect() {
      connects += 1;
      const openedAt = Date.now();
      log().debug(
        { event: 'dispatch.connection_opened', broker: 'dispatch-queue', reused: false },
        'opened a new broker connection',
      );
      await sleep(connectMs);
      const connection = {
        id: `conn-${connects}`,
        closed: false,
        async send(message) {
          if (connection.closed) throw new Error('send on a closed connection');
          await sleep(sendMs);
          const name = `${Date.now()}-${randomUUID()}.json`;
          writeFileSync(join(spoolDir, 'tmp', name), JSON.stringify(message));
          renameSync(join(spoolDir, 'tmp', name), join(spoolDir, 'new', name));
          sends += 1;
          return { accepted: true, id: message.body?.orderId ?? message.orderId };
        },
        async close() {
          if (connection.closed) return;
          connection.closed = true;
          open.delete(connection);
          log().debug(
            { event: 'dispatch.connection_closed', broker: 'dispatch-queue', open_ms: Date.now() - openedAt },
            'closed the broker connection',
          );
        },
      };
      open.add(connection);
      return connection;
    },
  };
}
