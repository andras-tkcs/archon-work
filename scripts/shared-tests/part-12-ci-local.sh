#!/usr/bin/env bash
# ci-local.ts: which jobs run locally and which are skipped (with the reason), a failing job turns
# the result red with its output, credentials never reach a step, --list runs nothing, a crash is
# red. mod-devflow-dod's result (dod-result.ts, record-ci-fix.ts) and the follow-up's ready rule.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ci() { bun "$SHARED/ci-local.ts" "$@"; }
field() { bun -e "const r=JSON.parse(await Bun.stdin.text()); console.log($1)"; }
job() { echo "$1" | field "JSON.stringify(r.ran.find(j=>j.job==='$2') ?? null)"; }

repo="$(mk_scratch)"
mkdir -p "$repo/.github/workflows" "$repo/sub"
cat > "$repo/.github/workflows/ci.yml" <<'EOF'
name: ci
on:
  pull_request:
  push:
    branches: [main]
env:
  GREETING: hello
jobs:
  pass:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - name: greet
        run: echo "$GREETING from ${{ runner.os }}" > greeted.txt
      - name: env dump
        run: env > env.txt
      - name: in sub
        working-directory: sub
        run: pwd > here.txt
      - uses: some/other-action@v1
  fail:
    runs-on: ubuntu-22.04
    steps:
      - run: |
          echo "line before the failure"
          false
      - name: never
        run: touch never.txt
  secret:
    runs-on: ubuntu-latest
    steps:
      - run: echo ${{ secrets.API_KEY }}
  mac:
    runs-on: macos-latest
    steps:
      - run: echo mac
  boxed:
    runs-on: ubuntu-latest
    container: node:20
    steps:
      - run: echo boxed
  expr:
    runs-on: ubuntu-latest
    steps:
      - run: echo ${{ github.event.number }}
  matrix:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        py: ["3.11", "3.12"]
    steps:
      - run: echo "py ${{ matrix.py }}" >> matrix.txt
  notool:
    runs-on: ubuntu-latest
    steps:
      - run: no-such-tool-xyz --version
EOF
cat > "$repo/.github/workflows/release.yml" <<'EOF'
on: workflow_dispatch
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - run: touch released.txt
EOF
git -C "$repo" add -A && git -C "$repo" commit -qm ci
export ARTIFACTS_DIR="$(mk_tmp)"

# --list runs nothing and names the plan.
out="$(cd "$repo" && ci --list)"
[ ! -e "$repo/greeted.txt" ]; eq "$?" "0" "--list runs nothing"
eq "$(job "$out" pass | field 'r.status')" "plan" "--list plans the runnable job"
eq "$(job "$out" release | field 'r.reason')" "the workflow runs on neither push nor pull_request" "--list names why a job is skipped"

# A real run.
out="$(cd "$repo" && GH_TOKEN=leak GITHUB_TOKEN=leak MY_SECRET=leak DB_PASSWORD=leak ci)"
eq "$(echo "$out" | field 'r.status')" "red" "a failing job makes the result red"
eq "$(job "$out" pass | field 'r.status')" "pass" "a passing job passes"
eq "$(cat "$repo/greeted.txt")" "hello from Linux" "workflow env and runner.os are substituted"
eq "$(cat "$repo/sub/here.txt")" "$repo/sub" "working-directory is honoured"
env_txt="$(cat "$repo/env.txt")"
lacks "$env_txt" "GH_TOKEN=" "GH_TOKEN is removed"
lacks "$env_txt" "GITHUB_TOKEN=" "GITHUB_TOKEN is removed"
lacks "$env_txt" "MY_SECRET=" "a *SECRET* variable is removed"
lacks "$env_txt" "DB_PASSWORD=" "a *PASSWORD* variable is removed"
contains "$env_txt" "CI=true" "CI is true"
steps="$(job "$out" pass | field 'r.steps.map(s=>s.name+":"+s.status).join(",")')"
eq "$steps" "actions/checkout@v4:skip,actions/setup-node@v4:skip,greet:pass,env dump:pass,in sub:pass,some/other-action@v1:skip" "uses: steps are skipped and listed"
eq "$(job "$out" pass | field 'r.status+" "+r.reason')" "pass 3 step(s) skipped" "a passing job names its skipped steps"
eq "$(job "$out" fail | field 'r.status')" "fail" "the failing job fails"
contains "$(job "$out" fail | field 'r.steps[0].tail')" "line before the failure" "the failing step's output is captured"
eq "$(job "$out" fail | field 'r.steps[1].reason')" "an earlier step failed" "later steps do not run"
[ ! -e "$repo/never.txt" ]; eq "$?" "0" "the step after a failure did not run"
eq "$(job "$out" secret | field 'r.reason')" "the job reads a secret or github.token" "a job with secrets is skipped"
eq "$(job "$out" mac | field 'r.reason')" 'runs-on "macos-latest" is not ubuntu-*' "a macos job is skipped"
eq "$(job "$out" boxed | field 'r.reason')" "the job runs in a container" "a container job is skipped"
eq "$(job "$out" expr | field 'r.reason')" "unresolved expression" "an unresolved expression skips the job"
eq "$(cat "$repo/matrix.txt")" "py 3.11" "only the first matrix entry runs"
eq "$(job "$out" notool | field 'r.steps[0].reason')" "missing tool no-such-tool-xyz" "a missing tool skips the step"
eq "$(job "$out" notool | field 'r.status')" "skip" "a job with nothing runnable is skipped"
eq "$(job "$out" release | field 'r.status')" "skip" "a dispatch-only workflow is not run"
[ ! -e "$repo/released.txt" ]; eq "$?" "0" "the dispatch-only job did not run"
eq "$(echo "$out" | field 'r.failed.map(j=>j.job).join(",")')" "fail" "failed lists the failing job"
eq "$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$ARTIFACTS_DIR/outcomes/ci-local.json','utf8')).status)")" "red" "the result is written to outcomes/ci-local.json"

# The profile picks jobs and can turn local CI off.
mkdir -p "$repo/.devflow"
printf 'verify:\n  ci_local:\n    jobs: [pass, secret]\n    env:\n      GREETING: hi\n' > "$repo/.devflow/devflow.yaml"
out="$(cd "$repo" && ci)"
eq "$(echo "$out" | field 'r.status')" "green" "only the listed jobs run"
eq "$(job "$out" secret | field 'r.reason')" "the job reads a secret or github.token" "a listed job with secrets is still skipped"
eq "$(job "$out" fail | field 'r.reason')" "not listed in verify.ci_local.jobs" "an unlisted job is skipped"
eq "$(cat "$repo/greeted.txt")" "hi from Linux" "the profile's env is passed in"
printf 'verify:\n  ci_local:\n    enabled: false\n' > "$repo/.devflow/devflow.yaml"
eq "$(cd "$repo" && ci | field 'r.status+" "+r.reason')" "skipped disabled in the profile" "enabled: false skips local CI"
rm "$repo/.devflow/devflow.yaml"

# A red definition of done: no CI time is spent.
echo '{"green":false}' > "$ARTIFACTS_DIR/outcomes/dod.json"
eq "$(cd "$repo" && ci | field 'r.status+" "+r.reason')" "skipped the definition of done is red" "a red dod skips local CI"
rm "$ARTIFACTS_DIR/outcomes/dod.json"

# A crash is red, never neutral.
echo '{' > "$ARTIFACTS_DIR/outcomes/dod.json"
eq "$(cd "$repo" && ci 2>/dev/null | field 'r.status')" "red" "a crash in ci-local is red"
contains "$(cat "$ARTIFACTS_DIR/outcomes/ci-local.json")" "local CI could not run" "the crash is the reason"
rm "$ARTIFACTS_DIR/outcomes/dod.json"

# No runnable job: skipped, which is fine.
empty="$(mk_scratch)"
eq "$(cd "$empty" && ci | field 'r.status')" "skipped" "a repository without workflows is skipped"

# mod-devflow-dod's result: ok is the definition of done, ci_status the last run, rounds the fixes.
export ARTIFACTS_DIR="$(mk_tmp)"
dodres() { bun "$SHARED/dod-result.ts" | field "$1"; }
eq "$(dodres 'r.ok+" "+r.ci_status+" "+r.ci_local.rounds')" "false red 0" "dod-result: nothing reported is red, not skipped"
contains "$(dodres 'r.ci_local.reason')" "did not report" "dod-result: the missing result is named"
fix() { INPUTS_FIX="$1" bun "$SHARED/record-ci-fix.ts" | field 'r.rounds'; }
eq "$(fix '')" "0" "record-ci-fix: a fix that did not run is no round"
eq "$(fix '{"fixed":true,"summary":"s","decisions":[]}')" "1" "record-ci-fix: the first session"
eq "$(fix '{"fixed":false,"summary":"s","decisions":[]}')" "2" "record-ci-fix: the second session"
[ -f "$ARTIFACTS_DIR/outcomes/ci-fix-2.json" ]; eq "$?" "0" "record-ci-fix: each session is an outcome"
echo '{"green":true,"failed":[],"unavailable":[],"report":""}' > "$ARTIFACTS_DIR/outcomes/dod.json"
echo '{"status":"green","reason":"","ran":[],"failed":[],"skipped":[],"dirty":[]}' > "$ARTIFACTS_DIR/outcomes/ci-local.json"
eq "$(dodres 'r.ok+" "+r.ci_status+" "+r.ci_local.rounds')" "true green 2" "dod-result: green after two fix sessions"

# The follow-up marks a local-CI draft ready only when the definition of done is green as well.
use_stub_gh
echo '{"isDraft":true,"body":"<!-- devflow:draft-ci -->\nLocal CI failed"}' > "$GH_STUB_DIR/pr-5.json"
ready() { (cd "$empty" && INPUTS_PR_NUMBER=5 INPUTS_ISSUE=7 bun "$SHARED/followup-pr.ts" 2>/dev/null | field 'r.ready'); }
echo '{"green":false}' > "$ARTIFACTS_DIR/outcomes/dod.json"
echo '{"status":"skipped","reason":"the definition of done is red"}' > "$ARTIFACTS_DIR/outcomes/ci-local.json"
eq "$(ready)" "false" "follow-up: a red definition of done keeps the draft"
eq "$(gh_calls 'pr ready')" "0" "follow-up: gh pr ready is not called"
echo '{"green":true}' > "$ARTIFACTS_DIR/outcomes/dod.json"
echo '{"status":"red","reason":"local CI did not finish"}' > "$ARTIFACTS_DIR/outcomes/ci-local.json"
eq "$(ready)" "false" "follow-up: red local CI keeps the draft"
echo '{"status":"green","reason":""}' > "$ARTIFACTS_DIR/outcomes/ci-local.json"
eq "$(ready)" "true" "follow-up: green dod and local CI mark the draft ready"
eq "$(gh_calls 'pr ready 5')" "1" "follow-up: gh pr ready ran once"
finish
