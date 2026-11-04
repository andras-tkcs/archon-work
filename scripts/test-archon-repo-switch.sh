#!/usr/bin/env bash
# Tests bootstrap.sh's stale_archon_plugins and archon_plugins_repo (switching ARCHON_REPO).
# No network, no root, no archon.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
for fn in stale_archon_plugins archon_plugins_repo; do
  eval "$(sed -n "/^$fn() {\$/,/^}\$/p" "$repo_root/bootstrap.sh")"
  declare -F "$fn" >/dev/null || { echo "FAIL - $fn not found" >&2; exit 1; }
done
fail() { echo "FAIL - $*" >&2; exit 1; }

list='andras-tkcs/archon-work/packs/devflow  workflow-pack  -  7581949effa7  archon >=0.13.0
coleam00/Archon/plugins/chat-slack  chat  v0.13.2  b8d01782fac6  archon any
coleam00/Archon/plugins/provider-claude  provider  v0.13.2  b8d01782fac6  archon any
coleam00/Archon/plugins/provider-pi  unavailable  protocol 2, this Archon speaks 3
tkcs-lab/Archon/plugins/provider-codex  provider  v0.13.4  35c31ae20173  archon any
someone/tools/plugins/chat-discord  chat  v1.0.0  0123456789ab  archon any'

expected_stale='coleam00/Archon/plugins/chat-slack
coleam00/Archon/plugins/provider-claude
coleam00/Archon/plugins/provider-pi'

out="$(stale_archon_plugins tkcs-lab/Archon <<<"$list")"
[[ "$out" == "$expected_stale" ]] || fail "lists the other repo's plugins"
echo "ok - lists the other repo's plugins"

out="$(stale_archon_plugins TKCS-LAB/archon <<<"$list")"
[[ "$out" == "$expected_stale" ]] || fail "compares repos case-insensitively"
echo "ok - compares repos case-insensitively"

out="$(stale_archon_plugins coleam00/Archon <<<"$list")"
[[ "$out" == "tkcs-lab/Archon/plugins/provider-codex" ]] || fail "works the other way round"
echo "ok - works the other way round"

out="$(stale_archon_plugins tkcs-lab/Archon <<<'No plugins installed.')"
[[ -z "$out" ]] || fail "nothing installed"
out="$(stale_archon_plugins tkcs-lab/Archon </dev/null)"
[[ -z "$out" ]] || fail "nothing installed"
echo "ok - nothing installed"

out="$(archon_plugins_repo <<<"$list")"
[[ "$out" == "coleam00/Archon" ]] || fail "reads the repo from the Claude provider"
echo "ok - reads the repo from the Claude provider"

out="$(archon_plugins_repo <<<'No plugins installed.')"
[[ -z "$out" ]] || fail "no Claude provider, no repo"
echo "ok - no Claude provider, no repo"

echo "all ok"
