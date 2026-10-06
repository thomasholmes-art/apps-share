# box-office-estate: build source

This directory is the source for `box-office-estate`, the ticketing application
behind module 07 (lab `07-hackathon-two-worlds`). Course releases ship it as
`apps/box-office-estate/`; learners work in the directory built from it, not
in this directory. On each lab VM the application is a plain directory (not a
git repository) at `~/labs/box-office-estate`, built from the snapshots here by
`make-estate.sh`, with `bin/stage` to move its source files to the start or to
the end of gate A, B or C. The authority for every requirement is
`../_inventory/box-office-estate-build-spec.md` (the spec): conflicts K1-K19,
decisions D1-D18, the state matrix in section 4.2 and the tests T1-T13 in
section 9. The spec's section 4.2 describes the three states as git branches;
since 2026-10-05 they are rollback points in `stages/` instead (see "Rollback
points" below).

## Layout

| Path | What it holds |
|---|---|
| `main/` | The application as shipped: all services, `verify.sh`, `telemetry-spec.md`, `tools/`, `scripts/reset-data.sh`, and all seven `TODO(telemetry-…)` markers |
| `gate-a-reference/`, `gate-b-reference/`, `gate-c-reference/` | The state at the end of gates A, B and C. Generated from `main/`; never edited by hand. Marker counts are 7, 4, 2 and 0 |
| `make-estate.sh` | Builds the lab directory from the four snapshots and `bin/stage` |
| `bin/stage` | The rollback point script installed as `bin/stage` in the lab directory; it does nothing when run here |
| `make-reference-sources.sh` | Rebuilds lab 07's `code/starter/reference-sources/` tree in the courseware (spec section 6.3) |
| `build-test.sh` | The build acceptance tests (spec section 9) |
| `TEST-RESULTS.md` | The latest recorded results of `build-test.sh` |
| `test/` | Helpers for `build-test.sh`, `test/stage-test.sh` (the static test of `make-estate.sh` and `bin/stage`) and helpers for running the estate under podman |

## Changing the application

1. Edit `main/` only.
2. Regenerate the reference snapshots with `python3 test/make-gates.py`. Each
   gate is a set of exact text replacements on the previous snapshot. If an
   edit to `main/` changes text that a replacement depends on, the script stops
   and names the file; update the replacement in `test/make-gates.py`.
3. Regenerate lab 07's reference sources with `./make-reference-sources.sh`.
4. Run `./build-test.sh static`, and `./build-test.sh live` on a host with
   Docker and SigNoz.

`main/tools/gate-checks.mjs` must stay byte-identical to the lab 07 starter's
`gate-checks.mjs`. Test T12 checks this.

## Installing on the lab image

On the seed VM, with Docker, SigNoz (see `lab-image/signoz/`) and the
OpenTelemetry Java agent at `/opt/otel/opentelemetry-javaagent-2.31.1.jar`:

```bash
./make-estate.sh ~/labs/box-office-estate
cd ~/labs/box-office-estate
docker compose build        # needs registry access once; later rebuilds use the cached layers
docker compose up -d
```

`make-estate.sh` refuses a target directory that is not empty or that lies
inside this directory or the courseware repository. Two runs from the same
snapshots produce identical directories. The result is at stage `start`.

## Rollback points

The lab directory holds the shipped application (`main/`) plus:

| Path | What it holds |
|---|---|
| `bin/stage` | `bin/stage start`, `a`, `b` or `c`: puts the source files into that state |
| `stages/start/` | Every shipped file except `telemetry-spec.md` |
| `stages/gate-a/`, `stages/gate-b/`, `stages/gate-c/` | Only the files that `gate-a-reference/`, `gate-b-reference/` and `gate-c-reference/` change from `main/`, at their paths in the application, so a learner can compare each one with an edited copy (4, 4 and 5 files today) |
| `stages/<name>.remove` | Written only if a gate adds or removes a file; today there are none |
| `.stage` | The stage last applied: `start`, `a`, `b` or `c` |
| `.stage-backup/<time>-from-<stage>/` | The files a `bin/stage` run replaced or removed, as they were before it |

`bin/stage NAME` sets every shipped file to its version at NAME (the gate's
copy where the gate changes the file, otherwise the shipped copy), copies each
file it replaces or removes into `.stage-backup/` first, and writes NAME to
`.stage`. It never overwrites or deletes `telemetry-spec.md`, and it leaves in
place any file the application does not ship (`docker-compose.override.yml`,
notes). If `.stage` already holds NAME it exits 0 and changes nothing; to put
a stage's files back after editing them, run `bin/stage start` and then the
stage again. It does not run docker: it ends by printing
`docker compose up -d --build`, because the gates change `docker-compose.yml`
and source that is compiled into the images, which a container restart does
not pick up. `obs-sample-estate`'s `bin/stage` restarts `checkout-api`
instead, because its stages change only `checkout-api` source, which that
container mounts from the host directory and reads at start.

`./verify.sh` records the contents of `.stage` in `telemetry-export.json` as
`stage` (the captures in lab 07's `artefacts/` predate this and carry a
`branch` field instead; `gate-checks.mjs` reads neither).

`test/stage-test.sh` builds the directory under `/tmp` and checks every
stage transition, the backups, `.stage` and that `telemetry-spec.md` is not
touched. `build-test.sh static` runs it as S3.

The `docker compose build` step fills the layer cache that lets learners run
`docker compose up -d --build <service>` with no network access (decision D9,
test T11). Run it before the image is captured.

Before cloning the seed VM, remove the build test's telemetry from SigNoz with
`lab-image/signoz/provision-signoz.sh reset-data`.

## Files in the courseware

Two outputs of this build live in the courseware tree, not here:

- `learner/.../labs/07-hackathon-two-worlds/code/starter/reference-sources/`,
  written by `./make-reference-sources.sh`;
- `instructor/.../labs/07-hackathon-two-worlds/code/solution/reference-dashboard.json`,
  which `build-test.sh live` imports for T6.

`build-test.sh static` (T12) fails if `reference-sources/` no longer matches
`main/` and `gate-c-reference/`.

## The reference dashboard

`reference-dashboard.json` is a SigNoz v0.144 dashboard in the v2 API's form
(`schemaVersion` `v6`). It has three panels on `orders-api` server spans: p95
latency grouped by span name and `has_error`, error rate by span name, and
throughput by span name. It is for the facilitator's projector and is not
learner-visible (decision D17). To import it through the API with an admin
token:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  http://localhost:8080/api/v2/dashboards -d @reference-dashboard.json
```

`build-test.sh live` imports it before the stage matrix (T6) and deletes it
afterwards.

## SigNoz version dependencies

Everything in `verify.sh` that depends on the SigNoz version is in
`main/tools/signoz.mjs`: the query range API (v5), the dashboards API (v2;
in v0.144 the v1 path returns the UI's HTML page), the API key file
(`~/.config/signoz/api-key`) and the shape of the rows. SigNoz v0.144 names
metric labels with dots (`service.name`, `status.code`, `http.status_code`).
A filter on an underscored form matches no series and reports no error.

The `service_name` field in log records is a different thing: it is a key in
the JSON that the Node services write, and the export format in
`gate-checks.mjs` uses it under that name.

## Departures from the spec's compose listing

- `orders-api`, `payments-sim` and `customers` run with `init: true`. A Node
  process running as process 1 ignores SIGTERM unless it installs a handler,
  so without `init` these containers waited the full 10 seconds and were then
  killed. With `init`, the SIGTERM handler in `orders-api/instrumentation.mjs`
  still runs after gate B and flushes the SDK.
- `seatmap` gives requests in progress 5 seconds to finish on SIGTERM, and a
  request waiting for a database connection gives up after 5 seconds
  (`application.properties`). Without these, a request whose database
  connection had closed kept the JVM running past the 10-second limit.

- `verify.sh` sends two purchases through the box office before it checks
  anything (phase 7 revision, 2026-10-02). The spec's section 1.9 and test T9
  say it sends nothing. Without its own purchase, a run after an edit checked
  whatever purchase was newest, often one made before the edit, and the first
  purchase a learner made after a pause was fault 1's cold 502. Now the first
  purchase, sent by `tools/purchase.mjs`, is not checked, and the second is
  sent 4 seconds after the first is answered and is the one checked.
  `export-telemetry.mjs` reads the second purchase's send time from
  `VERIFY_SENT_AT_MS`, waits for its telemetry, and refuses to check an older
  purchase. Fault 1 is unchanged: the room stops purchasing and running
  `verify.sh` at 2:09, so movement 5's first purchase at 2:11 still meets a
  cold `payments-sim`. T1 and T9 in `build-test.sh` now expect the two
  purchases, and the movement 5 trace is exported from a `buy()` purchase
  without `verify.sh`.

## Hosts without Docker

`test/podman-variant.py`, `test/forward-logs.mjs` and `test/signoz-stub.mjs` run
the estate under rootless podman with no SigNoz: the variant removes the
fluentd log driver (podman has none), `forward-logs.mjs` sends `podman logs`
output to the collector's Fluent Forward receiver instead, and the collector
writes to files that the stub serves as a SigNoz query API. `build-test.sh`
uses the stub only for the offline `verify.sh` checks.
