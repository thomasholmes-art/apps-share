// dispatch-worker's client for the courier's label service. No lab task edits it.
// It is dispatch-worker's own code, it is already instrumented, and the lab
// asks for the operation to be named from the waterfall first. Read this file
// afterwards, to check the answer.
import { trace } from '@opentelemetry/api';

const ATTEMPTS = Number(process.env.LABEL_ATTEMPTS ?? 3);
const BACKOFF_MS = Number(process.env.LABEL_BACKOFF_MS ?? 400);

const tracer = trace.getTracer('dispatch-worker');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function createLabel(job, deps) {
  return tracer.startActiveSpan('dispatch.create_label', async (span) => {
    try {
      for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        const reply = await deps.labelApi(job);
        if (reply.status === 200) {
          span.setAttribute('dispatch.attempts', attempt);
          return reply.label;
        }
        if (attempt < ATTEMPTS) await sleep(BACKOFF_MS);
      }
      const err = new Error('label service did not accept the job');
      err.code = 'label_unavailable';
      throw err;
    } finally {
      span.end();
    }
  });
}
