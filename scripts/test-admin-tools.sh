#!/usr/bin/env bash
# Tests admin/gh-baseline.py (no network, no gh login), checks the hashes in bootstrap.sh against
# admin/, and tests bootstrap.sh's fetch_admin_file.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root" && python3 -m unittest discover -s admin/tests -t .
echo "ok - admin unit tests"

fail() { echo "FAIL - $*" >&2; exit 1; }

# hashes recorded in bootstrap.sh match admin/
for pair in ADMIN_SCRIPT_SHA256:admin/gh-baseline.py ADMIN_POLICY_SHA256:admin/policy.example.json; do
  var=${pair%%:*}; file=${pair#*:}
  want=$(sed -n "s/^$var=\([0-9a-f]\{64\}\).*/\1/p" bootstrap.sh)
  got=$(sha256sum "$file" | cut -d' ' -f1)
  [[ -n "$want" && "$want" == "$got" ]] || fail "$var does not match $file"
done
echo "ok - bootstrap hashes match admin/"

# fetch_admin_file
eval "$(sed -n '/^fetch_admin_file() {$/,/^}$/p' bootstrap.sh)"
declare -F fetch_admin_file >/dev/null || fail "fetch_admin_file not found"
warn() { echo "WARN: $*" >&2; }
BOOTSTRAP_REPO=o/r BOOTSTRAP_REF=t
work=$(mktemp -d); export TMPDIR=$(mktemp -d); err="$work/err"
src="$work/src"; printf 'hello\n' > "$src"
good=$(sha256sum "$src" | cut -d' ' -f1)
curl() { local out; while [[ $# -gt 0 ]]; do [[ $1 == -o ]] && out=$2; shift; done; cp "$src" "$out"; }

rc=0; fetch_admin_file x "$good" "$work/dest" 2>"$err" || rc=$?
[[ $rc == 0 && "$(cat "$work/dest")" == hello ]] || fail "matching file not installed (rc=$rc)"
echo "ok - fetch_admin_file installs a matching file"

rm -f "$work/dest"
rc=0; fetch_admin_file x deadbeef "$work/dest" 2>"$err" || rc=$?
[[ $rc == 1 ]] || fail "mismatch should return 1 (rc=$rc)"
grep -q "does not match this bootstrap" "$err" || fail "no mismatch warning"
[[ ! -e "$work/dest" ]] || fail "dest exists after mismatch"
[[ -z "$(ls -A "$TMPDIR")" ]] || fail "temp file left after mismatch"
echo "ok - fetch_admin_file refuses a mismatch without exiting"

curl() { return 22; }
rc=0; fetch_admin_file x "$good" "$work/dest" 2>"$err" || rc=$?
[[ $rc == 1 ]] || fail "download failure should return 1 (rc=$rc)"
grep -q "could not download" "$err" || fail "no download warning"
[[ -z "$(ls -A "$TMPDIR")" ]] || fail "temp file left after download failure"
echo "ok - fetch_admin_file warns when the download fails"
rm -rf "$work" "$TMPDIR"
