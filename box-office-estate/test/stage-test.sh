#!/usr/bin/env bash
# Static test of make-estate.sh and bin/stage for box-office-estate. Needs no
# containers. Builds the estate in a temporary directory and checks:
#
#   - two builds produce identical directories, with .stage "start" and no .git;
#   - make-estate.sh refuses a target that is not empty or that lies inside
#     the source directory;
#   - after `bin/stage start|a|b|c`, every shipped file equals the matching
#     snapshot (main/, gate-a-reference/, gate-b-reference/, gate-c-reference/);
#   - telemetry-spec.md and a file the application does not ship are never
#     changed or removed;
#   - each file replaced is first copied into .stage-backup/<time>/, with the
#     learner's edit intact;
#   - .stage holds the stage name; a second run of the same stage exits 0 and
#     changes nothing; an unknown name exits 2;
#   - every run that changes files ends by printing `docker compose up -d --build`.
#
# Prints one line per check and a summary; exits 1 if any check fails.
#
# Usage: test/stage-test.sh [work-dir]   (default: a new directory under /tmp)
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${1:-$(mktemp -d /tmp/boe-stage-test.XXXXXX)}"
E="$WORK/estate"
fails=0 passes=0

ok()  { echo "ok    $*"; passes=$((passes + 1)); }
bad() { echo "FAIL  $*"; fails=$((fails + 1)); }
check() { local what="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$what"; else bad "$what"; fi; }

# Shipped files at a stage equal the snapshot, ignoring what bin/stage adds and
# the files the learner owns.
same_as() { # snapshot
  diff -r -x node_modules -x dist -x target -x telemetry-export.json \
    -x bin -x stages -x .stage -x .stage-backup -x telemetry-spec.md -x learner-notes.txt \
    "$E" "$HERE/$1"
}

rm -rf "$E" "$WORK/estate2"
"$HERE/make-estate.sh" "$E" 2>/dev/null || { bad "make-estate.sh builds $E"; exit 1; }
ok "make-estate.sh builds $E"
"$HERE/make-estate.sh" "$WORK/estate2" 2>/dev/null
check "two builds are identical" diff -r "$E" "$WORK/estate2"
check ".stage is start after the build" grep -qx start "$E/.stage"
check "the estate has no .git" test ! -e "$E/.git"
check "bin/stage is executable" test -x "$E/bin/stage"
check "verify.sh is executable" test -x "$E/verify.sh"
check "the built tree equals main/" same_as main
for g in a b c; do
  n="$(find "$E/stages/gate-$g" -type f | wc -l)"
  [ "$n" -gt 0 ] && ok "stages/gate-$g holds $n files" || bad "stages/gate-$g is empty"
done
check "stages/start has no telemetry-spec.md" test ! -e "$E/stages/start/telemetry-spec.md"
if "$HERE/make-estate.sh" "$E" 2>/dev/null; then bad "refuses a target that is not empty"; else ok "refuses a target that is not empty"; fi
if "$HERE/make-estate.sh" "$HERE/stage-test-target" 2>/dev/null; then bad "refuses a target inside the source directory"
else ok "refuses a target inside the source directory"; fi
check "leaves no directory behind after refusing" test ! -e "$HERE/stage-test-target"
rm -rf "$WORK/estate2"

cd "$E" || exit 1
SPEC="learner spec $(date +%s)"
printf '%s\n' "$SPEC" > telemetry-spec.md
echo "notes" > learner-notes.txt
EDIT="// learner edit $(date +%s)"
echo "$EDIT" >> orders-api/src/orders/handler.ts

snap() { case "$1" in start) echo main ;; *) echo "gate-$1-reference" ;; esac; }
backups() { find .stage-backup -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l; }

first=1
for s in a a b c start c b a start; do
  before="$(backups)"
  out="$(bin/stage "$s" 2>&1)"; rc=$?
  if [ "$rc" != 0 ]; then bad "bin/stage $s exits 0 (exit $rc: $out)"; continue; fi
  if printf '%s\n' "$out" | grep -q '^stage: already at stage'; then
    [ "$(backups)" = "$before" ] && ok "bin/stage $s again: already at stage $s, no backup made" || bad "bin/stage $s again made a backup"
    continue
  fi
  check "bin/stage $s: shipped files equal $(snap "$s")/" same_as "$(snap "$s")"
  check "bin/stage $s: .stage is $s" grep -qx "$s" .stage
  check "bin/stage $s: telemetry-spec.md unchanged" grep -qxF "$SPEC" telemetry-spec.md
  check "bin/stage $s: learner-notes.txt left in place" test -f learner-notes.txt
  [ "$(backups)" = $((before + 1)) ] && ok "bin/stage $s: one new backup directory" || bad "bin/stage $s: expected one new backup directory"
  [ "$(printf '%s\n' "$out" | tail -1)" = "  docker compose up -d --build" ] \
    && ok "bin/stage $s: last line is the docker compose command" || bad "bin/stage $s: last line is $(printf '%s\n' "$out" | tail -1)"
  if [ "$first" = 1 ]; then
    first=0
    b="$(find .stage-backup -mindepth 1 -maxdepth 1 -type d | head -1)"
    check "the first backup holds the edited handler.ts" grep -qxF "$EDIT" "$b/orders-api/src/orders/handler.ts"
    check "no backup holds telemetry-spec.md" test -z "$(find .stage-backup -name telemetry-spec.md)"
  fi
done

out="$(bin/stage z 2>&1)"; rc=$?
[ "$rc" = 2 ] && ok "bin/stage z exits 2 with usage" || bad "bin/stage z exit $rc"
out="$(cd /tmp && "$E/bin/stage" b 2>&1)"; rc=$?
[ "$rc" = 0 ] && grep -qx b "$E/.stage" && ok "bin/stage works when run from another directory" || bad "bin/stage from another directory: exit $rc"

echo "stage-test: $passes passed, $fails failed (work directory $WORK)"
[ "$fails" = 0 ]
