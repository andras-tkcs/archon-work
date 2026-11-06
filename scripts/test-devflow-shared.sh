#!/usr/bin/env bash
# Hermetic tests of packs/devflow/.shared: scratch git repositories, a local bare origin and a stub gh,
# no network. Runs every scripts/shared-tests/part-NN-*.sh, or only the parts named by number
# (scripts/test-devflow-shared.sh 2 4 5).
set -euo pipefail

for v in $(compgen -e | grep '^INPUTS_' || true); do unset "$v"; done

here="$(cd "$(dirname "$0")" && pwd)"
parts=()
if [ $# -eq 0 ]; then
  parts=("$here"/shared-tests/part-*.sh)
else
  for n in "$@"; do
    f=("$here"/shared-tests/part-"$(printf '%02d' "$n")"-*.sh)
    if [ ! -e "${f[0]}" ]; then echo "FAIL part $n: no scripts/shared-tests/part-$(printf '%02d' "$n")-*.sh"; exit 1; fi
    parts+=("${f[0]}")
  done
fi

failed=0
for part in "${parts[@]}"; do
  name="$(basename "$part" .sh)"
  if out="$(bash "$part" 2>&1)"; then echo "PASS $name"; else printf '%s\n' "$out"; echo "FAIL $name"; failed=1; fi
done
exit "$failed"
