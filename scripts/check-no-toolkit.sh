#!/usr/bin/env bash
# Fails when packs/devflow or bootstrap.sh still name the retired claude-toolkit: devflow_root,
# CLAUDE_PLUGIN_ROOT, a /devflow: slash command, claude-toolkit or .claude/toolkit.yaml. Allowed
# only where the migration needs them: the README's migration section, devflow-init (its
# description, fixtures, scan, scaffold, profile proposal, PR body and the legacy path constant it
# reads) and the profile validator's warning text. An installed workflow's name
# (`tkcs-lab/devflow:devflow-refine`, `<owner>/devflow:<workflow>`) and the `devflow:` log prefix are
# not a slash command.
# Usage: check-no-toolkit.sh [repository root]
set -euo pipefail

root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$root"
[ -d packs/devflow ] || { echo "check-no-toolkit: no packs/devflow in $root" >&2; exit 1; }
pattern='devflow_root|CLAUDE_PLUGIN_ROOT|(^|[^[:alnum:]_.>-])/devflow:|claude-toolkit|\.claude/toolkit\.yaml'

# The line range of a README section, or of a YAML file's top-level description block.
section() { awk -v h="$2" '$0 == h { on = 1; print NR; next } on && /^## / { exit } on { print NR }' "$1"; }
description() { awk '/^description:/ { on = 1; print NR; next } on && /^[^[:space:]]/ { exit } on { print NR }' "$1"; }

allowed_lines="$(
  { [ -f packs/devflow/README.md ] && section packs/devflow/README.md "## Migrating from the toolkit" | sed 's|^|packs/devflow/README.md:|'; } || true
  { [ -f packs/devflow/devflow-init/devflow-init.yaml ] && description packs/devflow/devflow-init/devflow-init.yaml | sed 's|^|packs/devflow/devflow-init/devflow-init.yaml:|'; } || true
)"
allowed_file() {
  case "$1" in
    packs/devflow/devflow-init/fixtures/* | packs/devflow/devflow-init/commands/propose-profile.md) return 0 ;;
    packs/devflow/.shared/scan-repo.ts | packs/devflow/.shared/scaffold-repo.ts | packs/devflow/.shared/publish-init.ts) return 0 ;;
    packs/devflow/.shared/validate-profile.py) return 0 ;;
  esac
  return 1
}

bad=0
while IFS= read -r hit; do
  file="${hit%%:*}"
  rest="${hit#*:}"
  line="${rest%%:*}"
  allowed_file "$file" && continue
  grep -qxF "$file:$line" <<<"$allowed_lines" && continue
  # The legacy profile path devflow-init reads and removes.
  [ "$file" = packs/devflow/.shared/util.ts ] && [[ "$rest" == *"LEGACY_PROFILE_PATH = \".claude/toolkit.yaml\""* ]] && continue
  echo "check-no-toolkit: $hit" >&2
  bad=1
done < <(grep -rnE "$pattern" packs/devflow bootstrap.sh 2>/dev/null || true)

[ "$bad" = 0 ] || { echo "check-no-toolkit: the retired toolkit is still named outside the migration allow-list" >&2; exit 1; }
echo "check-no-toolkit: ok"
