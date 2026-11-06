#!/usr/bin/env bash
# render-run.ts and the plan block's render, test-plan and check-plan scripts: scripts/test-render-run.sh.
set -uo pipefail
exec bash "$(dirname "${BASH_SOURCE[0]}")/../test-render-run.sh"
