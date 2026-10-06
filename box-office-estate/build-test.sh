#!/usr/bin/env bash
# Build acceptance tests for box-office-estate (module 07, lab
# 07-hackathon-two-worlds), spec section 9.
#
#   build-test.sh static   no containers: snapshot consistency, the estate
#                          build and bin/stage (test/stage-test.sh),
#                          reference-sources parity (T12), the offline checks
#                          that verify.sh fails when it should, and the
#                          courseware verifier (T13)
#   build-test.sh live     Docker and SigNoz on this host: T1-T11. Takes about
#                          40 minutes. With RUN_LOCK set to a file, holds that
#                          lock while containers are up. Stops its containers
#                          and records a NOTE if available memory falls below
#                          MIN_AVAIL_MB (default 800).
#
# Live mode needs: Docker with the compose plugin, SigNoz answering on
# localhost:8080 with a viewer API key in ~/.config/signoz/api-key, the root
# admin login in ~/.config/signoz/admin.env (to import and then delete the
# reference dashboard), jq, and the OpenTelemetry Java agent at
# /opt/otel/opentelemetry-javaagent-2.31.1.jar or at $AGENT_JAR.
#
# Results are appended to $WORK/results.md as table rows:
#   | test | PASS, FAIL or NOTE | evidence |
# Logs, exports and outputs are kept under $WORK/logs.
#
# Environment: WORK (default /tmp/boe-build-test), AGENT_JAR, SEATMAP_HEAP
# (default unset; for example 192m on a host with little memory), RUN_LOCK,
# MIN_AVAIL_MB, ONLY (live mode: a space-separated subset of the sections
# main, gate-a, gate-b and gate-c to run; default all). Each section moves the
# estate to its rollback point with bin/stage start, a, b or c.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROGRAMME="$(cd "$HERE/../.." && pwd)"
STARTER="$PROGRAMME/learner/units/observability-tooling-practices/labs/07-hackathon-two-worlds/code/starter"
IVERIFY="$PROGRAMME/instructor/units/observability-tooling-practices/labs/07-hackathon-two-worlds/code/solution/verify.sh"
STAGED="$PROGRAMME"
DASHBOARD_FILE="$STAGED/instructor/units/observability-tooling-practices/labs/07-hackathon-two-worlds/code/solution/reference-dashboard.json"
DASHBOARD_NAME="box-office-purchase-journey"
FIXTURE="$HERE/test/fixtures/export-gate-c.json"

MODE="${1:-static}"
WORK="${WORK:-/tmp/boe-build-test}"
LOGS="$WORK/logs"
RESULTS="$WORK/results.md"
REPO="$WORK/estate"
SIGNOZ="http://localhost:8080"
MIN_AVAIL_MB="${MIN_AVAIL_MB:-800}"
mkdir -p "$LOGS"
[ -f "$RESULTS" ] || printf '| Test | Result | Evidence |\n|---|---|---|\n' > "$RESULTS"

record() { # id result evidence
  printf '| %s | %s | %s |\n' "$1" "$2" "$(echo "$3" | tr '\n|' ' /')" >> "$RESULTS"
  echo "build-test: $1 $2: $3" >&2
}
pass_if() { # id condition-exit-status evidence
  if [ "$2" = 0 ]; then record "$1" PASS "$3"; else record "$1" FAIL "$3"; fi
}

# ---------------------------------------------------------------------------
# Static checks

static_checks() {
  local tmp rc ev
  tmp="$(mktemp -d)"

  # S1. Marker counts: 7 on main, then 4, 2, 0 (spec section 2.2, 4.2).
  ev=""; rc=0
  for pair in main:7 gate-a-reference:4 gate-b-reference:2 gate-c-reference:0; do
    n="$(grep -r --exclude-dir=node_modules -o 'TODO(telemetry-[ABC])' "$HERE/${pair%%:*}" | wc -l)"
    ev+="${pair%%:*}=$n "
    [ "$n" = "${pair##*:}" ] || rc=1
  done
  pass_if S1-markers "$rc" "$ev"

  # S2. The reference snapshots are main with exact replacements.
  rsync -a --exclude node_modules "$HERE/main" "$tmp/" && python3 "$HERE/test/make-gates.py" "$tmp" >/dev/null
  rc=0; ev=""
  for g in gate-a-reference gate-b-reference gate-c-reference; do
    if diff -r -x node_modules -x dist "$HERE/$g" "$tmp/$g" >/dev/null; then ev+="$g regenerates identically; "; else ev+="$g DIFFERS; "; rc=1; fi
  done
  pass_if S2-snapshots "$rc" "$ev"

  # S3. make-estate.sh and bin/stage: each rollback point's shipped files equal
  # its snapshot, telemetry-spec.md is never touched, replaced files are
  # backed up (test/stage-test.sh lists every check).
  "$HERE/test/stage-test.sh" "$tmp/stage" > "$LOGS/stage-test.out" 2>&1; rc=$?
  pass_if S3-make-estate "$rc" "$(tail -1 "$LOGS/stage-test.out"); $(grep '^FAIL' "$LOGS/stage-test.out" | tr '\n' ';')"

  # S4. Text that must not appear: --require (BRIEF:71) and any 429 or rate
  # limit message (spec section 1.3).
  hits="$(grep -rn --exclude-dir=node_modules --exclude=package-lock.json -E -- '--require|\b429\b|rate limit|Too Many Requests' "$HERE/main" | grep -v 'tools/gate-checks.mjs' || true)"
  if [ -z "$hits" ]; then record S4-forbidden-text PASS "no --require, 429 or rate-limit text in main/"; else record S4-forbidden-text FAIL "$hits"; fi

  # T12. Reference-sources parity and gate-checks.mjs identical to the lab's.
  rc=0; ev=""
  "$HERE/make-reference-sources.sh" "$tmp/rs" 2>/dev/null
  diff -r "$tmp/rs" "$STAGED/learner/units/observability-tooling-practices/labs/07-hackathon-two-worlds/code/starter/reference-sources" >/dev/null \
    || { rc=1; ev+="the lab 07 reference-sources is out of date; "; }
  n=0
  while IFS= read -r f; do
    rel="${f#"$tmp/rs/"}"
    case "$rel" in README.txt) continue ;; after/*) src="$HERE/gate-c-reference/${rel#after/}" ;; *) src="$HERE/main/$rel" ;; esac
    cmp -s "$f" "$src" || { rc=1; ev+="$rel differs; "; }
    n=$((n + 1))
  done < <(find "$tmp/rs" -type f)
  for s in main gate-a-reference gate-b-reference gate-c-reference; do
    cmp -s "$STARTER/gate-checks.mjs" "$HERE/$s/tools/gate-checks.mjs" || { rc=1; ev+="$s/tools/gate-checks.mjs differs from the lab's; "; }
  done
  pass_if T12 "$rc" "${ev}$n files byte-identical to main/ or gate-c-reference/; tools/gate-checks.mjs identical to the lab's in all four snapshots"

  # V. verify.sh is genuine (offline part).
  #  V1: SigNoz not answering -> four FAIL lines, exit 1.
  rsync -a --exclude node_modules "$HERE/main/" "$tmp/v/"
  out="$(cd "$tmp/v" && BOX_OFFICE_URL=http://127.0.0.1:9 SIGNOZ_URL=http://127.0.0.1:9 ./verify.sh 2>/dev/null)"; rc=$?
  n="$(echo "$out" | grep -c '^GATE [ABCD] FAIL: SigNoz is not answering on 127.0.0.1:9, so this gate cannot be checked')"
  [ "$n" = 4 ] && [ "$rc" = 1 ]; pass_if V1-signoz-down $? "4 FAIL lines ($n), exit $rc"
  #  V2: SigNoz answering with no data and no dashboard -> four FAIL lines, exit 1.
  mkdir -p "$tmp/empty"; port=18181
  node "$HERE/test/signoz-stub.mjs" "$tmp/empty" "$port" & stub=$!
  sleep 1
  out="$(cd "$tmp/v" && BOX_OFFICE_URL=http://127.0.0.1:9 SIGNOZ_URL=http://127.0.0.1:$port SIGNOZ_API_KEY_FILE=/dev/null ./verify.sh 2>"$LOGS/v2.err")"; rc=$?
  kill "$stub" 2>/dev/null
  echo "$out" > "$LOGS/v2.out"
  n="$(echo "$out" | grep -c '^GATE [ABCD] FAIL: ')"
  [ "$n" = 4 ] && [ "$rc" = 1 ]; pass_if V2-no-data $? "4 FAIL lines ($n), exit $rc: $(echo "$out" | cut -c1-60 | tr '\n' ';')"
  #  V3: a recorded passing export, with faults put in one at a time.
  if [ -f "$FIXTURE" ]; then
    out="$(node "$HERE/test/genuine.mjs" "$HERE/main/tools/gate-checks.mjs" "$FIXTURE")"; rc=$?
    echo "$out" > "$LOGS/v3.out"
    pass_if V3-faults "$rc" "$(echo "$out" | grep -c '^ok') of $(echo "$out" | wc -l) cases as expected; $(echo "$out" | grep '^WRONG' | head -3)"
  else
    record V3-faults NOTE "no recorded export at test/fixtures/export-gate-c.json; run build-test.sh live first"
  fi

  # T13. Courseware verifier.
  if [ -x "$IVERIFY" ] || [ -f "$IVERIFY" ]; then
    out="$(bash "$IVERIFY" 2>&1)"; echo "$out" > "$LOGS/t13.out"
    p="$(echo "$out" | grep -c '^PASS')"; f="$(echo "$out" | grep -c '^FAIL')"; s="$(echo "$out" | grep -c '^SKIP')"
    [ "$f" = 0 ]; pass_if T13 $? "$p PASS, $f FAIL, $s SKIP; $(echo "$out" | grep -E '^(FAIL|SKIP)' | cut -c1-90 | tr '\n' ';')"
  else
    record T13 FAIL "courseware verifier not found at $IVERIFY"
  fi
  rm -rf "$tmp"
}

# ---------------------------------------------------------------------------
# Live tests

dc() { (cd "$REPO" && docker compose "$@"); }

wait_ready() {
  local i
  for i in $(seq 1 120); do
    if curl -sf -o /dev/null http://localhost:5180/api/events/842 \
      && dc ps orders-api --format '{{.Status}}' | grep -q healthy; then return 0; fi
    sleep 3
  done
  return 1
}

stage() { (cd "$REPO" && bin/stage "$1" >> "$LOGS/stage.log" 2>&1); }

estate_up() { # start, a, b or c
  stage "$1" || return 1
  dc up -d --build --remove-orphans >> "$LOGS/compose.log" 2>&1 || return 1
  wait_ready
}

estate_down() { dc down --remove-orphans >> "$LOGS/compose.log" 2>&1; }

buy() { node "$HERE/test/purchase.mjs" 842 http://localhost:5180; }
field() { node -e "const o=JSON.parse(process.argv[1]); console.log(o$2 ?? '')" "$1"; }

# Runs ./verify.sh in the estate. Writes <label>.out, .err, .rc, .net and
# the export. The connection audit records every TCP connection it opens.
# verify.sh sends its own two purchases, so no purchase is needed before it.
run_verify() { # label
  : > "$LOGS/$1.net"
  (cd "$REPO" && NET_AUDIT_FILE="$LOGS/$1.net" NODE_OPTIONS="--import $HERE/test/net-audit.mjs" ./verify.sh \
    > "$LOGS/$1.out" 2> "$LOGS/$1.err"); echo $? > "$LOGS/$1.rc"
  cp "$REPO/telemetry-export.json" "$LOGS/$1.export.json" 2>/dev/null || true
}
# Writes an export of the newest purchase without sending one, for the
# measurements that need a purchase made by buy() rather than by verify.sh.
export_only() { # label
  (cd "$REPO" && node tools/export-telemetry.mjs "$LOGS/$1.export.json" 2> "$LOGS/$1.err")
}
gate() { grep "^GATE $2 " "$LOGS/$1.out" | head -1; }
expect_gates() { # label A B C D (each PASS or FAIL)
  local label="$1" g want line ok=0; shift
  for g in A B C D; do
    want="$1"; shift; line="$(gate "$label" "$g")"
    case "$line" in "GATE $g $want"*) ;; *) ok=1 ;; esac
    case "$line" in *"cannot be checked"*) ok=1 ;; esac
  done
  return $ok
}

signoz_token() {
  # shellcheck disable=SC1090
  . "$HOME/.config/signoz/admin.env"
  local org
  org="$(curl -fsS -G "$SIGNOZ/api/v2/sessions/context" --data-urlencode "email=$SIGNOZ_ROOT_EMAIL" --data-urlencode "ref=$SIGNOZ" | jq -r '.data.orgs[0].id')"
  curl -fsS "$SIGNOZ/api/v2/sessions/email_password" -H 'Content-Type: application/json' \
    -d "$(jq -n --arg e "$SIGNOZ_ROOT_EMAIL" --arg p "$SIGNOZ_ROOT_PASSWORD" --arg o "$org" '{email:$e,password:$p,orgId:$o}')" | jq -r '.data.accessToken'
}
dashboard_ids() {
  curl -fsS -H "SIGNOZ-API-KEY: $(cat "$HOME/.config/signoz/api-key")" "$SIGNOZ/api/v2/dashboards" \
    | jq -r --arg n "$DASHBOARD_NAME" '.data.dashboards[] | select(.name == $n) | .id'
}
dashboard_remove() {
  local tok id; tok="$(signoz_token)"
  for id in $(dashboard_ids); do curl -fsS -o /dev/null -X DELETE -H "Authorization: Bearer $tok" "$SIGNOZ/api/v2/dashboards/$id"; done
}
dashboard_import() {
  dashboard_remove
  curl -fsS -X POST -H "Authorization: Bearer $(signoz_token)" -H 'Content-Type: application/json' \
    "$SIGNOZ/api/v2/dashboards" -d @"$DASHBOARD_FILE" | jq -r '.status'
}

# Applies a one-off edit to a file in the estate for a quiet-failure case.
edit() { # file old new
  python3 - "$REPO/$1" "$2" "$3" <<'EOF'
import sys
path, old, new = sys.argv[1:4]
text = open(path).read()
if text.count(old) != 1:
    sys.exit(f'{path}: expected one match for {old!r}')
open(path, 'w').write(text.replace(old, new))
EOF
}
# Puts back the current rollback point's files after one-off edits. bin/stage
# changes nothing when the estate is already at the stage named, so it moves
# to another stage and back.
restore() {
  local s; s="$(cat "$REPO/.stage")"
  if [ "$s" = start ]; then stage a && stage start; else stage start && stage "$s"; fi
}
want() { [ -z "${ONLY:-}" ] || [[ " $ONLY " == *" $1 "* ]]; }

live_tests() {
  if [ -n "${RUN_LOCK:-}" ]; then
    exec 9>"$RUN_LOCK"
    echo "build-test: waiting for $RUN_LOCK" >&2
    flock 9 || { echo "build-test: could not take $RUN_LOCK" >&2; return 1; }
  fi
  trap 'kill "$guard" 2>/dev/null; estate_down; dashboard_remove' EXIT
  trap 'exit 143' TERM

  # Stops the run if the host runs short of memory, so an OOM kill is not
  # mistaken for a fault in the application.
  local self=$$
  (
    while sleep 10; do
      avail="$(awk '/MemAvailable/ {print int($2 / 1024)}' /proc/meminfo)"
      if [ "$avail" -lt "$MIN_AVAIL_MB" ]; then
        record live NOTE "stopped: available memory $avail MB fell below $MIN_AVAIL_MB MB"
        estate_down
        kill "$self"
        exit
      fi
    done
  ) & guard=$!

  rm -rf "$REPO"
  "$HERE/make-estate.sh" "$REPO" 2>/dev/null || { record live FAIL "make-estate.sh failed"; return; }
  local agent="${AGENT_JAR:-/opt/otel/opentelemetry-javaagent-2.31.1.jar}"
  # Not part of the application, so bin/stage leaves it in place: an override
  # for this host only.
  {
    echo "services:"
    echo "  seatmap:"
    echo "    volumes:"
    echo "      - $agent:/opt/otel/opentelemetry-javaagent-2.31.1.jar:ro"
    [ -n "${SEATMAP_HEAP:-}" ] && printf '    environment:\n      JAVA_TOOL_OPTIONS: -Xmx%s -XX:+UseSerialGC\n' "$SEATMAP_HEAP"
  } > "$REPO/docker-compose.override.yml"

  local p r ms st

  # ---- main: T1, T9 (part), T2, T3 (time), T4
  if want main; then
  dashboard_remove
  estate_up start || { record live FAIL "main did not start; see $LOGS/compose.log"; return; }

  p1="$(buy)"; echo "$p1" > "$LOGS/p1.json"; sleep 5
  p2="$(buy)"; echo "$p2" > "$LOGS/p2.json"
  record T3-main-time "$( [ "$(field "$p2" .status)" = 201 ] && [ "$(field "$p2" .ms)" -lt 400 ] && echo PASS || echo FAIL)" \
    "first purchase after start: $(field "$p1" .status) in $(field "$p1" .ms) ms; second, 5 s later: $(field "$p2" .status) in $(field "$p2" .ms) ms"
  sleep 83   # about 85 s since the last job finished (purchase.mjs spends about 2 s reading the seat map first)
  p85="$(buy)"; echo "$p85" > "$LOGS/p85.json"
  sleep 93   # about 95 s
  p95="$(buy)"; echo "$p95" > "$LOGS/p95.json"
  sleep 6
  record T4 "$( [ "$(field "$p85" .status)" = 201 ] && [ "$(field "$p95" .status)" = 502 ] && echo PASS || echo FAIL)" \
    "about 85 s idle: $(field "$p85" .status) in $(field "$p85" .ms) ms; about 95 s idle: $(field "$p95" .status) in $(field "$p95" .ms) ms"
  dc logs --no-log-prefix orders-api > "$LOGS/orders-api-main.log" 2>&1
  dc logs --no-log-prefix payments-sim > "$LOGS/payments-sim-main.log" 2>&1
  dc logs --no-log-prefix seatmap > "$LOGS/seatmap-main.log" 2>&1
  lines="$(python3 "$HERE/test/t2-lines.py" "$LOGS/orders-api-main.log" "$(field "$p95" .at)")"; echo "$lines" > "$LOGS/t2-lines.json"
  ms="$(field "$p95" .ms)"; late="$(field "$lines" .publish_to_late_reply_ms)"; quiet="$(wc -l < "$LOGS/payments-sim-main.log")"
  failed="$(node -e 'const o=JSON.parse(process.argv[1]); console.log(Object.entries(o.checks).filter(([, v]) => !v).map(([k]) => k).join(", "))' "$lines")"
  [ "$(field "$p95" .status)" = 502 ] && [ "$ms" -ge 1900 ] && [ "$ms" -le 2100 ] && [ -n "$late" ] && [ "$late" -ge 3300 ] && [ "$late" -le 3700 ] \
    && [ -z "$failed" ] && [ "$quiet" = 0 ]
  pass_if T2 $? "502 in $ms ms (publish to abandon $(field "$lines" .publish_to_abandon_ms) ms); late reply $late ms after publish; payments-sim output lines: $quiet; line-format checks failing: ${failed:-none}"
  # T1 after the timing measurements, because verify.sh's purchases start
  # payments-sim's execution environment.
  run_verify t1
  n="$(grep -c '^GATE [ABCD] FAIL: ' "$LOGS/t1.out")"
  ! grep -q 'cannot be checked' "$LOGS/t1.out" && [ "$n" = 4 ] && [ "$(cat "$LOGS/t1.rc")" = 1 ] && grep -q 'sent the purchase that is checked' "$LOGS/t1.err"
  pass_if T1 $? "$n FAIL lines, exit $(cat "$LOGS/t1.rc"); $(grep -E 'sent the purchase|purchase checked|no purchase' "$LOGS/t1.err" | tr '\n' ';'); $(cut -c1-70 "$LOGS/t1.out" | tr '\n' ';')"
  others="$(sort -u "$LOGS/t1.net" | grep -v -E '^(localhost|127\.0\.0\.1|::1):(8080|5180)$' || true)"
  [ -z "$others" ]; pass_if T9-connections $? "verify.sh opened connections to: $(sort -u "$LOGS/t1.net" | tr '\n' ' ')"
  estate_down
  fi

  [ "$(dashboard_import)" = success ] || record T6-dashboard FAIL "reference dashboard import failed"

  # ---- gate-a-reference: T6 (A), T8 per-call ID, T8 pattern, T10
  if want gate-a; then
  estate_up a || { record live FAIL "stage a (gate-a-reference) did not start"; return; }
  run_verify t6-a
  expect_gates t6-a PASS FAIL FAIL PASS; pass_if T6-gate-a $? "$(cat "$LOGS/t6-a.out" | cut -c1-90 | tr '\n' ';')"

  edit orders-api/src/orders/handler.ts "correlation_id: correlationId()," "correlation_id: randomUUID(),"
  dc up -d --build orders-api >> "$LOGS/compose.log" 2>&1; wait_ready
  run_verify t8-per-call-id
  grep -q '^GATE A FAIL: .*no correlation_id carries records from both orders-api and payments-sim' "$LOGS/t8-per-call-id.out"
  pass_if T8-per-call-id $? "$(gate t8-per-call-id A | cut -c1-160)"
  restore

  cp "$REPO/stages/start/seatmap/src/main/resources/logback-spring.xml" "$REPO/seatmap/src/main/resources/logback-spring.xml"
  dc restart seatmap >> "$LOGS/compose.log" 2>&1; wait_ready
  run_verify t8-pattern
  grep -q '^GATE A FAIL: .*seatmap log record(s) with no trace_id' "$LOGS/t8-pattern.out"
  pass_if T8-pattern-unchanged $? "$(gate t8-pattern A | cut -c1-200)"
  restore; dc restart seatmap >> "$LOGS/compose.log" 2>&1

  edit orders-api/src/orders/handler.ts "  const orderId = nextOrderId();" "  const orderId = nextOrderId();
  say('info', 'order.body', 'request body', { body: req.body });"
  dc up -d --build orders-api >> "$LOGS/compose.log" 2>&1; wait_ready
  run_verify t10
  grep -q -E '^GATE A FAIL: .*(card number|email address) present in a log body' "$LOGS/t10.out"
  pass_if T10 $? "$(gate t10 A | grep -o -E '(card number|email address|card security code)[^;]*' | tr '\n' ';')"
  restore
  estate_down
  fi

  # ---- gate-b-reference: T6 (B), T5, T8 grpc, T7
  if want gate-b; then
  estate_up b || { record live FAIL "stage b (gate-b-reference) did not start"; return; }
  run_verify t6-b
  expect_gates t6-b PASS PASS FAIL PASS && grep -q '^GATE C FAIL: .*payments-sim absent from the purchase trace' "$LOGS/t6-b.out"
  pass_if T6-gate-b $? "$(cat "$LOGS/t6-b.out" | cut -c1-90 | tr '\n' ';')"

  t5="$(node "$HERE/test/t5-calibration.mjs" "$REPO" 50 842 115 2> "$LOGS/t5.err")"; echo "$t5" > "$LOGS/t5.json"
  node -e '
    const o = JSON.parse(process.argv[1]); const a = o.arena, t = o.theatre;
    const ok = a.rootP95Ms >= 1600 && a.rootP95Ms <= 2100 && t.rootP95Ms >= 50 && t.rootP95Ms <= 90
      && a.querySpansOutside2to5ms === 0 && t.querySpansOutside2to5ms === 0
      && a.querySpansPerTrace.join() === "452" && t.querySpansPerTrace.join() === "10";
    process.exit(ok ? 0 : 1);' "$t5" 2>/dev/null
  pass_if T5 $? "$t5"

  edit docker-compose.yml "      OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf" "      OTEL_EXPORTER_OTLP_PROTOCOL: grpc"
  dc up -d seatmap >> "$LOGS/compose.log" 2>&1; wait_ready
  run_verify t8-grpc
  grep -q '^GATE B FAIL: .*no spans reported by seatmap' "$LOGS/t8-grpc.out"
  pass_if T8-grpc-protocol $? "$(gate t8-grpc B | cut -c1-160)"
  restore; dc up -d seatmap >> "$LOGS/compose.log" 2>&1

  # T7: does the Node SDK build a log exporter from its defaults? A recorder
  # inside the container stands in for the collector and prints each path.
  local image; image="$(dc images orders-api --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | head -1)"
  [ -n "$image" ] || image="box-office-estate-orders-api:latest"
  local recorder='require("http").createServer((q,s)=>{console.log("PATH",q.url);q.resume();q.on("end",()=>s.end("{}"))}).listen(4318,"127.0.0.1")'
  local emit='const { logger } = await import("./shared/logger.js"); logger.info({ event: "t7" }, "t7 record"); setTimeout(() => process.kill(process.pid, "SIGTERM"), 2000);'
  for variant in default none; do
    envs=(-e OTEL_SERVICE_NAME=t7 -e OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 -e SERVICE_NAME=t7)
    [ "$variant" = none ] && envs+=(-e OTEL_LOGS_EXPORTER=none)
    docker run --rm "${envs[@]}" --entrypoint sh "$image" -c \
      "node -e '$recorder' & sleep 1; node --import ./instrumentation.mjs --input-type=module -e '$emit'; sleep 1" \
      > "$LOGS/t7-$variant.out" 2>&1
  done
  d="$(grep -c 'PATH /v1/logs' "$LOGS/t7-default.out")"; nn="$(grep -c 'PATH /v1/logs' "$LOGS/t7-none.out")"
  [ "$nn" = 0 ]; pass_if T7 $? "without OTEL_LOGS_EXPORTER: $d request(s) to /v1/logs; with OTEL_LOGS_EXPORTER=none: $nn. The SDK $( [ "$d" -gt 0 ] && echo 'does' || echo 'does not') build a log exporter from its defaults; the setting stays"
  estate_down
  fi

  # ---- gate-c-reference: T6 (C), movement 5 trace, T3, T9 (live), labels, dashboard queries, T8 extract, T11
  if want gate-c; then
  estate_up c || { record live FAIL "stage c (gate-c-reference) did not start"; return; }
  # The first purchase after the estate starts is cold. It is bought here and
  # exported without verify.sh, whose own first purchase would take its place.
  buy > "$LOGS/c1.json"; sleep 20; export_only movement5
  run_verify t6-c
  expect_gates t6-c PASS PASS PASS PASS; pass_if T6-gate-c $? "$(cat "$LOGS/t6-c.out" | tr '\n' ';')"
  mkdir -p "$(dirname "$FIXTURE")"; cp "$LOGS/t6-c.export.json" "$FIXTURE"
  node -e '
    const e = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const auth = e.spans.find((s) => s.name === "payments.authorize"), handle = e.spans.find((s) => s.name === "payments.handle");
    const root = e.spans.find((s) => !s.parentSpanId && s.serviceName === "orders-api");
    console.log(JSON.stringify({ root: root && [root.name, root.durationMs, root.status], authorize: auth && [auth.durationMs, auth.status, auth.attributes["client.timeout_ms"]],
      handle: handle && [handle.startMs, handle.durationMs, handle.attributes["faas.coldstart"], handle.attributes["queue.wait_ms"]], spans: e.spans.length }));' \
    "$LOGS/movement5.export.json" > "$LOGS/movement5.json"
  record T2-trace NOTE "cold purchase on gate-c-reference, [name, ms, status]: $(cat "$LOGS/movement5.json")"

  sleep 5; buy > "$LOGS/c2.json"; sleep 20; run_verify t3
  auth="$(node -e 'const e=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const a=e.spans.find(s=>s.name==="payments.authorize"); console.log(a?a.durationMs:"")' "$LOGS/t3.export.json")"
  c2="$(cat "$LOGS/c2.json")"
  [ "$(field "$c2" .status)" = 201 ] && [ "$(field "$c2" .ms)" -lt 400 ] && [ -n "$auth" ] && [ "$auth" -ge 150 ] && [ "$auth" -le 300 ]
  pass_if T3 $? "warm purchase $(field "$c2" .status) in $(field "$c2" .ms) ms; payments.authorize $auth ms"

  before_orders="$(dc logs --no-log-prefix orders-api 2>/dev/null | grep -c '"POST /orders HTTP')"
  run_verify t9
  sleep 5
  after_orders="$(dc logs --no-log-prefix orders-api 2>/dev/null | grep -c '"POST /orders HTTP')"
  others="$(sort -u "$LOGS/t9.net" | grep -v -E '^(localhost|127\.0\.0\.1|::1):(8080|5180)$' || true)"
  [ "$((after_orders - before_orders))" = 2 ] && [ -z "$others" ] && grep -q 'GATE C PASS' "$LOGS/t9.out"
  pass_if T9 $? "POST /orders access lines $before_orders before and $after_orders after a verify.sh run (two purchases expected); gate C: $(gate t9 C | cut -c1-40); connections: $(sort -u "$LOGS/t9.net" | tr '\n' ' ')"

  sleep 60   # span metrics are aggregated per minute
  labels="$(node "$HERE/test/signoz-checks.mjs" labels 2>&1)"; echo "$labels" > "$LOGS/labels.json"
  node -e 'const o=JSON.parse(process.argv[1]); process.exit(o.dottedSeries>0 && o.underscoredSeries===0 ? 0 : 1)' "$labels" 2>/dev/null
  pass_if signoz_calls_total-labels $? "$labels"
  dq="$(node "$HERE/test/signoz-checks.mjs" dashboard "box-office purchase journey" 2>&1)"; echo "$dq" > "$LOGS/dashboard-queries.json"
  node -e 'const o=JSON.parse(process.argv[1]); const p=Object.values(o.panels??{}); process.exit(p.length===3 && p.every(x=>x.series>0) ? 0 : 1)' "$dq" 2>/dev/null
  pass_if D17-dashboard-queries $? "$dq"

  edit payments-sim/src/consumer.js "  }, parent, async (span) => {" "  }, async (span) => {"
  dc up -d --build payments-sim >> "$LOGS/compose.log" 2>&1; sleep 3
  run_verify t8-extract
  grep -q '^GATE C FAIL: .*payments-sim span [0-9a-f]* has no parent; the extracted context was never made active' "$LOGS/t8-extract.out"
  pass_if T8-extract-without-parent $? "$(gate t8-extract C | cut -c1-200)"
  restore

  # T11: rebuild the two Node services after a source edit with every build
  # step's outbound HTTP sent to a closed port, then restart seatmap. Docker's
  # predefined proxy build arguments are left out of the layer cache key, so
  # the cached npm ci layers are still used, and any step that does run and
  # needs the registry fails. (A build network of `none` cannot be used for
  # this: the network mode is part of a RUN step's cache key.)
  echo "// build-test T11" >> "$REPO/orders-api/src/server.ts"
  echo "// build-test T11" >> "$REPO/payments-sim/src/host.js"
  dc --progress plain build --build-arg HTTP_PROXY=http://127.0.0.1:9 --build-arg HTTPS_PROXY=http://127.0.0.1:9 \
    --build-arg http_proxy=http://127.0.0.1:9 --build-arg https_proxy=http://127.0.0.1:9 \
    orders-api payments-sim > "$LOGS/t11.log" 2>&1; r1=$?
  dc up -d --no-build orders-api payments-sim >> "$LOGS/t11.log" 2>&1; r2=$?
  dc restart seatmap >> "$LOGS/t11.log" 2>&1; r3=$?
  wait_ready; r4=$?
  ran="$(awk '/^#[0-9]+ \[(orders-api|payments-sim) [0-9]+\/[0-9]+\] RUN/ { step[$1] = substr($0, index($0, "[")) }
               /^#[0-9]+ CACHED/ { cached[$1] = 1 }
               END { for (k in step) if (!(k in cached)) print step[k] }' "$LOGS/t11.log" | sort -u | tr '\n' ';')"
  cached="$(grep -B1 -E '^#[0-9]+ CACHED' "$LOGS/t11.log" | grep -o -E '\[(orders-api|payments-sim) [0-9]+/[0-9]+\] RUN npm ci' | sort -u | tr '\n' ';')"
  [ "$r1" = 0 ] && [ "$r2" = 0 ] && [ "$r3" = 0 ] && [ "$r4" = 0 ]
  pass_if T11 $? "build with registry unreachable: exit $r1; recreate: exit $r2; seatmap restart: exit $r3; estate answering: $r4. npm ci from cache: ${cached:-none}. Steps run: ${ran:-none}"
  restore
  estate_down
  fi
  dashboard_remove
  kill "$guard" 2>/dev/null
  trap - EXIT
  [ -n "${RUN_LOCK:-}" ] && flock -u 9
}

case "$MODE" in
  static) static_checks ;;
  live) live_tests ;;
  *) echo "usage: build-test.sh static|live" >&2; exit 2 ;;
esac
echo "build-test: results in $RESULTS" >&2
! grep -q '| FAIL |' "$RESULTS"
