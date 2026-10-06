// checkout-api: background timers (obs-sample-estate, stage 02 onwards).
//
// The catalogue refresh (about every 105 s) and the session prune (every
// 120 s). Their records carry no correlation id because no request caused
// them, which is part of why lab 02's coverage figure is below 100%.
import { refreshAll } from './catalog.js';
import { prune } from './sessions.js';

export function start() {
  setInterval(() => refreshAll().catch(() => {}), 105_000).unref();
  setInterval(prune, 120_000).unref();
}
