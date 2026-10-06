# obs-sample-estate

The sample application for the observability tooling labs 01 to 06: a small
online shop. It lives at `~/labs/obs-sample-estate` on each lab VM and runs
under Docker Compose.

## Services

| Service | Runtime | Port on the VM | Role |
|---|---|---|---|
| `storefront` | React, served by Node 22 | 5173 | The shop page. Passes `/api` requests to `checkout-api`. |
| `checkout-api` | Node 22, Express | 3000 | Catalogue, basket, search and checkout. |
| `inventory` | Java 21, Spring Boot | none | Holds stock for each basket line (`POST /reserve`). |
| `dispatch-worker` | Node 22 | none | Takes each order from the dispatch queue and books a shipping label. |

`dispatch-queue` is `checkout-api`'s own queue client, not a container. Lab 05
adds `label-api`, the courier's label service, which belongs to a supplier
rather than to the team.

In the hosted lab environment the shop is at
`https://5173-lab<NNNNN>.labs.decoded.com` and `checkout-api` at
`https://3000-lab<NNNNN>.labs.decoded.com`. Use an ordinary browser tab; the
editor's "Open in Browser" preview rejects POST requests.

SigNoz is already installed and running on every lab VM, on port 8080.

## Everyday commands

Run these in `~/labs/obs-sample-estate`:

```bash
docker compose up -d              # start the four services
docker compose ps                 # all four rows should read Up
docker compose logs -f checkout-api
docker compose restart checkout-api   # after editing a file under checkout-api/
docker compose down               # stop everything; the next up -d starts it again
```

`checkout-api/` on the VM is the container's `/app`, so an edited file there
is what runs after `docker compose restart checkout-api`.

## Stages

Each lab starts the code in `checkout-api/` from a known state. `bin/stage`
puts it there:

```bash
~/labs/obs-sample-estate/bin/stage 02
```

| Stage | Used by | What it changes |
|---|---|---|
| 01 | lab 01 (as shipped) | Nothing. |
| 02 | lab 02 | Installs lab 02's starting files in `checkout-api/src/`. |
| 03 | lab 03 | Nothing beyond stage 02. |
| 04 | lab 04 | Installs lab 04's starting `src/dispatch-publisher.mjs`. |
| 05 | lab 05 | Installs the `dispatch-publisher.mjs` from `~/labs/obs-lab-04/code/starter` if its six tests pass there. |
| 06 | lab 06 | Nothing beyond stage 05. |

`bin/stage` prints what it did. Running it again for the stage already in
place changes nothing. Before replacing a file it copies the old one into
`.stage-backup/`, and it restarts `checkout-api` only if it is running. From
stage 05 on it also writes `COMPOSE_FILE` to `.env`, so every new terminal's
`docker compose` reads the same compose files lab 05 lists. `bin/stage 01`
returns to the state as shipped.

## Files the labs add

Labs 03 and 05 copy these into this directory; they are not shipped here:

- `docker-compose.override.yml` and `collector.yaml` (lab 03)
- `docker-compose.dispatch.yml` and `worker-instrumentation.mjs` (lab 05), and
  `checkout-api/edge-context.mjs`, which lab 05's compose file loads into
  checkout-api's launch command

## Checking the estate

```bash
./verify.sh
```

`verify.sh` checks the running services against the stage in `.stage`: the
four containers, the failing and the successful basket, the log output the
stage should produce, the search route, checkout latency, SigNoz on port 8080
and the host log collector. It places a few real orders. It prints PASS, FAIL
or WARN for each check and exits with the number of failures.

## Image build (lab image only)

The lab image is built once, with registry access, and the VMs then work
offline. On the image:

```bash
cd ~/labs/obs-sample-estate
(cd checkout-api && npm ci) && (cd dispatch-worker && npm ci) && (cd storefront && npm ci)
docker compose build
docker build -t obs-label-api label-api
docker pull otel/opentelemetry-collector-contrib:0.160.0
sudo install -D -m 644 opentelemetry-javaagent-2.31.1.jar /opt/otel/opentelemetry-javaagent-2.31.1.jar
```

`checkout-api/node_modules` must stay on the VM: lab 02 runs `npm test` in
`checkout-api/`, and the container reads its packages from that directory.

The host log collector is a separate compose project, installed from the
build repository's `exemplar/obs-sample-estate/host-collector/` (in a course
release, `apps/obs-host-collector/`) into `/opt/obs-host-collector`:

```bash
cd /opt/obs-host-collector && docker compose up -d
```

It reads the four services' Docker log files and sends each line to SigNoz
over OTLP on port 4318. JSON lines become filterable attributes; `inventory`
lines are parsed into the same names. Because it is outside this compose
project, `docker compose down` here does not stop it, and it picks up the
containers again after the next `up -d`.
