#!/usr/bin/env bash
# publish-design.ts and publish-plan.ts end to end, through the wrappers the workflows run, against a
# local bare origin and the stub gh: paths, commit messages and trailers, revision increments, one
# comment created then edited, the validation of the commit before its push, and the published plan
# passing the --ref check the build's start runs. Then the refine and plan joins (format-round,
# record-answers, refine-block-result, plan-result, plan-block-result, refine-result), each through
# its wrapper.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
docs="$REPO_ROOT/scripts/fixtures/docs/valid"
REFINE="$REPO_ROOT/packs/devflow/mod-devflow-refine-block/scripts"
PLAN="$REPO_ROOT/packs/devflow/mod-devflow-plan-block/scripts"

mk_clone
repo="$REPO"
use_stub_gh
art="$(mk_tmp)"
mkdir -p "$art/final"
pub() { (cd "$repo" && ARTIFACTS_DIR="$art" INPUTS_ISSUE=7 INPUTS_TITLE="Export reports as CSV" "$@" 2>&1); }
design() { pub env INPUTS_REVISION="$1" bun "$REFINE/publish-design.ts"; }
plan() {
  pub env INPUTS_PLAN_REVISION="$1" INPUTS_DESIGN_REVISION="$2" INPUTS_WORKFLOW=build-issue-7 INPUTS_MAIN_BRANCH=main bun "$PLAN/publish-plan.ts"
}
# bump <file> <revision>: the fixture file at another revision, with its Revision log line.
bump() {
  sed -e "s/^revision: 1$/revision: $2/" -e "s/^Plan: plan.md r1$/Plan: plan.md r$2/" \
    -e "s/^\(- r1 (2026-11-06, run run-7): .*\)$/\1\n- r$2 (2026-11-06, run run-1): revision $2/" "$1"
}
workflow() { printf 'name: build-issue-7\ndescription: "Build of issue #7: design r%s, plan r%s."\nnodes: []\n' "$1" "$2" > "$art/build-issue-7.yaml"; }
branch_file() { git -C "$ORIGIN" show "plans:$1"; }
comment_body() { bun -e "console.log(JSON.parse(require('fs').readFileSync('$GH_STUB_DIR/comments-7.json','utf8'))[0].body)"; }

# --- publish-design: r1 creates the plans branch and the comment
cp "$docs/design.md" "$art/final/design.md"
out="$(design 1)"; code=$?
eq "$code" "0" "publish-design r1 succeeds"
contains "$out" '"design_url":"https://github.com/o/r/blob/plans/plans/plans/issue-7/design.md"' "design_url on the plans branch"
eq "$(branch_file plans/plans/issue-7/design.md)" "$(cat "$docs/design.md")" "design.md at plans/plans/issue-7/design.md"
eq "$(git -C "$ORIGIN" log -1 --format=%B plans)" $'Design issue-7 r1: Export reports as CSV\n\nIssue: #7\nRun: run-1' "design commit message and trailers"
eq "$(gh_calls '^POST issues/7/comments')" "1" "the comment is created"
contains "$(comment_body)" '| Design | ready | r1 |' "the comment shows design r1"
contains "$(comment_body)" 'Review `design.md`, then run `devflow-plan #7`' "Next: plan it"

# --- publish-design: r2 edits the same comment
bump "$docs/design.md" 2 > "$art/final/design.md"
design 2 >/dev/null
eq "$(git -C "$ORIGIN" rev-list --count plans)" "2" "r2 is a second commit"
contains "$(branch_file plans/plans/issue-7/design.md)" "revision: 2" "design.md is r2"
eq "$(gh_calls '^POST ')|$(gh_calls '^PATCH issues/comments/101')" "1|1" "r2 edits the comment, creates none"

# --- a hand-broken design is refused before the push and before any comment call
calls="$(wc -l < "$GH_STUB_DIR/calls.log")"
tip="$(git -C "$ORIGIN" rev-parse plans)"
sed '/^## Risks$/,/^None\.$/d' "$art/final/design.md" | sed 's/^revision: 2$/revision: 3/' > "$art/broken.md" && mv "$art/broken.md" "$art/final/design.md"
out="$(design 3)"; code=$?
eq "$code" "1" "an invalid published design fails"
contains "$out" "does not validate; nothing was pushed and the issue comment is unchanged" "the failure says nothing was pushed"
contains "$out" "[V4] '## Risks' is missing" "every error is listed"
eq "$(git -C "$ORIGIN" rev-parse plans)" "$tip" "the invalid design is not pushed"
eq "$(wc -l < "$GH_STUB_DIR/calls.log")" "$calls" "no comment call after the failed check"

# Back to a valid design r1 for the plan (a reset of the test origin, not of the code under test).
git -C "$repo" push -q origin --delete plans
rm "$GH_STUB_DIR/comments-7.json" "$GH_STUB_DIR/calls.log"
cp "$docs/design.md" "$art/final/design.md"
design 1 >/dev/null

# --- publish-plan: r1, five files in one commit
for k in plan plan-test before after; do cp "$docs/$k.md" "$art/final/$k.md"; done
workflow 1 1
out="$(plan 1 1)"; code=$?
eq "$code" "0" "publish-plan r1 succeeds"
contains "$out" '"workflow":"build-issue-7","revision":1,"unresolved":0' "publish-plan output"
eq "$(git -C "$ORIGIN" diff-tree --no-commit-id --name-only -r plans | LC_ALL=C sort | tr '\n' ' ')" "plans/plans/issue-7/after.md plans/plans/issue-7/before.md plans/plans/issue-7/plan-test.md plans/plans/issue-7/plan.md plans/workflows/build-issue-7.yaml " "four documents and the workflow in one commit"
eq "$(git -C "$ORIGIN" log -1 --format=%B plans)" $'Plan issue-7 r1: Export reports as CSV\n\nIssue: #7\nDesign: r1\nRun: run-1' "plan commit message and trailers"
eq "$(branch_file plans/plans/issue-7/before.md | tail -1)" "No manual steps." "before.md is written with no manual steps"
contains "$(branch_file plans/plans/issue-7/after.md)" "**Report:**" "after.md is written"
contains "$(branch_file plans/plans/issue-7/plan.md)" "design_revision: 1" "the plan carries the design revision"
eq "$(gh_calls '^POST ')|$(gh_calls '^PATCH ')" "1|1" "the plan edits the design's comment"
contains "$(comment_body)" '"build":{"state":"not_started"}' "the build is not started"
contains "$(comment_body)" '`archon workflow run build-issue-7 --detach`' "Next: run the build"
contains "$(cat "$art/published.md")" "extraWorkflowSources:" "published.md shows the config snippet when the project lacks it"
commit="$(git -C "$ORIGIN" rev-parse plans)"
out="$(cd "$repo" && bun "$SHARED/validate-docs.ts" --issue 7 --ref "$commit" --kinds plan,plan-test,before,after --with-design)"; code=$?
eq "$code" "0" "the published plan passes the --ref check the build's start runs"

# --- publish-plan: r2, with the review-only findings marked
for k in plan plan-test before after; do bump "$docs/$k.md" 2 > "$art/final/$k.md"; done
workflow 1 2
printf '### Unresolved validation findings\n\nThe large-tier review still reported these.\n\n- F1 [review, mechanical] p1-export: the brief names no test file\n' > "$art/unresolved.md"
printf 'extraWorkflowSources:\n  - ref: plans\n    path: plans\n' > "$repo/.archon-config.yaml"
mkdir -p "$repo/.archon" && mv "$repo/.archon-config.yaml" "$repo/.archon/config.yaml"
git -C "$repo" add .archon/config.yaml && git -C "$repo" commit -qm config && git -C "$repo" push -q origin main
out="$(plan 2 1)"; code=$?
eq "$code" "0" "publish-plan r2 succeeds"
contains "$out" '"revision":2,"unresolved":1' "r2 with one unresolved finding"
contains "$(branch_file plans/plans/issue-7/plan-test.md)" "revision: 2" "plan-test.md is r2"
contains "$(branch_file plans/plans/issue-7/plan.md)" "> This plan was published with 1 unresolved review findings." "the warning is under the Design line"
contains "$(branch_file plans/plans/issue-7/plan.md)" "- F1 [review, mechanical] p1-export" "the findings are in the plan"
lacks "$(cat "$art/published.md")" "extraWorkflowSources:" "no config snippet when the project has it"
eq "$(gh_calls '^POST ')" "1" "still one comment"
contains "$(comment_body)" '| Plan | ready | r2 |' "the comment shows plan r2"

# --- the design moves ahead: the comment marks the plan stale
bump "$docs/design.md" 2 > "$art/final/design.md"
design 2 >/dev/null
contains "$(comment_body)" "**stale: built from design r1**" "a newer design marks the plan stale"

# --- review text with a template leftover, marked into plan.md, is refused before the push
tip="$(git -C "$ORIGIN" rev-parse plans)"
for k in plan plan-test before after; do bump "$docs/$k.md" 3 | sed 's/^design_revision: 1$/design_revision: 2/' > "$art/final/$k.md"; done
sed -i 's/^Design: design.md r1$/Design: design.md r2/' "$art/final/plan.md" "$art/final/plan-test.md"
workflow 2 3
printf '### Unresolved validation findings\n\n- F1 [review, mechanical] p1-export: the brief says TODO\n' > "$art/unresolved.md"
out="$(plan 3 2)"; code=$?
eq "$code" "1" "a marked plan that does not validate fails"
contains "$out" "[V2] leftover 'TODO'" "the marked text is checked"
eq "$(git -C "$ORIGIN" rev-parse plans)" "$tip" "the invalid plan is not pushed"

# --- a hand-broken plan is refused before the push and before any comment call
calls="$(wc -l < "$GH_STUB_DIR/calls.log")"
for k in plan plan-test before after; do bump "$docs/$k.md" 3 | sed 's/^design_revision: 1$/design_revision: 2/' > "$art/final/$k.md"; done
sed -i 's/^Design: design.md r1$/Design: design.md r2/' "$art/final/plan.md" "$art/final/plan-test.md"
sed -i '/^## Not tested$/,/^None\.$/d' "$art/final/plan-test.md"
rm "$art/unresolved.md"
workflow 2 3
out="$(plan 3 2)"; code=$?
eq "$code" "1" "an invalid published plan fails"
contains "$out" "[V4] '## Not tested' is missing" "the failure lists the error"
eq "$(git -C "$ORIGIN" rev-parse plans)" "$tip" "the broken plan is not pushed"
eq "$(wc -l < "$GH_STUB_DIR/calls.log")" "$calls" "no comment call after the failed check"

# --- the refine and plan joins, each through the wrapper its workflow runs
q='[{"id":"Q1","title":"Format","context":"Which format costs $5?","options":[{"key":"a","text":"CSV"},{"key":"b","text":"XLSX"}],"recommendation":{"key":"a","why":"simplest"}}]'
out="$(ARTIFACTS_DIR="$art" INPUTS_ROUND=1 INPUTS_ISSUE=7 INPUTS_TITLE=T INPUTS_QUESTIONS="$q" bun "$REFINE/format-round.ts" 2>&1)"; code=$?
eq "$code" "0" "format-round succeeds"
contains "$out" 'round 1 of max 2' "format-round builds the message"
contains "$out" 'costs ＄5' "format-round keeps a dollar sign literal"
out="$(ARTIFACTS_DIR="$art" INPUTS_ROUND=3 INPUTS_ISSUE=7 INPUTS_QUESTIONS="$q" bun "$REFINE/format-round.ts" 2>&1)"; code=$?
eq "$code" "1" "format-round refuses round 3"

rm -f "$art/interview.md"
ra() { ARTIFACTS_DIR="$art" INPUTS_ROUND=1 INPUTS_QUESTIONS="$q" INPUTS_ANSWER="$1" bun "$REFINE/record-answers.ts"; }
eq "$(ra '1: b')" '{"stop":false}' "an answer does not stop"
eq "$(ra 'Stop, not now')" '{"stop":true}' "stop stops"
contains "$(cat "$art/interview.md")" $'## Round 1\n\nQ1: Format (recommended: a)\n\nA: 1: b' "the round is recorded"

out="$(ARTIFACTS_DIR="$art" INPUTS_ISSUE=7 INPUTS_REVISION=2 INPUTS_DESIGN_URL=https://x/design.md bun "$REFINE/refine-block-result.ts")"
contains "$out" '"designed":true,"issue":7,"revision":2,"design_url":"https://x/design.md","questions_asked":2' "refine-block-result reads the interview"

printf '{"issue":7,"revision":2,"branch":"feat/x","title":"T","workflow":"build-issue-7","scope":"small","waves":1}' > "$art/tested.json"
eq "$(ARTIFACTS_DIR="$art" bun "$PLAN/plan-result.ts")" '{"issue":7,"revision":2,"branch":"feat/x","title":"T","workflow":"build-issue-7"}' "plan-result hands the stamped revision to publish"
rm "$art/tested.json"
out="$(ARTIFACTS_DIR="$art" bun "$PLAN/plan-result.ts" 2>&1)"; code=$?
eq "$code" "1" "plan-result fails without a tested plan"

pbr() { INPUTS_ISSUE=7 INPUTS_DESIGN_REVISION=2 INPUTS_PUBLISH="$1" INPUTS_NEEDS_REFINE="$2" bun "$PLAN/plan-block-result.ts" 2>&1; }
eq "$(pbr '{"commit":"c","workflow":"build-issue-7","revision":2,"unresolved":1,"message":"m"}' '')" '{"planned":true,"issue":7,"plan_revision":2,"design_revision":2,"workflow":"build-issue-7","needs_refine":false,"unresolved_findings":1}' "plan-block-result: published"
eq "$(pbr '' '{"planned":false,"needs_refine":true,"comment_url":"u"}')" '{"planned":false,"issue":7,"plan_revision":0,"design_revision":2,"workflow":"","needs_refine":true,"unresolved_findings":0}' "plan-block-result: needs_refine"

RR="$REPO_ROOT/packs/devflow/devflow-refine/scripts/refine-result.ts"
o1='{"choice":"revise","outcome":{"designed":true,"issue":7,"revision":1,"design_url":"u1"}}'
o2='{"choice":"plan","outcome":{"designed":true,"issue":7,"revision":2,"design_url":"u2"}}'
choice="$(INPUTS_MODE=choice INPUTS_ATTEND_1="$o1" INPUTS_ATTEND_2="$o2" bun "$RR")"
eq "$choice" '{"choice":"plan","issue":7,"outcome":{"designed":true,"issue":7,"revision":2,"design_url":"u2"}}' "refine-result choice: the last pass decides"
out="$(INPUTS_MODE=choice bun "$RR" 2>&1)"; code=$?
eq "$code" "1" "refine-result choice fails when no pass paused"
eq "$(INPUTS_MODE=result INPUTS_CHOICE="$choice" INPUTS_PLAN='{"planned":true,"needs_refine":false}' bun "$RR")" '{"designed":true,"issue":7,"revision":2,"design_url":"u2","planned":true,"needs_refine":false}' "refine-result result: planned"
eq "$(INPUTS_MODE=result INPUTS_CHOICE="$choice" INPUTS_PLAN= bun "$RR")" '{"designed":true,"issue":7,"revision":2,"design_url":"u2","planned":false,"needs_refine":false}' "refine-result result: not planned"
finish
