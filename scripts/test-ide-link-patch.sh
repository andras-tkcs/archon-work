#!/usr/bin/env bash
# Tests bootstrap.sh's patch_archon_ide_link (Archon's Open in IDE -> code-server).
# No network, no root, no archon. REAL_WEB_DIST=<dir> picks the web UI for the last case.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
eval "$(sed -n '/^patch_archon_ide_link() {$/,/^}$/p' "$repo_root/bootstrap.sh")"
declare -F patch_archon_ide_link >/dev/null || { echo "FAIL - function not found" >&2; exit 1; }

warned=0
warn() { printf 'WARN: %s\n' "$*" >&2; warned=1; }
fail() { echo "FAIL - $*" >&2; exit 1; }

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
owner="$(id -un):$(id -gn)"

make_fixture() {
  local dir="$1"
  mkdir -p "$dir/assets"
  printf '%s\n' '<script type="module" crossorigin src="/assets/index-AbCd_123.js"></script>' > "$dir/index.html"
  printf '%s\n' 'function XX(e,t){const n=e;if(t)return`vscode://vscode-remote/wsl+${t}${n}`;return`vscode://file/${n}`}' \
    > "$dir/assets/index-AbCd_123.js"
  cp "$dir/assets/index-AbCd_123.js" "$dir/pristine.js"
}

count_patched() { find "$1/assets" -maxdepth 1 -name 'index-*-cs-*.js' | wc -l; }
patched_src() { grep -m1 -oE '/assets/index-[A-Za-z0-9_-]+-cs-[0-9a-f]{8}\.js' "$1/index.html"; }

# 1
dir="$scratch/c1"; make_fixture "$dir"
warned=0
patch_archon_ide_link "$dir" 8443 "$owner"
grep -qE 'src="/assets/index-AbCd_123-cs-[0-9a-f]{8}\.js"' "$dir/index.html" || fail "index.html not repointed"
f="$dir$(patched_src "$dir")"
[[ -f "$f" ]] || fail "patched bundle missing"
grep -qF '`${location.protocol}//${location.hostname}:8443/?folder=${encodeURIComponent(n)}`' "$f" || fail "replacement missing"
! grep -qF 'vscode://file/' "$f" || fail "vscode://file/ still present"
grep -qF 'vscode://vscode-remote/wsl+' "$f" || fail "WSL branch lost"
cmp -s "$dir/assets/index-AbCd_123.js" "$dir/pristine.js" || fail "original bundle modified"
[[ $warned == 0 ]] || fail "unexpected warning"
echo "ok - patches the link"

# 2
cp "$dir/index.html" "$scratch/index.before"
warned=0
patch_archon_ide_link "$dir" 8443 "$owner"
cmp -s "$dir/index.html" "$scratch/index.before" || fail "index.html changed on re-run"
[[ "$(count_patched "$dir")" == 1 ]] || fail "expected one patched bundle"
echo "ok - is idempotent"

# 3
before="$(patched_src "$dir")"
warned=0
patch_archon_ide_link "$dir" 9443 "$owner"
after="$(patched_src "$dir")"
[[ "$before" != "$after" ]] || fail "index.html not repointed on port change"
grep -qF ':9443/?folder=' "$dir$after" || fail "new port missing"
[[ "$(count_patched "$dir")" == 1 ]] || fail "expected one patched bundle after port change"
echo "ok - re-patches on a port change"

# 4
dir="$scratch/c4"; make_fixture "$dir"
printf '%s\n' 'function XX(){return"x"}' > "$dir/assets/index-AbCd_123.js"
cp "$dir/index.html" "$scratch/index.before"
warned=0
patch_archon_ide_link "$dir" 8443 "$owner"
[[ $warned == 1 ]] || fail "expected a warning"
cmp -s "$dir/index.html" "$scratch/index.before" || fail "index.html changed"
[[ "$(count_patched "$dir")" == 0 ]] || fail "unexpected patched bundle"
echo "ok - warns when the link is missing"

# 5
dir="$scratch/c5"; make_fixture "$dir"
printf '%s\n' '<script src="/assets/main.js"></script>' > "$dir/index.html"
cp "$dir/index.html" "$scratch/index.before"
warned=0
patch_archon_ide_link "$dir" 8443 "$owner"
[[ $warned == 1 ]] || fail "expected a warning"
cmp -s "$dir/index.html" "$scratch/index.before" || fail "index.html changed"
echo "ok - warns when index.html loads no bundle"

# 6
dir="$scratch/c6"; mkdir -p "$dir"
warned=0
patch_archon_ide_link "$dir" 8443 "$owner"
[[ $warned == 0 ]] || fail "unexpected warning"
echo "ok - ignores a directory without index.html"

# 7
real="${REAL_WEB_DIST:-}"
if [[ -z "$real" ]]; then
  for h in "$HOME"/.archon/web-dist/*/index.html; do
    [[ -f "$h" ]] && { real="$(dirname "$h")"; break; }
  done
fi
if [[ -z "$real" ]]; then
  echo "skip - patches the real bundle (no Archon web UI on this machine)"
else
  cp -R "$real" "$scratch/real"
  warned=0
  patch_archon_ide_link "$scratch/real" 8443 "$owner"
  [[ $warned == 0 ]] || fail "real bundle: unexpected warning"
  src="$(patched_src "$scratch/real")" || fail "real bundle: index.html not repointed"
  [[ "$(grep -c 'hostname}:8443/?folder=' "$scratch/real$src")" == 1 ]] || fail "real bundle: link not patched exactly once"
  echo "ok - patches the real bundle"
fi
