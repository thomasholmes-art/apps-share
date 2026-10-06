// dispatch-worker: the receiving end of the dispatch queue (obs-sample-estate,
// all stages).
//
// checkout-api writes each message as one JSON file into `tmp/` on a volume
// both containers share, then renames it into `new/`. A worker claims a
// message by renaming it from `new/` into `cur/`; a rename either succeeds
// for exactly one claimant or fails, so two batch processes never handle the
// same job. A claimed file is deleted once the job is done.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const SPOOL = process.env.DISPATCH_SPOOL_DIR ?? '/var/spool/dispatch';
for (const dir of ['tmp', 'new', 'cur']) mkdirSync(join(SPOOL, dir), { recursive: true });

export function waiting() {
  return readdirSync(join(SPOOL, 'new')).filter((f) => f.endsWith('.json')).sort();
}

export function claim(name) {
  const claimed = join(SPOOL, 'cur', `${process.pid}-${name}`);
  try {
    renameSync(join(SPOOL, 'new', name), claimed);
  } catch {
    return undefined;
  }
  return { path: claimed, message: JSON.parse(readFileSync(claimed, 'utf8')) };
}

export function done(claimed) {
  rmSync(claimed.path, { force: true });
}
