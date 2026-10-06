// dispatch-worker: entry point (obs-sample-estate, all stages; the batch
// lifecycle lab 05 task 4 depends on).
//
// Started by `node src/worker-main.js`, and from lab 05 on by
// `node --import ./instrumentation.mjs src/worker-main.js`.
//
// The process started by the container is a supervisor. It keeps one batch
// process forked and waiting (`child_process.fork` inherits the supervisor's
// `--import` flag, so the batch process loads the same telemetry bootstrap).
// The batch process imports `./worker.mjs` and calls `handleJob(message,
// deps)` for each job. From its first job it accepts jobs for up to
// BATCH_WINDOW_MS (2 s) or BATCH_MAX_JOBS (5), finishes them, and reports the
// batch done. The supervisor forks the next batch process at once and sends
// the finished one SIGTERM.
//
// That SIGTERM is the point of the design. A batch process lives for a few
// seconds, well short of the span processor's 5-second export timer, so any
// spans still buffered when it is told to stop are lost unless the bootstrap
// flushes on SIGTERM. The batch process installs no SIGTERM handler of its
// own, so lab 05's starter bootstrap really loses them and the solution's
// `sdk.shutdown()` really saves them. The container stays `Up` throughout.
//
// Start-up events (`service.started`, `queue.subscribed`) are written once by
// the supervisor; job events (`dispatch.received`, `dispatch.label_created`,
// `dispatch.completed`) by the batch process.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logger, forMessage } from './logger.js';
import * as spool from './spool.js';
import { labelApi } from './labels.js';

const QUEUE = 'dispatch';
const CONCURRENCY = 4;
const POLL_MS = 10;
const BATCH_WINDOW_MS = Number(process.env.BATCH_WINDOW_MS ?? 2000);
const BATCH_MAX_JOBS = Number(process.env.BATCH_MAX_JOBS ?? 5);
const IDLE_REPORT_S = 60;

if (process.env.DISPATCH_WORKER_ROLE === 'batch') {
  await runBatch();
} else {
  supervise();
}

function supervise() {
  logger.info({ event: 'service.started', concurrency: CONCURRENCY }, 'dispatch-worker started');
  logger.info({ event: 'queue.subscribed', queue: QUEUE }, 'subscribed to queue');

  let current;
  let lastJob = Date.now();
  let stopping = false;

  const spawn = () => {
    const child = fork(fileURLToPath(import.meta.url), [], {
      env: { ...process.env, DISPATCH_WORKER_ROLE: 'batch' },
    });
    child.on('message', (m) => {
      if (m === 'job') lastJob = Date.now();
      if (m === 'batch_done') {
        current = spawn();
        child.kill('SIGTERM');
      }
    });
    child.on('exit', () => {
      if (!stopping && child === current) setTimeout(() => { current = spawn(); }, 1000);
    });
    return child;
  };
  current = spawn();

  setInterval(() => {
    if (Date.now() - lastJob >= IDLE_REPORT_S * 1000) {
      logger.debug({ event: 'queue.idle', queue: QUEUE, idle_s: IDLE_REPORT_S }, 'no jobs waiting');
      lastJob = Date.now();
    }
  }, 5000).unref();

  process.once('SIGTERM', () => {
    stopping = true;
    current?.kill('SIGTERM');
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

async function runBatch() {
  const { handleJob } = await import('./worker.mjs');
  const deps = { labelApi };
  let firstJobAt;
  let taken = 0;
  let inFlight = 0;
  let closed = false;

  const handleClaimed = async (claimed) => {
    const { message } = claimed;
    const log = forMessage(message);
    const started = Date.now();
    log.info({ event: 'dispatch.received', queue: message.queue, lines: message.body?.lines?.length ?? 0 }, 'job received from queue');
    try {
      const label = await handleJob(message, deps);
      log.info({ event: 'dispatch.label_created', carrier: label.carrier, service: label.service }, 'shipping label created');
      log.info({ event: 'dispatch.completed', duration_ms: Date.now() - started }, 'job complete');
    } catch (err) {
      log.error({ event: 'dispatch.failed', error: err.code ?? err.message, duration_ms: Date.now() - started }, 'job failed');
    } finally {
      spool.done(claimed);
    }
  };

  const finishIfDone = () => {
    if (closed && inFlight === 0) {
      clearInterval(timer);
      // Wait to be stopped. Without a handle holding the event loop open the
      // process would exit by itself here, before the supervisor's SIGTERM,
      // and a bootstrap's SIGTERM flush would never run. If the supervisor
      // has gone, there is nobody to send the signal, so exit.
      setInterval(() => {}, 60_000);
      process.once('disconnect', () => process.exit(0));
      process.send?.('batch_done');
    }
  };

  const timer = setInterval(() => {
    if (closed) return;
    if (firstJobAt !== undefined && (Date.now() - firstJobAt >= BATCH_WINDOW_MS || taken >= BATCH_MAX_JOBS)) {
      closed = true;
      finishIfDone();
      return;
    }
    for (const name of spool.waiting()) {
      if (inFlight >= CONCURRENCY || taken >= BATCH_MAX_JOBS) break;
      const claimed = spool.claim(name);
      if (!claimed) continue;
      firstJobAt ??= Date.now();
      taken += 1;
      inFlight += 1;
      process.send?.('job');
      handleClaimed(claimed).finally(() => {
        inFlight -= 1;
        finishIfDone();
      });
    }
  }, POLL_MS);
}
