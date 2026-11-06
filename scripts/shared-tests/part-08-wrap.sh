#!/usr/bin/env bash
# The unattended build's start, merge and wrap scripts against a local bare origin: start pushes the
# stub deviations.md and refuses an existing branch; merge records a conflict instead of failing;
# done, stuck, skipped and conflict outcomes give the deviations.md structure and pass validate-docs;
# stage-docs commits only plans/issue-<n>/ (decoys stay out); push-all pushes the branch and the
# partial refs, never forced, and falls back to <branch>-stopped-<run>; a follow-up appends ### F<n>
# and leaves every earlier byte; agent text cannot break the file.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fx="$REPO_ROOT/scripts/fixtures/docs"
B=feat/issue-7-csv-export
js() { bun -e "const r=JSON.parse(process.argv[1]); console.log($2)" "$1"; }
vd() { bun "$SHARED/validate-docs.ts" --issue 7 --dir "$REPO/plans/issue-7" --kinds "$1" >/dev/null 2>&1; echo $?; }

use_stub_gh
mk_clone
cd "$REPO"
# The plans branch: issue 7's five documents and its build workflow.
git switch -q --orphan plans
mkdir -p plans/plans/issue-7 plans/workflows
for k in design plan plan-test before after; do cp "$fx/valid/$k.md" plans/plans/issue-7/; done
printf 'name: build-issue-7\ndescription: "Build of issue #7: design r1, plan r1."\n' > plans/workflows/build-issue-7.yaml
git add plans && git commit -qm plans && git push -q origin plans
git switch -q main
git branch -q -D plans
echo ".archon/worktrees/" > .gitignore && git add .gitignore && git commit -qm ignore && git push -q origin main

export ARTIFACTS_DIR="$(mk_tmp)"
start() { env INPUTS_ISSUE=7 INPUTS_BRANCH=$B INPUTS_MAIN_BRANCH=main INPUTS_MODE=build "$@" bun "$SHARED/start-build.ts"; }

# 1. start: the stub is committed and pushed before any phase runs.
out="$(start)"
eq "$(js "$out" 'r.ok')" "true" "start: ok"
eq "$(git branch --show-current)" "$B" "start: on the feature branch"
eq "$(git log -1 --format=%s)" "Start build issue-7 (stub deviations.md)" "start: the stub commit"
contains "$(git log -1 --format=%b)" "Issue: #7" "start: the Issue trailer"
eq "$(git ls-remote origin refs/heads/$B | cut -f1)" "$(git rev-parse HEAD)" "start: the branch is pushed"
eq "$(vd deviations)" "0" "start: the stub validates"
contains "$(cat plans/issue-7/deviations.md)" "build_outcome: running" "start: build_outcome running"
KEY="$(js "$out" 'r.run_key')"
contains "$KEY" "issue-7-" "start: the run key names the issue"
PC="$(js "$out" 'r.plan_commit')"
base="$(git rev-parse HEAD)"
eq "$(js "$(git switch -q main && start)" 'r.refusal')" "Not started: branch $B already exists (on origin). Use devflow-follow-up to continue it." "start: an existing branch is refused"
git switch -q "$B"

# 2. Phases (as the phase blocks leave them): p1-export done, p1-export-tests stuck with commits,
#    verify never reported (its dependency is not done), and an extra phase px that conflicts.
outcome() { INPUTS_RUN_KEY="$KEY" bun -e "import { writeOutcome } from '$SHARED/outcomes.ts'; writeOutcome(process.argv[1], JSON.parse(process.argv[2]))" "$1" "$2"; }
phase() { git switch -q -c "$1" "$base"; echo "$2" > "$3"; git add "$3"; git commit -qm "$1"; git rev-parse HEAD; git switch -q "$B"; }
h1="$(phase w-p1 "export" src.txt)"
h2="$(phase w-p2 "tests" test.txt)"
hx="$(phase w-px "conflicting" README.md)"
echo "main side" > README.md && git commit -qam "main side of README"
outcome p1-export '{"phase":"p1-export","status":"done","head":"'"$h1"'","summary":"writer","stuck_reason":"","decisions":[{"kind":"decision","title":"Quote {{x}} fields","choice":"QUOTE_ALL, see [a](b)","why":"TODO the design is silent","alternatives":"QUOTE_MINIMAL"},{"kind":"deviation","title":"Batches","choice":"1000 rows","why":"speed","alternatives":"one by one"}],"cases":[{"id":"T1","result":"pass"}],"partial_head":"","skipped":false}'
outcome p1-export-tests '{"phase":"p1-export-tests","status":"stuck","head":"'"$base"'","summary":"","stuck_reason":"fast checks | red","decisions":[],"cases":[{"id":"T2","result":"fail"}],"partial_head":"'"$h2"'","skipped":false}'
outcome px '{"phase":"px","status":"done","head":"'"$hx"'"}'

# 3. merge: done phases only, a conflict is recorded and the next head is still merged.
out="$(INPUTS_SLUG=issue-7 INPUTS_PHASES=px,p1-export,p1-export-tests INPUTS_RUN_KEY="$KEY" INPUTS_TITLES='{"p1-export":"CSV writer"}' bun "$SHARED/merge-phases.ts" 2>/dev/null)"; code=$?
eq "$code" "0" "merge: a conflict does not fail"
eq "$(js "$out" 'r.merged.join(",")+" | "+r.conflicts.join(",")+" | "+r.not_done.join(",")')" "p1-export | px | p1-export-tests" "merge: merged, conflicts and not done"
eq "$(git log -1 --format=%s%n%b | head -2 | tr '\n' '|')" "Merge issue-7 p1-export: CSV writer|Plan-Phase: issue-7/p1-export|" "merge: message and Plan-Phase trailer"
eq "$(git status --porcelain)" "" "merge: the aborted conflict leaves a clean tree"

# 3b. deps-check: a phase runs only on dependencies that are done and merged.
deps() { INPUTS_PHASE="$1" INPUTS_DEPENDS_ON="$2" INPUTS_RUN_KEY="$KEY" INPUTS_BASE="$base" bun "$SHARED/deps-check.ts" 2>/dev/null; }
eq "$(js "$(deps py p1-export)" 'r.ready')" "true" "deps-check: a done, merged dependency is ready"
eq "$(js "$(deps py px)" 'r.ready')" "false" "deps-check: a done dependency whose merge conflicted is not ready"
eq "$(bun -e "import { readOutcome } from '$SHARED/outcomes.ts'; const o = readOutcome('$KEY', 'py'); console.log(o.status + ' | ' + o.stuck_reason)")" "skipped | dependency px is conflicted" "deps-check: the skip names the conflict"
rm -f "$(git rev-parse --path-format=absolute --git-common-dir)/devflow/outcomes/$KEY/py.json"

# 4. deviations.md from the outcomes.
wd() { env INPUTS_ISSUE=7 INPUTS_BRANCH=$B INPUTS_PLAN_COMMIT="$PC" INPUTS_RUN_KEY="$KEY" INPUTS_PLANS_DIR=plans "$@" bun "$SHARED/write-deviations.ts" 2>/dev/null; }
out="$(wd INPUTS_MODE=build)"
eq "$(js "$out" 'r.complete+" "+r.stuck_phases.join(",")')" "false p1-export-tests,verify" "deviations: not complete, the stuck and skipped phases"
eq "$(js "$out" 'r.deviations_url')" "https://github.com/o/r/blob/$B/plans/issue-7/deviations.md" "deviations: the URL on the branch"
dev="$(cat plans/issue-7/deviations.md)"
contains "$dev" "stopped — phases: 1 done, 1 stuck, 1 skipped. Branch: $B. PR: no PR (stopped). Run: run run-1." "deviations: the Outcome line"
contains "$dev" "| p1-export-tests | stuck | fast checks / red | $B-partial-p1-export-tests |" "deviations: a stuck row with its partial branch"
contains "$dev" "| verify | skipped | dependency p1-export-tests is stuck | — |" "deviations: a skipped row names the dependency"
contains "$dev" "### V1. Batches" "deviations: a deviation is a V block"
contains "$dev" "### K1. Quote { {x}} fields" "deviations: a decision is a K block, its braces defused"
contains "$dev" "- Choice: QUOTE_ALL, see [a] (b)" "deviations: an agent's link is defused"
contains "$dev" "- p1-export: T1 pass" "deviations: test results per phase"
contains "$dev" "Cases of plan-test.md with no passing result: T2" "deviations: the cases with no pass"
contains "$dev" "revision: 2" "deviations: the revision counts the passes"
eq "$(vd deviations)" "0" "deviations: the file validates"

# 5. stage-docs: only the six files of the issue's folder; decoys stay out.
mkdir -p plans/issue-99 .archon/worktrees/w
echo decoy > plans/issue-99/x.md
echo decoy > .archon/worktrees/w/f && git add -f .archon/worktrees/w/f
echo "unrelated" > stray.txt
stage_ok() { bun -e "import { readOutcome } from '$SHARED/outcomes.ts'; console.log(readOutcome('$KEY', 'stage')?.ok)"; }
out="$(env INPUTS_ISSUE=7 INPUTS_PLAN_COMMIT="$PC" INPUTS_MODE=build INPUTS_PLANS_DIR=plans INPUTS_RUN_KEY="$KEY" bun "$SHARED/stage-docs.ts")"
eq "$(js "$out" 'r.committed')" "true" "stage-docs: committed"
eq "$(stage_ok)" "true" "stage-docs: the stage outcome is ok"
eq "$(git show --name-only --format= HEAD | LC_ALL=C sort | tr '\n' ' ')" "plans/issue-7/after.md plans/issue-7/before.md plans/issue-7/design.md plans/issue-7/deviations.md plans/issue-7/plan-test.md plans/issue-7/plan.md " "stage-docs: exactly the six documents"
eq "$(git log -1 --format=%s)" "Docs issue-7: design, plan, test plan and deviations" "stage-docs: the commit message"
eq "$(git ls-files .archon plans/issue-99 stray.txt)" "" "stage-docs: no decoy is tracked"
contains "$(cat plans/issue-7/deviations.md)" "### V2. Worktree paths were removed from the index" "stage-docs: the worktree path is recorded as a deviation"
eq "$(vd all)" "0" "stage-docs: the six documents validate together"
git add plans/issue-99/x.md
out="$(env INPUTS_ISSUE=7 INPUTS_PLAN_COMMIT="$PC" INPUTS_MODE=build INPUTS_PLANS_DIR=plans INPUTS_RUN_KEY="$KEY" bun "$SHARED/stage-docs.ts" 2>&1)"; code=$?
eq "$code" "1" "stage-docs: another issue's staged file fails"
contains "$out" "plans/issue-99/x.md" "stage-docs: the offender is named"
eq "$(stage_ok)" "false" "stage-docs: a failure leaves the stage outcome not ok"

# 5b. wrap-result: a build is deliverable only when its folder was committed as well as pushed.
K2="$KEY-deliver"
INPUTS_RUN_KEY="$K2" bun -e "import { writeOutcome } from '$SHARED/outcomes.ts'; writeOutcome('deviations', { complete: true }); writeOutcome('push', { ok: true, pushed: [] }); writeOutcome('stage', { ok: false })"
eq "$(js "$(INPUTS_STAGE=first INPUTS_RUN_KEY="$K2" INPUTS_BRANCH=$B bun "$SHARED/wrap-result.ts")" 'r.deliverable')" "false" "wrap-result: a failed stage-docs is not deliverable"
INPUTS_RUN_KEY="$K2" bun -e "import { writeOutcome } from '$SHARED/outcomes.ts'; writeOutcome('stage', { ok: true })"
eq "$(js "$(INPUTS_STAGE=first INPUTS_RUN_KEY="$K2" INPUTS_BRANCH=$B bun "$SHARED/wrap-result.ts")" 'r.deliverable')" "true" "wrap-result: committed and pushed is deliverable"
git reset -q plans/issue-99/x.md

# 5c. The final pass: stage-docs writes stage-final and leaves stage alone; a follow-up is complete
#     only when its final commit went through as well.
out="$(env INPUTS_ISSUE=7 INPUTS_MODE=final INPUTS_RUN_KEY="$KEY" bun "$SHARED/stage-docs.ts")"
eq "$(js "$out" 'r.committed')" "false" "stage-docs final: nothing new to commit"
eq "$(bun -e "import { readOutcome } from '$SHARED/outcomes.ts'; console.log(readOutcome('$KEY', 'stage-final')?.ok)")" "true" "stage-docs final: the stage-final outcome is ok"
eq "$(stage_ok)" "false" "stage-docs final: the first stage outcome is untouched"
K3="$KEY-followup"
INPUTS_RUN_KEY="$K3" bun -e "import { writeOutcome } from '$SHARED/outcomes.ts'; writeOutcome('deviations', { complete: true }); for (const k of ['push', 'push-final']) writeOutcome(k, { ok: true, pushed: [] }); writeOutcome('stage', { ok: true }); writeOutcome('stage-final', { ok: false })"
fu() { INPUTS_STAGE=final INPUTS_MODE=follow-up INPUTS_PR_NUMBER=5 INPUTS_RUN_KEY="$K3" INPUTS_BRANCH=$B bun "$SHARED/wrap-result.ts"; }
eq "$(js "$(fu)" 'r.complete+" "+r.pr_url')" "false https://github.com/o/r/pull/5" "wrap-result: a follow-up whose final commit failed is not complete"
INPUTS_RUN_KEY="$K3" bun -e "import { writeOutcome } from '$SHARED/outcomes.ts'; writeOutcome('stage-final', { ok: true })"
eq "$(js "$(fu)" 'r.complete')" "true" "wrap-result: a follow-up committed and pushed with a PR is complete"

# 6. push-all: the branch and the partial refs, never forced; wrap's result.
out="$(INPUTS_BRANCH=$B INPUTS_RUN_KEY="$KEY" bun "$SHARED/push-all.ts" 2>/dev/null)"
eq "$(js "$out" 'r.ok')" "true" "push-all: the branch is pushed"
eq "$(git ls-remote origin refs/heads/$B | cut -f1)" "$(git rev-parse HEAD)" "push-all: origin has the head"
eq "$(git ls-remote origin refs/heads/$B-partial-p1-export-tests | cut -f1)" "$h2" "push-all: the stuck phase's partial ref"
eq "$(git ls-remote origin refs/heads/$B-partial-px | cut -f1)" "$hx" "push-all: the conflicting phase's partial ref"
out="$(INPUTS_STAGE=first INPUTS_RUN_KEY="$KEY" INPUTS_BRANCH=$B bun "$SHARED/wrap-result.ts")"
eq "$(js "$out" 'r.complete+" "+r.deliverable+" "+(r.pr_url==="")')" "false false true" "wrap-result: a stuck build is not deliverable and has no PR"
contains "$(js "$out" 'r.pushed.join(",")')" "$B-partial-p1-export-tests" "wrap-result: lists the pushed refs"
eq "$(gh_calls 'pr create')" "0" "a stuck build opens nothing"

# 7. A rejected push falls back to <branch>-stopped-<run>.
cat > "$ORIGIN/hooks/pre-receive" <<HOOK
#!/bin/sh
while read old new ref; do [ "\$ref" = "refs/heads/$B" ] && { echo "rejected by test" >&2; exit 1; }; done
exit 0
HOOK
chmod +x "$ORIGIN/hooks/pre-receive"
git commit -q --allow-empty -m "one more"
out="$(INPUTS_BRANCH=$B INPUTS_RUN_KEY="$KEY" bun "$SHARED/push-all.ts" 2>/dev/null)"
eq "$(js "$out" 'r.ok')" "false" "push-all: a rejected push is not ok"
eq "$(git ls-remote origin refs/heads/$B-stopped-run-1 | cut -f1)" "$(git rev-parse HEAD)" "push-all: the work is pushed to -stopped-<run>"
rm "$ORIGIN/hooks/pre-receive"

# 8. A follow-up appends ### F1 and leaves every earlier byte.
before_body="$(awk 'f>=2{print} /^---$/{f++}' plans/issue-7/deviations.md)"
outcome f1 '{"phase":"f1","status":"done","head":"x","summary":"fixed the {{tests}}","decisions":[{"kind":"decision","title":"Keep the order","choice":"as is","why":"no reason to change"}]}'
out="$(wd INPUTS_MODE=follow-up INPUTS_TASK="fix the tests" INPUTS_FK=1)"
after="$(cat plans/issue-7/deviations.md)"
after_body="$(awk 'f>=2{print} /^---$/{f++}' plans/issue-7/deviations.md)"
eq "${after_body:0:$((${#before_body} - 6))}" "${before_body:0:$((${#before_body} - 6))}" "follow-up: the earlier text is unchanged"
contains "$after" "### F1 ($(date -u +%F), run run-1): fix the tests → done" "follow-up: the F1 heading"
contains "$after" "- Summary: fixed the { {tests}}" "follow-up: the summary, defused"
contains "$after" "- Decision: Keep the order. Choice: as is. Why: no reason to change." "follow-up: its decisions"
eq "$(vd deviations)" "0" "follow-up: the file validates"
outcome f2 '{"phase":"f2","status":"stuck","stuck_reason":"the API is down"}'
wd INPUTS_MODE=follow-up INPUTS_TASK="try again" INPUTS_FK=2 >/dev/null
contains "$(cat plans/issue-7/deviations.md)" "→ stuck" "follow-up: a stuck follow-up says so"
contains "$(cat plans/issue-7/deviations.md)" "build_outcome: stopped" "follow-up: stuck sets build_outcome stopped"
eq "$(vd deviations)" "0" "follow-up: two entries validate"

# 9. A broken outcome never leaves the file invalid or absent.
outcome p1-export '{"phase":"p1-export","status":"done","head":"'"$h1"'","decisions":5}'
out="$(wd INPUTS_MODE=build)"
eq "$(js "$out" 'r.problems.length > 0')" "true" "deviations: the failure is reported"
eq "$(vd deviations)" "0" "deviations: after a failure the file still validates"

# 10. Work without an issue (devflow-quick through the same tail) writes nothing.
eq "$(js "$(INPUTS_MODE=final INPUTS_WHERE=tail bun "$SHARED/write-deviations.ts")" 'r.skipped')" "true" "deviations: no issue, nothing to do"
finish
