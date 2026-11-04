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
