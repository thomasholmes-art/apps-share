# box-office-estate: build test results

Recorded 2026-10-02 on the authoring VM, which is the expected seed for the lab
image: Docker Engine with Compose 2.40.3, SigNoz v0.144.0 installed by
`lab-image/signoz/provision-signoz.sh`, and the obs-sample-estate running at the
same time. The tests are spec section 9 (T1-T13) plus build checks (S1-S4, V1-V3)
and three checks against real SigNoz. They were run with `build-test.sh`.

Host settings for the live runs: `AGENT_JAR` pointed at a cached copy of the
OpenTelemetry Java agent 2.31.1 (the VM has no `/opt/otel`), and
`SEATMAP_HEAP=192m`, which caps seatmap's heap through `JAVA_TOOL_OPTIONS`.
Neither is part of the checkout; `build-test.sh` writes them into an untracked
`docker-compose.override.yml`.

Live results come from three runs on the same commit line:

- run 2: all sections, at commit a0a06ed;
- run 3: the gate A section and then the gate B and gate C sections, at commit
  c24a389. Commit c24a389 changed how `verify.sh` chooses the purchase (see
  "Defects found and fixed").

The table gives the latest result for each test. Gate A results are from run 3.
Gate B and gate C results are from run 3. Main-branch results (T2, T3, T4) are
from run 2 and match run 1. T1 is from a separate run of `verify.sh` alone.

## Results

| Test | Result | Evidence |
|---|---|---|
| S1 markers | PASS | `TODO(telemetry-…)` counts: main 7, gate-a-reference 4, gate-b-reference 2, gate-c-reference 0 |
| S2 snapshots | PASS | `test/make-gates.py` regenerates all three reference snapshots from `main/` byte for byte |
| S3 make-checkout | PASS | Four branches. Each reference branch is one commit on the previous one, and each branch's tree equals its snapshot |
| S4 forbidden text | PASS | No `--require`, `429`, "rate limit" or "Too Many Requests" in `main/` |
| T1 shipped main, no purchase | PASS | Fresh `main` checkout at 13:07, with no purchase in SigNoz in the last 30 minutes and no dashboard: `verify: no purchase in the last 30 minutes`, four `GATE X FAIL` lines, exit 1. The connection audit recorded `localhost:8080` only |
| T2 cold path | PASS | 502 in 2,038 ms through box-office (publish to abandon 2,000 ms). The late reply came 3,497 ms after publish and was followed by the discard line. All eleven line-format checks pass (legacy `orders:` lines, stack frames `dist/payments/queue-client.js` and `dist/orders/handler.js`, combined access line, health probe line, no level or identifier, no 429). payments-sim wrote 0 lines |
| T2 trace (gate-c-reference) | NOTE | Cold purchase: `POST /orders` 2,096 ms ERROR; `payments.authorize` 2,000 ms ERROR with `client.timeout_ms` 2000; `payments.handle` starts 3,395 ms in and runs 190 ms, `faas.coldstart` true, `queue.wait_ms` 3,321 (spec: 3,310 ± 150) |
| T3 warm path | PASS | On gate-c-reference: 201 in 251 ms, `payments.authorize` 224 ms. On main: 201 in 231 ms |
| T4 idle boundary | PASS | About 85 s idle: 201 in 255 ms (warm). About 95 s idle: 502 in 2,038 ms (cold) |
| T5 fault 2 calibration | FAIL | gate-b-reference, 50 requests each. Arena: root p95 1,856 ms (pass); 452 query spans in every trace; `venue.seat_rows` 452. Theatre: root p95 48.4 ms, below the 50-90 ms range; 10 query spans; `venue.seat_rows` 10. Query spans: median 3.92 ms (arena) and 3.67 ms (theatre), p99 4.75 ms; 49 of 22,600 arena spans and 1 of 500 theatre spans are over 5 ms, the longest 8.7 ms. Run 2 gave theatre p95 50.0 ms and 40 arena spans over 5 ms. See "Open items" |
| T6 branch matrix | PASS | gate-a-reference: A PASS, B FAIL, C FAIL, D PASS. gate-b-reference: A PASS, B PASS, C FAIL ("payments-sim absent from the purchase trace"), D PASS. gate-c-reference: A, B, C and D PASS. The reference dashboard was imported through `/api/v2/dashboards` for these runs and deleted afterwards |
| T7 Node log exporter default | PASS | Without `OTEL_LOGS_EXPORTER`, the Node SDK with `--import ./instrumentation.mjs` sent 1 request to `/v1/logs`. With `OTEL_LOGS_EXPORTER=none` it sent none. The SDK does build a log exporter from its defaults, so the pre-set `OTEL_LOGS_EXPORTER: none` stays |
| T8 per-call ID | PASS | `GATE A FAIL: no correlation_id carries records from both orders-api and payments-sim` |
| T8 pattern unchanged | PASS | `GATE A FAIL: 11 seatmap log record(s) with no trace_id; the agent is not attached or the logging pattern does not reference the MDC; …` |
| T8 grpc protocol on seatmap | PASS | `GATE B FAIL: no spans reported by seatmap; …` |
| T8 extract without the parent | PASS | `GATE C FAIL: one purchase produced 2 traces; expected 1; payments-sim span b1e5ee06e56ba984 has no parent; the extracted context was never made active` |
| T9 verify.sh sends nothing | PASS | During a `verify.sh` run on gate-c-reference, `POST /orders` access lines stayed at 2 and payments-sim lines at 2. A connection audit loaded into both Node processes recorded connections to `localhost:8080` only |
| T10 never-emit | PASS | Logging the whole request body at gate A: `card number present in a log body (event order.body)`, `card security code present …`, `email address present …` |
| T11 offline rebuild | PASS | After a source edit, `docker compose build orders-api payments-sim` with every build step's HTTP proxy set to a closed port succeeded. Both `npm ci` layers came from the cache. The only step that ran was `RUN npx tsc` (run 2). `docker compose restart seatmap` succeeded and the estate answered. Base images were already local |
| T12 reference-sources parity | PASS | 12 files byte-identical to `main/` or `gate-c-reference/`. `tools/gate-checks.mjs` is identical to the lab 07 starter's in all four snapshots |
| T13 courseware verifier | PASS | 21 PASS, 0 FAIL, 0 SKIP. Assertion 9 (SigNoz answering) passes rather than skipping because SigNoz runs on this VM. The spec's 20 PASS and 1 SKIP is the result with no SigNoz. No fixture was edited |
| V1 verify.sh, SigNoz down | PASS | Four `GATE X FAIL: SigNoz is not answering on …, so this gate cannot be checked; …` lines, exit 1 |
| V2 verify.sh, no data | PASS | Four FAIL lines and exit 1 against the stub with no telemetry and no dashboard |
| V3 verify.sh fails when it should | PASS | 9 of 9 cases: a recorded gate-c-reference export passes all four gates, and each fault (payments-sim missing, orphan payments-sim span, seatmap lines without trace context, card number and email in a body, two traces, no dashboard, latency panel not split, no purchase) gives the expected FAIL message and exit 1 |
| `signoz_calls_total` labels | PASS | 29 series for orders-api grouped by `operation`, `status.code` and `http.status_code`, for example `{"operation":"GET","status.code":"STATUS_CODE_UNSET","http.status_code":"200"}`. The same filter written as `service_name = 'orders-api'` matches 0 series |
| Reference dashboard queries | PASS | Each panel's queries, run through `/api/v5/query_range`, return series: p95 latency 10, error rate 16, throughput 6 |
| `reserve.shortfall` label | not applicable | `reserve.shortfall` is lab 06's span-metrics dimension on `checkout-api`. box-office-estate does not set it |
| UI click paths | untested here | They need a browser session. The dashboard's queries were checked through the API instead |

## T4 question: the 2.28 s cold 502

The earlier 2.28 s figure was measured under rootless podman. The podman variant
ran seatmap with `-XX:TieredStopAtLevel=1` (C1 JIT only) and a 256 MB heap, on a
host that was using swap. The time beyond the 2,000 ms wait was spent in
seatmap's hold before the publish and its release after the abandon. Measured
then: `new order` to `hold granted` took 81 ms when cold and 30 ms when warm,
and the release took about 27 ms. The hold and release code is one INSERT
inside a transaction and one UPDATE, as the spec requires.

Under Docker on the same VM, with full JIT, the cold 502 takes 2,038-2,042 ms,
inside T2's 1.9-2.1 s. The first purchase after the estate starts takes
2,109-2,133 ms, because seatmap has not yet compiled its hold path.

The late reply is the designed behaviour, not a defect. It arrives 3,492-3,557
ms after publish, which is inside T2's 3.3-3.7 s.

## Defects found and fixed during these runs

- **SIGTERM ignored.** `orders-api`, `payments-sim` and `customers` run Node as
  process 1 and ignored SIGTERM. They now run with `init: true`. `seatmap`
  waited on a request whose database connection had closed; it now has a
  5-second shutdown phase and a 5-second connection timeout. All containers now
  stop within the 10-second limit.
- **SigNoz v0.144 dashboards API.** `/api/v1/dashboards` returns the UI's HTML
  page. `tools/signoz.mjs` now lists `/api/v2/dashboards`, fetches each
  dashboard by ID and reads the schema-v6 panel format. The reference dashboard
  is stored in that format. A legacy-format import was converted by SigNoz into
  invalid filter expressions such as `(…) name EXISTS`.
- **Span attribute names.** SigNoz v0.144 reads `event.id` as context `event`
  plus key `id` and rejects the query with HTTP 400. Span attributes are now
  requested with `fieldContext: attribute`, which also stops a query failing
  when an attribute has not been reported yet.
- **Log times truncated to whole seconds.** Docker's fluentd driver sends
  milliseconds only with `fluentd-sub-second-precision: "true"`, now set in
  compose.
- **Never-emit check blind to non-message fields.** The export carried only
  pino's `msg` as the body, so a card number logged under another key was not
  seen. Each Node record in the export now also carries `line`, the whole line
  as written.
- **Stale purchase chosen.** `verify.sh` took the newest `POST /orders` span in
  preference to any newer purchase without spans. On a branch where orders-api
  emits no spans, it then checked an older purchase, which could give a false
  PASS. It now takes the newest purchase of any kind, and uses its span when
  one exists.

## Open items

- **verify.sh changed after these runs.** On 2026-10-02, after the runs
  above, `verify.sh` was changed to send two purchases and check the second
  (README, "Departures from the spec's compose listing"). T1 and T9 above
  record the earlier behaviour. A targeted live run on gate-c-reference and
  main is recorded under "verify.sh sends its own purchase" below. T9 with
  the new behaviour passed in run 4 (below). A live run of the main section
  with the new T1 is still owed.

- **T5 calibration.** Two criteria are missed by small margins: theatre root p95
  is 48-50 ms against 50-90 ms, and 0.2-0.3% of query spans exceed 5 ms (up to
  9 ms). The median query span is 3.9 ms. Raising the netem delay would bring
  theatre p95 to 50 ms but push more query spans over 5 ms. The spans over 5 ms
  are most likely garbage-collection pauses under the 192 MB heap cap on a
  shared host. Re-measure on a lab VM without the heap cap before changing
  `LINK_DELAY`. If the outliers remain, `MA:184` ("no individual query exceeds
  5 milliseconds") needs rewording.
- **T1 needs a quiet SigNoz.** T1 fails when SigNoz holds a purchase from the
  last 30 minutes, which happens whenever the build test runs twice in a row.
  `verify.sh` is then correctly checking that purchase.
- The seed VM's SigNoz now holds box-office-estate telemetry. Run
  `lab-image/signoz/provision-signoz.sh reset-data` before the VM is cloned.

## verify.sh sends its own purchase (targeted live run, 2026-10-02)

Run on the authoring VM under `/tmp/obstooling-estate-run.lock`, from a fresh
`make-checkout.sh` checkout, with the same agent and heap override as above.
Each branch was started and left idle for 100 seconds before the first run.
The two diagnostic messages were reworded after this run; the logic is the
same.

| Check | Result | Evidence |
|---|---|---|
| gate-c-reference, first run after 100 s idle | PASS | First purchase sent and not checked; checked purchase HTTP 201; GATE A, B, C PASS, GATE D FAIL (no dashboard on this SigNoz). The export holds one trace; `payments.authorize` 210 ms, `faas.coldstart` false, `queue.wait_ms` 40. Run time 25 s |
| gate-c-reference, second run straight after | PASS | Same four lines; checked purchase found by its `POST /orders` span |
| Fault 1 after verify.sh | PASS | A purchase straight after the runs: 201 in 275 ms. After 100 s idle: 502 in 2,037 ms |
| main, first run after 100 s idle | PASS | Checked purchase HTTP 201, found by its "new order" line; four GATE FAIL lines, exit 1 |

## Run 4: gate A, B and C sections (2026-10-02)

`ONLY="gate-a gate-b gate-c" build-test.sh live` at commit 374b74a, holding
`/tmp/obstooling-estate-run.lock`, with `SEATMAP_HEAP=192m` and `AGENT_JAR` set
to the cached Java agent 2.31.1. The main section (T1, T2 path, T4) was not run.

| Test | Result | Evidence |
|---|---|---|
| T6 gate-a-reference | PASS | A PASS, B FAIL, C FAIL, D PASS |
| T8 per-call ID | PASS | `GATE A FAIL: no correlation_id carries records from both orders-api and payments-sim` |
| T8 pattern unchanged | PASS | `GATE A FAIL: 11 seatmap log record(s) with no trace_id; …` |
| T10 never-emit | PASS | card number, card security code and email address each reported in a log body |
| T6 gate-b-reference | PASS | A PASS, B PASS, C FAIL ("payments-sim absent from the purchase trace"), D PASS |
| T5 fault 2 calibration | FAIL | Arena: root p95 1,832 ms, 452 query spans per trace, `venue.seat_rows` 452, median query span 3.92 ms, 46 of 22,600 over 5 ms (max 8.6 ms). Theatre: root p95 49.2 ms (below 50-90 ms), 10 query spans, none over 5 ms. Same near-miss as runs 2 and 3; see "Open items" |
| T8 grpc protocol on seatmap | PASS | `GATE B FAIL: no spans reported by seatmap; …` |
| T7 Node log exporter default | PASS | 1 request to `/v1/logs` without `OTEL_LOGS_EXPORTER`, 0 with `none` |
| T6 gate-c-reference | PASS | A, B, C and D PASS |
| T2 trace (gate-c-reference) | NOTE | `POST /orders` 2,111 ms ERROR; `payments.authorize` 2,001 ms ERROR, timeout 2000; `payments.handle` starts 3,407 ms in, runs 171 ms, `faas.coldstart` true, `queue.wait_ms` 3,322; 21 spans |
| T3 warm path | PASS | 201 in 238 ms; `payments.authorize` 214 ms |
| T9 verify.sh sends nothing else | PASS | `POST /orders` access lines 6 before and 8 after one `verify.sh` run (the two purchases it sends); GATE C PASS; connections to `localhost:5180` and `localhost:8080` only |
| `signoz_calls_total` labels | PASS | 29 series with dotted `status.code` |
| D17 dashboard queries | PASS | All three panels return series: error rate by route 16, throughput by route 6, p95 latency by route split by outcome 10 |
| T8 extract without the parent | PASS | `GATE C FAIL: one purchase produced 2 traces; expected 1; … the extracted context was never made active` |
| T11 offline rebuild | PASS | Build, recreate and seatmap restart exit 0 with the registry unreachable; both `npm ci` layers from cache; only `npx tsc` ran |

A first attempt of this run failed before any test: `/opt/otel/opentelemetry-javaagent-2.31.1.jar`
on this host is an empty root-owned directory (created 15:55, most likely by
Docker bind-mounting a path that did not exist), so seatmap's JVM could not load
the agent and exited. Set `AGENT_JAR` explicitly, or remove that directory and
install the jar, before running live.

## Rollback points replace the git branches (static run, 2026-10-05)

`make-checkout.sh` and its four-branch git checkout were replaced by
`make-estate.sh`, which builds a plain directory with `bin/stage` and
`stages/start/`, `stages/gate-a/`, `stages/gate-b/` and `stages/gate-c/`.
`tools/export-telemetry.mjs` now records `.stage` as `stage` instead of
calling git for the branch name. The live sections of `build-test.sh` now
move between states with `bin/stage` and restore one-off edits with it; they
have not been run since this change, so the live results above are from the
git checkout. `build-test.sh static` on the authoring VM:

| Test | Result | Evidence |
|---|---|---|
| S1 markers | PASS | main 7, gate-a-reference 4, gate-b-reference 2, gate-c-reference 0 |
| S2 snapshots | PASS | All three reference snapshots regenerate identically |
| S3 make-estate | PASS | `test/stage-test.sh`: 67 checks passed, 0 failed. Two builds identical; no `.git`; after each of `bin/stage a, a, b, c, start, c, b, a, start` the shipped files equal the matching snapshot, `telemetry-spec.md` and an unshipped file are untouched, one backup directory is added and the last line printed is `docker compose up -d --build`; the repeated `a` changes nothing |
| S4 forbidden text | PASS | No `--require`, 429 or rate-limit text in `main/` |
| T12 | PASS | 12 files byte-identical to `main/` or `gate-c-reference/`; `tools/gate-checks.mjs` identical to the lab's in all four snapshots |
| V1-V3 | PASS | SigNoz down and no data: four FAIL lines, exit 1; 9 of 9 fault cases as expected |
| T13 | PASS | Courseware verifier: 21 PASS, 0 FAIL, 0 SKIP |

Also checked by hand: `lab-image/labs/install-labs.sh --no-sudo --no-build`
into a temporary `LABS_DIR` builds the directory and reports
`ok box-office-estate rollback points`; `docker compose config -q` succeeds at
each of the four stages; `docker compose build orders-api payments-sim`
succeeds with the new `.dockerignore` entries (`bin`, `stages`, `.stage`,
`.stage-backup`).
