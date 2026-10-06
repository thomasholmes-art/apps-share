#!/usr/bin/env bash
#
# verify.sh: check the running obs-sample-estate against the stage recorded
# in .stage. For the image bake, the tech check and a facilitator who wants
# to know whether one learner's estate is in the state their lab expects.
# Learners do not run it.
#
#   ./verify.sh          run every check for the current stage
#
# It places real orders (the failing basket and a basket without the
# T-shirt) through the storefront, so run it on an estate nobody is
# measuring at that moment. It needs about 30 seconds at stage 01, which
# waits for the dispatch-queue client to go idle.
#
# Each check prints PASS, FAIL or WARN. WARN is for things outside the
# estate (SigNoz, the host log collector) or for timing that a busy VM can
# miss. The exit status is the number of FAILs.
#
# Environment:
#   COMPOSE         compose command, default "docker compose"
#   DOCKER          container command, default "docker"
#   STOREFRONT_URL  default http://localhost:5173
#   CHECKOUT_URL    default http://localhost:3000
#   SIGNOZ_URL      default http://localhost:8080
# No pipefail: every pipe below ends in a grep test, and `grep -q` closing the
# pipe early would otherwise count as a failure.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
COMPOSE="${COMPOSE:-docker compose}"
DOCKER="${DOCKER:-docker}"
SF="${STOREFRONT_URL:-http://localhost:5173}"
API="${CHECKOUT_URL:-http://localhost:3000}"
SIGNOZ="${SIGNOZ_URL:-http://localhost:8080}"
STAGE="$(tr -d '[:space:]' < .stage 2>/dev/null || echo 01)"
FAILS=0

pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS + 1)); }
warn() { printf 'WARN  %s\n' "$*"; }

SHORT='{"customer":{"id":"cus_verify"},"basket":{"currency":"GBP","lines":[{"sku":"MUG-ENAMEL-01","qty":1},{"sku":"CAP-NAVY-OS","qty":1},{"sku":"TS-SHIRT-XL-BLK","qty":2}]}}'
VARIED='{"customer":{"id":"cus_verify"},"basket":{"currency":"GBP","lines":[{"sku":"MUG-ENAMEL-01","qty":1},{"sku":"CAP-NAVY-OS","qty":1}]}}'

# post <json> -> prints "<status> <bytes> <seconds> <x-correlation-id or ->"
post() {
  curl -s -o /dev/null -D /tmp/verify-headers.$$ -w '%{http_code} %{size_download} %{time_total}' \
    -X POST "$SF/api/checkout" -H 'content-type: application/json' -d "$1"
  local cid
  cid="$(tr -d '\r' < /tmp/verify-headers.$$ | sed -n 's/^x-correlation-id: //Ip' | head -1)"
  printf ' %s\n' "${cid:--}"
  rm -f /tmp/verify-headers.$$
}

logs_since() {
  $COMPOSE logs --no-log-prefix --no-color --since "$1" checkout-api 2>&1
}

echo "obs-sample-estate at stage $STAGE"

# ---- A: the four services are up -----------------------------------------
running="$($COMPOSE ps --status running --services 2>/dev/null | sort | tr '\n' ' ')"
missing=""
for svc in checkout-api dispatch-worker inventory storefront; do
  case " $running " in *" $svc "*) ;; *) missing="$missing $svc" ;; esac
done
if [ -z "$missing" ]; then pass "A storefront, checkout-api, inventory and dispatch-worker are running"
else fail "A not running:$missing (docker compose up -d)"; fi

# ---- B: health and the storefront page -----------------------------------
if [ "$(curl -s "$API/healthz")" = ok ]; then pass "B checkout-api GET /healthz answers ok"
else fail "B checkout-api GET /healthz does not answer ok on $API"; fi
if curl -s "$SF/" | grep -q '<div id="root">'; then pass "B storefront serves the shop page on $SF"
else fail "B storefront does not serve the shop page on $SF"; fi

# ---- C: the failing basket fails, a varied basket succeeds ---------------
start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$STAGE" = 01 ]; then
  # Let the stage-01 queue client go idle, so the next publish shows the
  # EAGAIN line and its recovery.
  sleep 11
fi
r1="$(post "$SHORT")"; r2="$(post "$SHORT")"; r3="$(post "$VARIED")"
if [ "${r1%% *}" = 500 ] && [ "${r2%% *}" = 500 ]; then pass "C the failing basket answers 500 twice"
else fail "C the failing basket answered ${r1%% *} and ${r2%% *}, not 500 and 500"; fi
if [ "${r3%% *}" = 201 ]; then pass "C the basket without TS-SHIRT-XL-BLK answers 201"
else fail "C the basket without TS-SHIRT-XL-BLK answered ${r3%% *}, not 201"; fi
sleep 1
log="$(logs_since "$start")"

# ---- D: stage 01, the module 01 log formats --------------------------------
if [ "$STAGE" = 01 ]; then
  read -r _ b500 _ _ <<< "$r1"; read -r _ b201 _ _ <<< "$r3"
  if [ "$b500" = 62 ] && [ "$b201" = 118 ]; then pass "D response bodies are 62 bytes (500) and 118 bytes (201)"
  else warn "D response bodies are $b500 and $b201 bytes, not 62 and 118"; fi
  check_line() { # <label> <extended regex>
    if printf '%s\n' "$log" | grep -Eq -- "$2"; then pass "D $1"; else fail "D no line matching: $1"; fi
  }
  check_line "checkout start" '^[0-9T:.Z-]+ checkout: start customer=cus_verify lines=3 currency=GBP$'
  check_line "basket line" '^[0-9T:.Z-]+ checkout: basket MUG-ENAMEL-01 x1, CAP-NAVY-OS x1, TS-SHIRT-XL-BLK x2$'
  check_line "inventory request" '^[0-9T:.Z-]+ inventory-> POST /reserve \(3 line\(s\)\)$'
  check_line "inventory reply" '^[0-9T:.Z-]+ inventory<- 200 \{"reservations":\[\{"sku":"MUG-ENAMEL-01","id":"rsv_[0-9]+"\},\{"sku":"CAP-NAVY-OS","id":"rsv_[0-9]+"\}\]\}$'
  check_line "pricing line" '^[0-9T:.Z-]+ pricing: subtotal 2450 GBP, shipping 395 GBP$'
  check_line "untimestamped mismatch line" '^checkout: reservations 2 / lines 3$'
  check_line "payload line" '^[0-9T:.Z-]+ checkout: building order payload$'
  check_line "TypeError" "^[0-9T:.Z-]+ TypeError: Cannot read properties of undefined \(reading 'id'\)$"
  check_line "buildOrderPayload frame" '^    at buildOrderPayload \(/app/src/checkout.js:87:34\)$'
  check_line "anonymous handler frame" '^    at /app/src/checkout.js:84:29$'
  check_line "abandon line" '^[0-9T:.Z-]+ checkout: order abandoned, releasing 2 reservation\(s\)$'
  check_line "EAGAIN line" '^[0-9T:.Z-]+ ERROR dispatch-queue: publish failed \(EAGAIN\), retrying in 100ms$'
  check_line "EAGAIN recovery" '^[0-9T:.Z-]+ dispatch-queue: publish ok after 1 retry$'
  check_line "order created" '^[0-9T:.Z-]+ checkout: order created ord_[0-9]{8}_[0-9]{4}$'
  check_line "combined access line" '^::ffff:[0-9.]+ - - \[[0-9]{2}/[A-Z][a-z]{2}/[0-9]{4}:[0-9:]{8} \+0000\] "POST /api/checkout HTTP/1.1" 500 62 "-" "[^"]*"$'
  # The once-per-start and timer lines, from the whole stream.
  all="$($COMPOSE logs --no-log-prefix --no-color checkout-api 2>&1)"
  for family in \
    'start-up line|^[0-9T:.Z-]+ checkout-api listening on :3000 \(env=lab, build=local\)$' \
    'config warning|^\[warn\] config: INVENTORY_TIMEOUT_MS not set, using default 2000$' \
    'health line|^[0-9]{2}:[0-9]{2}:[0-9]{2} GET /healthz 200 [0-9]+ms$' \
    'session-store line|^[0-9T:.Z-]+ session-store: (pruned [0-9]+ expired sessions|created sid=sess_[0-9a-f]{4} \(ttl 1800s\))$' \
    'DEP0169 line|^[0-9T:.Z-]+ \(node:1\) \[DEP0169\] DeprecationWarning: url.parse\(\)' \
    'metrics-scrape line|^[0-9T:.Z-]+ metrics-scrape: read ECONNRESET$' \
    'catalogue cache line|^[0-9T:.Z-]+ cache: catalog page [0-9] (hit|miss, fetched in [0-9]+ms)$' \
    'gc line|^[0-9]{13} gc: scavenge [0-9]+ms, heap [0-9]+MB$'; do
    label="${family%%|*}"; regex="${family#*|}"
    if printf '%s\n' "$all" | grep -Eq -- "$regex"; then pass "D $label"
    else warn "D no $label yet (timers write some of these once a minute; run again later)"; fi
  done
  if printf '%s\n' "$all" | grep -Eiq 'correlation|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|traceparent'; then
    fail "D a checkout-api line carries a request identifier"
  else pass "D no checkout-api line carries a request identifier"; fi
fi

# ---- E: stage 02 on, structured output -----------------------------------
if [ "$STAGE" != 01 ]; then
  cid="${r1##* }"
  if [ "$cid" != - ]; then pass "E checkout answers carry x-correlation-id ($cid)"
  else fail "E the checkout answer has no x-correlation-id header"; fi
  # Key order varies (from lab 03 the pino instrumentation adds trace_id and
  # span_id), so each field is matched on its own.
  if printf '%s\n' "$log" | grep -F '"event":"http.request"' | grep -F '"route":"/api/checkout"' \
       | grep -F '"status":500' | grep -Fq '"correlation_id":"'; then
    pass "E checkout-api writes the http.request event for the failing checkout"
  else fail "E no http.request event for the failing checkout in checkout-api's output"; fi
  if printf '%s\n' "$log" | grep -q '"event":"catalog\|"event":"http.request","method":"GET"'; then
    pass "E non-checkout routes write structured events"
  else warn "E no structured browsing events seen in this window"; fi
  if printf '%s\n' "$log" | grep -q 'pino-pretty'; then fail "E pretty-printed output found"; fi
fi

# ---- F: the search route --------------------------------------------------
read -r scode stime < <(curl -s -o /dev/null -w '%{http_code} %{time_total}\n' "$SF/api/search?q=mug&currency=GBP")
sms="$(awk -v t="$stime" 'BEGIN { printf "%d", t * 1000 }')"
if [ "$scode" = 200 ] && [ "$sms" -ge 600 ] && [ "$sms" -le 1200 ]; then pass "F GET /api/search answers 200 in ${sms} ms (about 694 expected)"
elif [ "$scode" = 200 ]; then warn "F GET /api/search answers 200 in ${sms} ms, outside 600-1200"
else fail "F GET /api/search answered $scode"; fi

# ---- G: checkout latency for the stage ------------------------------------
read -r _ _ t3 _ <<< "$r3"
ms="$(awk -v t="$t3" 'BEGIN { printf "%d", t * 1000 }')"
case "$STAGE" in
  04) if [ "$ms" -ge 600 ]; then pass "G a successful checkout takes ${ms} ms (about 750 expected at stage 04)"
      else fail "G a successful checkout takes ${ms} ms; stage 04 should be about 750"; fi ;;
  05|06) if [ "$ms" -lt 400 ]; then pass "G a successful checkout takes ${ms} ms (about 130 expected from stage 05)"
      else warn "G a successful checkout takes ${ms} ms, not about 130; see the bin/stage 05 output"; fi ;;
  *) if [ "$ms" -lt 600 ]; then pass "G a successful checkout takes ${ms} ms"
     else warn "G a successful checkout takes ${ms} ms"; fi ;;
esac

# ---- H: outside the estate ------------------------------------------------
code="$(curl -s -o /dev/null -w '%{http_code}' "$SIGNOZ/" || true)"
case "$code" in
  200|302) pass "H SigNoz answers $code on $SIGNOZ/" ;;
  *) warn "H SigNoz does not answer on $SIGNOZ/ (got $code); labs 02 to 06 need it" ;;
esac
if $DOCKER ps --format '{{.Names}}' 2>/dev/null | grep -qx obs-host-collector; then
  pass "H the host log collector (obs-host-collector) is running"
else warn "H the host log collector (obs-host-collector) is not running; logs will not reach SigNoz"; fi

# Lab 06 reads reserve.shortfall as a label of SigNoz's span metric
# signoz_calls_total. SigNoz v0.144 keeps the dotted names (service.name,
# reserve.shortfall); an underscored filter or group-by matches nothing.
# Needs the viewer API key, jq, and checkout traffic in the last 30 minutes
# with lab 03's override in place.
KEYFILE="${SIGNOZ_API_KEY_FILE:-$HOME/.config/signoz/api-key}"
if [ "$STAGE" != 01 ] && [ "$STAGE" != 02 ] && [ -s "$KEYFILE" ] && command -v jq >/dev/null; then
  now="$(date +%s)"
  values="$(curl -s -H "SIGNOZ-API-KEY: $(cat "$KEYFILE")" -H 'Content-Type: application/json' \
    "$SIGNOZ/api/v5/query_range" -d "{\"schemaVersion\":\"v1\",\"start\":$((now - 1800))000,\"end\":${now}000,
      \"requestType\":\"time_series\",\"compositeQuery\":{\"queries\":[{\"type\":\"builder_query\",\"spec\":{
      \"name\":\"A\",\"signal\":\"metrics\",\"stepInterval\":1800,
      \"aggregations\":[{\"metricName\":\"signoz_calls_total\",\"timeAggregation\":\"increase\",\"spaceAggregation\":\"sum\"}],
      \"filter\":{\"expression\":\"service.name = 'checkout-api' AND operation = 'POST /api/checkout'\"},
      \"groupBy\":[{\"name\":\"reserve.shortfall\"}]}}]}}" \
    | jq -r '[.. | objects | select(has("labels")) | .labels[]? | select(.key.name == "reserve.shortfall") | .value] | unique | join(",")' 2>/dev/null)"
  case ",$values," in
    *,none,*) pass "H signoz_calls_total for POST /api/checkout carries reserve.shortfall ($values)" ;;
    *) warn "H no signoz_calls_total series with reserve.shortfall for checkout-api in the last 30 minutes" ;;
  esac
fi

echo
if [ "$FAILS" -eq 0 ]; then echo "All estate checks passed for stage $STAGE."
else echo "$FAILS check(s) failed for stage $STAGE."; fi
exit "$FAILS"
