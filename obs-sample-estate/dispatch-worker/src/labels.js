// dispatch-worker: `deps.labelApi`, the call `label-client.mjs` retries
// (obs-sample-estate, all stages; lab 05's slow hop).
//
// With LABEL_API_URL unset (stages before lab 05) it is an in-process stub
// that succeeds first time in about 120 ms, the 30-day baseline lab 05's
// brief quotes. Lab 05's `docker-compose.dispatch.yml` sets LABEL_API_URL,
// and from then on it POSTs the job to the courier's label-api with the
// global `fetch`, so the undici instrumentation records one `POST` client
// span per attempt. Each attempt has a 1-second timeout (LABEL_TIMEOUT_MS).
// The retry count and backoff belong to `label-client.mjs`, not to this file.
const LABEL_API_URL = process.env.LABEL_API_URL;
const TIMEOUT_MS = Number(process.env.LABEL_TIMEOUT_MS ?? 1000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function labelApi(job) {
  if (!LABEL_API_URL) {
    await sleep(120);
    const n = String(job.orderId ?? Date.now()).replace(/\D/g, '');
    return { status: 200, label: { id: `lbl_${n}`, carrier: 'royal-mail', service: 'tracked-48' } };
  }
  const res = await fetch(LABEL_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(job),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status !== 200) {
    await res.body?.cancel();
    return { status: res.status, label: undefined };
  }
  return { status: 200, label: await res.json() };
}
