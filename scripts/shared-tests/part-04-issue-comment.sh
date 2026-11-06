#!/usr/bin/env bash
# issue-comment.ts: deterministic render, state merge, the Next line of every state, and upsert
# (created once, edited afterwards, a duplicate fails). settle.ts: every row of the attention table.
# trace.ts: each build event's patch, an empty issue, and a failed write that never fails the build.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fx="$REPO_ROOT/scripts/fixtures/issue-comment"

ic() { bun -e "import * as C from '$SHARED/issue-comment.ts'; $1"; }
full='{repo:"o/r",plans:{ref:"plans",dir:"plans"},design:{revision:2,commit:"abc",title:"T"},plan:{revision:1,design_revision:1,commit:"def"},build:{state:"pr_open",pr:{number:57,url:"https://github.com/o/r/pull/57"}},proposed_rulings:["- **Q:** q **A:** a **Source:** s"],needs_refine:{question:"Which?",why:"no doc",run:"r9"},updated_at:"2026-11-06T10:00:00Z",updated_by:"r9"}'

eq "$(ic "process.stdout.write(C.renderComment(42,$full))")" "$(cat "$fx/golden.md")" "render matches the golden body"
eq "$(ic "console.log(C.renderComment(42,$full)===C.renderComment(42,$full))")" "true" "render is deterministic"
lacks "$(ic "process.stdout.write(C.renderComment(42,{...$full,proposed_rulings:[],needs_refine:undefined}))")" "Proposed rulings" "empty sections are omitted"
contains "$(ic "process.stdout.write(C.renderComment(42,{...$full,plan:{revision:1,design_revision:2}}))")" "| Plan | ready | r1 |" "a current plan is not stale"
contains "$(ic "process.stdout.write(C.renderComment(42,{...$full,proposed_rulings:['x'],needs_refine:{question:'a<!-- -->b'}}))")" 'a<!-- -->b' "the state JSON cannot close its comment"

merged="$(ic 'console.log(JSON.stringify(C.mergeState({a:1,design:{revision:1,title:"t"},needs_refine:{q:1}},{design:{revision:2},needs_refine:null,b:[1]})))')"
eq "$merged" '{"a":1,"design":{"revision":2,"title":"t"},"b":[1]}' "merge keeps unrelated state, null deletes"

next() { ic "console.log(C.nextLine(42,$1))"; }
eq "$(next '{}')" 'Run `devflow-refine #42`' "Next: no design"
eq "$(next '{design:{revision:1}}')" 'Review `design.md`, then run `devflow-plan #42`' "Next: no plan"
eq "$(next '{design:{revision:2},plan:{revision:1,design_revision:1}}')" 'Review `design.md`, then run `devflow-plan #42`' "Next: stale plan"
eq "$(next '{design:{revision:1},plan:{revision:1,design_revision:1},build:{state:"not_started"}}')" 'Review the plan, then run `archon workflow sync` and `archon workflow run build-issue-42 --detach`' "Next: not started"
eq "$(next '{design:{revision:1},plan:{revision:1,design_revision:1},build:{state:"building",run:"r7"}}')" 'Build running (run r7)' "Next: building"
eq "$(next '{design:{revision:1},plan:{revision:1,design_revision:1},build:{state:"pr_open",pr:{number:57}}}')" 'Review and merge PR #57.' "Next: PR open"
eq "$(next '{design:{revision:1},plan:{revision:1,design_revision:1},build:{state:"merged"}}')" 'Done.' "Next: merged"
eq "$(next '{design:{revision:1},plan:{revision:1,design_revision:1},build:{state:"closed"}}')" 'Done.' "Next: closed"
eq "$(next '{design:{revision:1},needs_refine:{question:"q"}}')" 'Answer the open question with `devflow-refine #42: <answer>`' "Next: needs_refine wins"
out="$(next '{design:{revision:1},plan:{revision:1,design_revision:1},build:{state:"stopped"}}' 2>&1)"
contains "$out" "unknown build state 'stopped'" "an unknown build state fails"

use_stub_gh
up() { ic "console.log(JSON.stringify(C.upsertComment(42,$1)))"; }
up '{design:{revision:1,commit:"c1",title:"T"}}' >/dev/null
eq "$(gh_calls '^POST issues/42/comments')" "1" "the first write creates the comment"
up '{plan:{revision:1,design_revision:1,commit:"c2"},build:{state:"not_started"}}' >/dev/null
eq "$(gh_calls '^POST ')" "1" "the second write creates nothing"
eq "$(gh_calls '^PATCH issues/comments/101')" "1" "the second write edits the comment"
body="$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$GH_STUB_DIR/comments-42.json','utf8'))[0].body)")"
contains "$body" '"design":{"revision":1,"commit":"c1","title":"T"}' "the design state is kept"
contains "$body" '"plan":{"revision":1' "the plan state is added"
contains "$body" '"repo":"o/r","plans":{"ref":"plans","dir":"plans"}' "repository and plans location are recorded"
contains "$body" "https://github.com/o/r/blob/plans/plans/plans/issue-42/plan-test.md" "links point at the plans branch"
contains "$body" "_Updated " "the footer names the time"
contains "$body" " by run run-1._" "the footer names the run"

# A marked comment by someone else is found too (author-independent); two marked comments fail.
bun -e "const f='$GH_STUB_DIR/comments-42.json';const a=JSON.parse(require('fs').readFileSync(f,'utf8'));a.unshift({id:90,html_url:'https://x/other',body:'hello'});a.push({id:200,html_url:'https://x/dup',body:'<!-- devflow:issue-42 -->\nold'});require('fs').writeFileSync(f,JSON.stringify(a))"
out="$(ic "C.upsertComment(42,{needs_refine:{question:'q',why:'w',run:'r'}},'abc123')" 2>&1)"; code=$?
eq "$code" "1" "two marked comments fail"
contains "$out" "remove the duplicate: https://x/dup" "the failure names the duplicate"
contains "$out" "already pushed in commit abc123" "the failure names the pushed commit"
eq "$(gh_calls '^PATCH issues/comments/101')" "2" "the first marked comment is still updated"
touch "$GH_STUB_DIR/fail-api"
out="$(ic "C.upsertComment(42,{})" 2>&1)"; code=$?
eq "$code" "1" "a gh failure fails"
contains "$out" "cannot list the comments of issue #42" "the gh failure is named"

# settle.ts: the attention pause.
st() { env INPUTS_STAGE=devflow-refine "$@" bun "$SHARED/settle.ts" 2>&1; }
jf() { printf '%s' "$1" | bun -e 'const o=JSON.parse(await Bun.stdin.text()); const v=o[process.argv[1]]; console.log(typeof v==="string"?v:JSON.stringify(v))' "$2"; }
outcome='{"designed":true,"issue":7,"revision":2,"design_url":"https://x/design.md","assumptions":7,"assumption_lines":["- a1","- a2","- a3","- a4","- a5 costs $5","- a6","- a7"]}'
first="$(st INPUTS_OUTCOME="$outcome")"
eq "$(jf "$first" done)" "false" "designed: the pause is not done"
eq "$(jf "$first" options)" '[{"id":"plan","label":"Plan it"},{"id":"revise","label":"Revise (add a note)"},{"id":"finish","label":"Finish"}]' "designed: plan, revise, finish"
eq "$(jf "$first" message)" "$(printf '%s
' 'Design for issue #7 is ready: revision 2 — https://x/design.md' '' 'Assumptions taken (not asked): 7 — listed under "Assumptions" in the file.' '- a1' '- a2' '- a3' '- a4' '- a5 costs ＄5' '… and 2 more' '' 'plan: run devflow-plan now and publish build-issue-7.' 'revise: another refine pass; your note is the change request (revision 3).' 'finish: stop here; the design stays published.')" "the exact pause message, at most 5 assumptions, \$ kept literal"
last="$(st INPUTS_OUTCOME="$outcome" INPUTS_LAST=true)"
eq "$(jf "$last" options)" '[{"id":"plan","label":"Plan it"},{"id":"finish","label":"Finish"}]' "last pass: no revise option"
lacks "$(jf "$last" message)" "revise:" "last pass: no revise line"
empty="$(st INPUTS_OUTCOME='')"
eq "$(jf "$empty" done)|$(jf "$empty" message)" "true|" "no outcome (stage failed): done, no pause"
for d in plan finish; do
  r="$(st INPUTS_PREVIOUS="$first" INPUTS_ANSWER="{\"decision\":\"$d\",\"text\":\"\"}")"
  eq "$(jf "$r" done)|$(jf "$r" choice)|$(jf "$r" message)" "true|$d|" "answer $d: done"
  contains "$(jf "$r" outcome)" '"revision":2' "answer $d: the stage's outcome is kept"
done
r="$(st INPUTS_PREVIOUS="$first" INPUTS_ANSWER='{"decision":"revise","text":"use a semicolon"}')"
eq "$(jf "$r" done)|$(jf "$r" choice)|$(jf "$r" brief)" "false|revise|use a semicolon" "answer revise: not done, the note is the brief"
r="$(st INPUTS_PREVIOUS="$empty" INPUTS_ANSWER='')"
eq "$r" "$empty" "no pause asked: the answer is the first call's result"
# trace.ts: the build's events on the comment.
use_stub_gh
tart="$(mk_tmp)"
tr() { env ARTIFACTS_DIR="$tart" WORKFLOW_ID=build-run INPUTS_ISSUE=42 "$@" bun "$SHARED/trace.ts" 2>&1; }
state() { bun -e "const b=JSON.parse(require('fs').readFileSync('$GH_STUB_DIR/comments-42.json','utf8'))[0].body; console.log(JSON.stringify(JSON.parse(b.match(/devflow-state: (.*) -->/)[1]).build))"; }
eq "$(env ARTIFACTS_DIR="$tart" INPUTS_ISSUE= INPUTS_EVENT=building bun "$SHARED/trace.ts")" '{"ok":true,"skipped":true,"url":""}' "no issue: nothing to do"
eq "$(gh_calls .)" "0" "no issue: no gh call"
tr INPUTS_EVENT=building INPUTS_BRANCH=feat/issue-42-x >/dev/null
eq "$(state)" '{"state":"building","run":"build-run","branch":"feat/issue-42-x"}' "building: run and branch (pr null is no key)"
tr INPUTS_EVENT=pr_open INPUTS_PR_NUMBER=57 INPUTS_PR_URL=https://github.com/o/r/pull/57 >/dev/null
eq "$(state)" '{"state":"pr_open","run":"build-run","branch":"feat/issue-42-x","pr":{"number":57,"url":"https://github.com/o/r/pull/57"}}' "pr_open: the PR"
tr INPUTS_EVENT=finished INPUTS_PR_NUMBER=57 INPUTS_PR_URL=https://github.com/o/r/pull/57 INPUTS_STATE=MERGED >/dev/null
contains "$(state)" '"state":"merged"' "finished MERGED: merged"
tr INPUTS_EVENT=finished INPUTS_PR_NUMBER=57 INPUTS_PR_URL=https://github.com/o/r/pull/57 INPUTS_STATE=CLOSED >/dev/null
contains "$(state)" '"state":"closed"' "finished otherwise: closed"
eq "$(gh_calls '^POST ')" "1" "the build edits the one comment"
touch "$GH_STUB_DIR/fail-api"
out="$(tr INPUTS_EVENT=building)"; code=$?
eq "$code" "0" "a failed comment write never fails the build"
contains "$out" '{"ok":false,"skipped":false,"url":""}' "it reports ok false"
contains "$(cat "$tart/trace-error.md")" "The devflow comment of issue #42 was not updated" "trace-error.md says why"
finish
