// payments-sim: the function host. Part of box-office-estate, the application
// behind module 07, lab 07-hackathon-two-worlds.
//
// payments-sim is deployed the way a managed function is. This long-lived
// process plays the platform's part: it accepts payment jobs from the queue,
// keeps at most one execution environment, and invokes the handler in it.
//
//   - Jobs arrive as newline-delimited JSON envelopes on TCP port 7070, and
//     each reply goes back on the connection the job came in on.
//   - The execution environment is a child process started from
//     worker-main.js. A job that arrives when no environment exists starts
//     one, and waits while it is created.
//   - One job runs at a time; jobs that arrive meanwhile wait their turn.
//   - After IDLE_TIMEOUT_S seconds with no job, measured from the end of the
//     last one, the environment is shut down: SIGTERM, which lets
//     telemetry.mjs flush, then SIGKILL after five seconds.
//
// The host itself writes nothing to standard output or standard error. The
// execution environment shares the container's output.
import net from 'node:net';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const PORT = 7070;
const IDLE_TIMEOUT_S = 90;
const SHUTDOWN_GRACE_MS = 5000;
// The host collects jobs from the queue for this long before it invokes the
// handler, as an event source mapping's batching window does.
const BATCH_WINDOW_MS = 40;

// Shortens the idle timeout for the estate's own build test. Unset in the
// application's compose file.
const idleTimeoutS = Number(process.env.BUILD_TEST_IDLE_TIMEOUT_S ?? IDLE_TIMEOUT_S);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let environment = null;
let idleTimer = null;
let running = false;
const queue = [];

function createEnvironment() {
  const child = fork(new URL('./worker-main.js', import.meta.url), [], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const env = { child, calls: new Map() };
  env.ready = new Promise((resolve, reject) => {
    child.once('exit', () => reject(new Error('execution environment exited during start-up')));
    child.on('message', (msg) => {
      if (msg?.type === 'ready') resolve();
      if (msg?.type === 'result') {
        env.calls.get(msg.invocationId)?.(msg);
        env.calls.delete(msg.invocationId);
      }
    });
  });
  env.ready.catch(() => {});
  child.on('exit', () => {
    for (const settle of env.calls.values()) settle({ error: 'execution environment exited' });
    env.calls.clear();
    if (environment === env) environment = null;
  });
  return env;
}

function shutDown(env) {
  if (environment === env) environment = null;
  env.child.kill('SIGTERM');
  const kill = setTimeout(() => env.child.kill('SIGKILL'), SHUTDOWN_GRACE_MS);
  env.child.once('exit', () => clearTimeout(kill));
}

function invoke(env, envelope, invocation) {
  return new Promise((resolve) => {
    env.calls.set(invocation.invocationId, resolve);
    env.child.send({ type: 'job', envelope, invocation });
  });
}

async function drain() {
  if (running) return;
  running = true;
  clearTimeout(idleTimer);
  try {
    while (queue.length > 0) {
      const job = queue.shift();
      const wait = job.receivedAt + BATCH_WINDOW_MS - Date.now();
      if (wait > 0) await sleep(wait);

      let coldStart = false;
      if (!environment) {
        environment = createEnvironment();
        coldStart = true;
      }
      const env = environment;
      try {
        await env.ready;
      } catch {
        continue;
      }
      const publishedAt = Number(job.envelope.published_at ?? job.receivedAt);
      const invocation = {
        invocationId: randomUUID(),
        coldStart,
        queuedMs: Date.now() - publishedAt,
        idleTimeoutS: idleTimeoutS,
      };
      const outcome = await invoke(env, job.envelope, invocation);
      const reply = outcome.result ?? { id: job.envelope.id, status: 'failed' };
      if (!job.socket.destroyed) job.socket.write(`${JSON.stringify(reply)}\n`);
    }
  } finally {
    running = false;
    if (environment) {
      const env = environment;
      idleTimer = setTimeout(() => shutDown(env), idleTimeoutS * 1000);
    }
  }
}

const server = net.createServer((socket) => {
  let partial = '';
  socket.setNoDelay(true);
  socket.on('error', () => {});
  socket.on('data', (chunk) => {
    partial += chunk.toString('utf8');
    let newline;
    while ((newline = partial.indexOf('\n')) >= 0) {
      const line = partial.slice(0, newline);
      partial = partial.slice(newline + 1);
      if (line.trim() === '') continue;
      let envelope;
      try { envelope = JSON.parse(line); } catch { continue; }
      queue.push({ envelope, socket, receivedAt: Date.now() });
    }
    drain();
  });
});

server.listen(PORT);

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close();
    if (environment) shutDown(environment);
    setTimeout(() => process.exit(0), 200).unref();
  });
}
