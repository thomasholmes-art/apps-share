#!/usr/bin/env bash
# Builds the box-office-estate directory that is installed on the lab image
# as ~/labs/box-office-estate (module 07, lab 07-hackathon-two-worlds).
#
# The result is a plain directory, not a git repository:
#
#   <target-dir>/                the application as shipped (main/)
#   <target-dir>/bin/stage       moves the source files between rollback points
#   <target-dir>/stages/start/   every shipped file except telemetry-spec.md
#   <target-dir>/stages/gate-a/  the files gate-a-reference/ changes from main/
#   <target-dir>/stages/gate-b/  the files gate-b-reference/ changes from main/
#   <target-dir>/stages/gate-c/  the files gate-c-reference/ changes from main/
#   <target-dir>/.stage          "start"
#
# stages/gate-X.remove (and stages/start.remove) list files that are in one
# state and not the other; each is written only when it has entries, and
# today no gate adds or removes a file. The header of bin/stage describes
# what each rollback point contains and what a run changes.
#
# The script only writes inside <target-dir>, which must not exist or must be
# empty, and must not be inside this directory or inside the git repository
# this script lives in, if there is one. The same snapshots always produce the
# same files.
#
# Usage: make-estate.sh <target-dir>
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="${1:?usage: make-estate.sh <target-dir>}"

if [ -e "$target" ] && [ -n "$(ls -A "$target" 2>/dev/null)" ]; then
  echo "make-estate: $target exists and is not empty" >&2
  exit 1
fi
mkdir -p "$target"
target="$(cd "$target" && pwd)"

refuse_inside() {
  case "$target/" in
    "$1"/*)
      echo "make-estate: $target is inside $1; choose a directory outside it" >&2
      rmdir "$target" 2>/dev/null || true
      exit 1 ;;
  esac
}
refuse_inside "$here"
source_repo="$(git -C "$here" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$source_repo" ] && refuse_inside "$source_repo"

for snapshot in main gate-a-reference gate-b-reference gate-c-reference; do
  [ -f "$here/$snapshot/docker-compose.yml" ] || { echo "make-estate: $here/$snapshot is missing" >&2; exit 1; }
done
[ -f "$here/bin/stage" ] || { echo "make-estate: $here/bin/stage is missing" >&2; exit 1; }

# Build output, installed dependencies and verify.sh's output are not copied.
EXCLUDES=(--exclude node_modules/ --exclude dist/ --exclude target/
          --exclude telemetry-export.json --exclude /.git)

# The files of a snapshot, one relative path per line, sorted.
files_of() {
  (cd "$here/$1" && find . -type f \
      -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/target/*' \
      -not -name telemetry-export.json -not -path './.git/*' |
    sed 's|^\./||' | LC_ALL=C sort)
}

# The application as shipped.
rsync -a "${EXCLUDES[@]}" "$here/main/" "$target/"

install -D -m 0755 "$here/bin/stage" "$target/bin/stage"

# stages/start/: every shipped file. telemetry-spec.md is the learner's and
# bin/stage never touches it, so it has no copy here.
mkdir -p "$target/stages/start"
rsync -a "${EXCLUDES[@]}" --exclude /telemetry-spec.md "$here/main/" "$target/stages/start/"

main_files="$(files_of main)"
for gate in a b c; do
  snap="gate-$gate-reference"
  out="$target/stages/gate-$gate"
  mkdir -p "$out"
  while IFS= read -r path; do
    [ "$path" = telemetry-spec.md ] && continue
    if [ ! -f "$here/main/$path" ] || ! cmp -s "$here/main/$path" "$here/$snap/$path"; then
      install -D -m "$(stat -c %a "$here/$snap/$path")" "$here/$snap/$path" "$out/$path"
    fi
  done < <(files_of "$snap")
  # Shipped files this gate does not have.
  removed="$(LC_ALL=C comm -23 <(printf '%s\n' "$main_files") <(files_of "$snap") | grep -vx telemetry-spec.md || true)"
  [ -n "$removed" ] && printf '%s\n' "$removed" > "$target/stages/gate-$gate.remove"
  # Files this gate adds; bin/stage start removes them.
  added="$(LC_ALL=C comm -13 <(printf '%s\n' "$main_files") <(files_of "$snap") || true)"
  [ -n "$added" ] && printf '%s\n' "$added" >> "$target/stages/start.remove.tmp"
done
if [ -f "$target/stages/start.remove.tmp" ]; then
  LC_ALL=C sort -u "$target/stages/start.remove.tmp" > "$target/stages/start.remove"
  rm "$target/stages/start.remove.tmp"
fi

echo start > "$target/.stage"

for d in "$target"/stages/*/; do
  printf 'make-estate: %-14s %3d files\n' "stages/$(basename "$d")" "$(find "$d" -type f | wc -l)" >&2
done
echo "make-estate: built $target at stage start" >&2
