#!/usr/bin/env bash
# Validates packs/devflow and replays its fixtures. Archon discovers packs only in a repository's
# .archon/workflows/, so the pack is copied into a scratch repository first.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

mkdir -p "$scratch/.archon/workflows"
cp -R "$repo_root/packs/devflow" "$scratch/.archon/workflows/devflow"
git -C "$scratch" init -q -b main
git -C "$scratch" add -A
git -C "$scratch" -c user.name=test -c user.email=test@example.invalid commit -qm "devflow pack under test"

cd "$scratch"
archon validate workflows
archon workflow test .archon/workflows/devflow

# The retired toolkit is named only where the migration needs it; a stray name fails the check.
cd "$repo_root"
scripts/check-no-toolkit.sh
stray="$scratch/stray"
mkdir -p "$stray/packs/devflow/devflow-init"
cp packs/devflow/README.md "$stray/packs/devflow/"
cp packs/devflow/devflow-init/devflow-init.yaml "$stray/packs/devflow/devflow-init/"
printf 'root=$devflow_root\nconsole.error("devflow: x")\n# run /devflow:plan\n' > "$stray/packs/devflow/x.ts"
echo "nodes: # .claude/toolkit.yaml" >> "$stray/packs/devflow/devflow-init/devflow-init.yaml"
if scripts/check-no-toolkit.sh "$stray" 2> "$scratch/stray.err"; then echo "check-no-toolkit passed a stray toolkit name" >&2; exit 1; fi
for want in "x.ts:1:" "x.ts:3:" "devflow-init.yaml:"; do grep -qF "$want" "$scratch/stray.err" || { cat "$scratch/stray.err" >&2; echo "check-no-toolkit missed $want" >&2; exit 1; }; done
if grep -qE "x.ts:2:|README.md" "$scratch/stray.err"; then cat "$scratch/stray.err" >&2; echo "check-no-toolkit flagged harmless text" >&2; exit 1; fi
echo "check-no-toolkit: a stray name fails, harmless text passes"
