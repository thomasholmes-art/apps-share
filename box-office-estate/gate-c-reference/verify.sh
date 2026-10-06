#!/usr/bin/env bash
# Gate checker for the box-office hackathon. Part of box-office-estate, the
# application behind module 07, lab 07-hackathon-two-worlds.
#
# Sends two purchases through the box office, reads the second one back from
# SigNoz, writes telemetry-export.json, and runs the four gate checks against
# it. Prints one line per gate and exits 0 only when all four pass.
# Diagnostics go to standard error. A run takes about half a minute.
#
# The first purchase is not checked. The first purchase after a period with
# no purchases can fail with the fault that movement 5 diagnoses, and a check
# of that purchase would report on the fault rather than on the latest
# edit. The second purchase is sent once the first has finished, and it is
# the one checked. Because every run sends two purchases, no run may start in
# the two minutes before movement 5.
#
# When the box office does not answer, nothing is sent and the newest
# purchase already in SigNoz is checked instead.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

box_office="${BOX_OFFICE_URL:-http://localhost:5180}"
# Long enough for the first purchase's payment job to finish after the box
# office has answered it, so that job's telemetry is not mistaken for the
# checked purchase's.
SETTLE_S=4

# One expression of the gates: the lab's copy when it is on this VM,
# otherwise the identical copy in tools/.
checker="${HOME}/labs/obs-lab-07/code/starter/gate-checks.mjs"
[ -f "$checker" ] || checker="tools/gate-checks.mjs"
echo "verify: checking with ${checker}" >&2

first="$(node tools/purchase.mjs "$box_office")"
if [ "$first" = 0 ]; then
  echo "verify: the box office did not answer on ${box_office}, so no purchase was sent; checking the newest purchase already in SigNoz" >&2
else
  echo "verify: sent a first purchase, which is not checked" >&2
  sleep "$SETTLE_S"
  # Read by export-telemetry.mjs: wait for this purchase, and check nothing older.
  VERIFY_SENT_AT_MS="$(date +%s%3N)"; export VERIFY_SENT_AT_MS
  checked="$(node tools/purchase.mjs "$box_office")"
  echo "verify: sent the purchase that is checked: HTTP ${checked}" >&2
fi

node tools/export-telemetry.mjs telemetry-export.json || exit 1
node "$checker" telemetry-export.json
