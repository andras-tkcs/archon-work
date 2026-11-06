#!/usr/bin/env bash
# publish-design.ts and publish-plan.ts end to end, against a local bare origin and the stub gh:
# paths, commit messages and trailers, revision increments, one comment created then edited, the
# read-back validation before any comment call, and the published plan passing the --ref check the
# build's start runs.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
docs="$REPO_ROOT/scripts/fixtures/docs/valid"

mk_clone
repo="$REPO"
use_stub_gh
art="$(mk_tmp)"
mkdir -p "$art/final"
pub() { (cd "$repo" && ARTIFACTS_DIR="$art" INPUTS_ISSUE=7 INPUTS_TITLE="Export reports as CSV" "$@" 2>&1); }
design() { pub env INPUTS_REVISION="$1" bun "$SHARED/publish-design.ts"; }
plan() {
  pub env INPUTS_PLAN_REVISION="$1" INPUTS_DESIGN_REVISION="$2" INPUTS_WORKFLOW=build-issue-7 INPUTS_MAIN_BRANCH=main bun "$SHARED/publish-plan.ts"
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

# --- a hand-broken design is refused after the push, before any comment call
calls="$(wc -l < "$GH_STUB_DIR/calls.log")"
sed '/^## Risks$/,/^None\.$/d' "$art/final/design.md" | sed 's/^revision: 2$/revision: 3/' > "$art/broken.md" && mv "$art/broken.md" "$art/final/design.md"
out="$(design 3)"; code=$?
eq "$code" "1" "an invalid published design fails"
contains "$out" "does not validate; the issue comment is unchanged" "the failure says the comment is unchanged"
contains "$out" "[V4] '## Risks' is missing" "every error is listed"
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

# --- a hand-broken plan is refused after the push, before any comment call
calls="$(wc -l < "$GH_STUB_DIR/calls.log")"
for k in plan plan-test before after; do bump "$docs/$k.md" 3 | sed 's/^design_revision: 1$/design_revision: 2/' > "$art/final/$k.md"; done
sed -i 's/^Design: design.md r1$/Design: design.md r2/' "$art/final/plan.md" "$art/final/plan-test.md"
sed -i '/^## Not tested$/,/^None\.$/d' "$art/final/plan-test.md"
rm "$art/unresolved.md"
workflow 2 3
out="$(plan 3 2)"; code=$?
eq "$code" "1" "an invalid published plan fails"
contains "$out" "[V4] '## Not tested' is missing" "the failure lists the error"
eq "$(wc -l < "$GH_STUB_DIR/calls.log")" "$calls" "no comment call after the failed check"
finish
