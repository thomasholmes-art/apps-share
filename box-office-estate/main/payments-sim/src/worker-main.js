// payments-sim: the execution environment. Part of box-office-estate, the
// application behind module 07, lab 07-hackathon-two-worlds.
//
// host.js starts this process when a job arrives and no environment exists,
// and shuts it down after it has been idle. Each job it receives is passed to
// handle() in consumer.js.
import './telemetry.mjs';
import { handle } from './consumer.js';

// Creating an execution environment on the platform payments-sim is deployed
// to takes about 3.3 seconds from the platform's decision to create it: the
// deployment package is fetched, the runtime starts, and module
// initialisation runs. Starting this process is the real part of that; the
// remainder is waited out here, measured from the moment the process started.
const ENVIRONMENT_CREATION_MS = 3270;

const remaining = ENVIRONMENT_CREATION_MS - performance.now();
if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));

process.on('message', async (msg) => {
  if (msg?.type !== 'job') return;
  const { envelope, invocation } = msg;
  try {
    const result = await handle(envelope, invocation);
    process.send({ type: 'result', invocationId: invocation.invocationId, result });
  } catch (err) {
    process.send({ type: 'result', invocationId: invocation.invocationId, error: String(err?.message ?? err) });
  }
});

process.send({ type: 'ready' });
