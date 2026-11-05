#!/usr/bin/env bash
# Tests admin/gh-baseline.py (no network, no gh login). From p4 on also checks the hashes
# in bootstrap.sh.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root" && python3 -m unittest discover -s admin/tests -t .
echo "ok - admin unit tests"
