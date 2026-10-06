#!/usr/bin/env bash
# Builds lab 07's code/starter/reference-sources/ tree from the box-office-estate
# snapshots (spec section 6.3): read-only copies of the files that carry the
# seven TODO(telemetry-...) markers and the two pre-wired files they depend on,
# at their repository paths. The top level is copied from main/; after/ is
# copied from gate-c-reference/. Every file is a byte-identical copy, which
# build-test.sh checks (test T12).
#
# Usage: make-reference-sources.sh [dest-dir]
# The default destination is the lab 07 starter in the courseware tree, two
# levels above this directory.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dest="${1:-$here/../../learner/units/observability-tooling-practices/labs/07-hackathon-two-worlds/code/starter/reference-sources}"

# Files with markers (top level and after/), then pre-wired files (top level only).
MARKED=(
  docker-compose.yml
  orders-api/src/orders/handler.ts
  orders-api/src/payments/queue-client.ts
  payments-sim/src/consumer.js
  seatmap/src/main/resources/logback-spring.xml
)
PREWIRED=(
  orders-api/src/correlation.js
  shared/logger.js
)

rm -rf "$dest"
mkdir -p "$dest"
for f in "${MARKED[@]}" "${PREWIRED[@]}"; do
  install -D -m 0644 "$here/main/$f" "$dest/$f"
done
for f in "${MARKED[@]}"; do
  install -D -m 0644 "$here/gate-c-reference/$f" "$dest/after/$f"
done

cat > "$dest/README.txt" <<'EOF'
Read-only copies of the box-office-estate files that a learner edits in
part 4, at the paths they have in ~/labs/box-office-estate. The top level
is the application as shipped: the five files that carry the seven
TODO(telemetry-A), TODO(telemetry-B) and TODO(telemetry-C) markers, and the two
pre-wired files they depend on, orders-api/src/correlation.js and
shared/logger.js. after/ holds the same five marked files as they are at the
end of gate C (the files bin/stage c puts in place), with gates A, B and C
resolved. Use these copies when the box office is not running; editing them
changes nothing in the application.
EOF
echo "reference-sources written to $dest" >&2
