#!/usr/bin/env bash
# Tests packs/devflow/.shared/render-run.ts (the generated build-issue-<n> workflow), the plan block's
# render, test-plan and check-plan scripts, and load-plan.ts. The rendered workflows are validated by
# `archon validate` in a scratch git repo.
set -euo pipefail

# Hermetic: a caller (a workflow run) may export INPUTS_* that the scripts under test read.
while IFS= read -r v; do unset "$v"; done < <(compgen -e | grep "^INPUTS_" || true)

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
fx="$repo_root/scripts/fixtures/render-run"
render="$repo_root/packs/devflow/.shared/render-run.ts"
loader="$repo_root/packs/devflow/.shared/load-plan.ts"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
git_c=(git -c user.name=test -c user.email=test@example.invalid)
# rend <plan.md> <issue> [flags...]: the CLI with the flags every call needs.
rend() {
  local plan="$1" issue="$2"; shift 2
  bun "$render" "$plan" --issue "$issue" --design-revision 1 --plan-revision 1 --repo o/r --title "T" --main main --pack test/devflow "$@"
}

# a. render
bun "$render" "$fx/three-wide.md" --issue 3 --design-revision 2 --plan-revision 1 --repo o/r --title "Three wide" \
  --main main --pack test/devflow --after "$fx/after.md" --before "$fx/before.md" > "$scratch/three-wide.yaml"
rend "$fx/serial.md" 2 --title "Serial" --before "$fx/before.md" > "$scratch/serial.yaml"

# b. archon validate accepts both
repo="$scratch/repo"
mkdir -p "$repo/.archon/workflows"
git -C "$repo" init -q -b main
cp "$scratch/three-wide.yaml" "$repo/.archon/workflows/build-issue-3.yaml"
cp "$scratch/serial.yaml" "$repo/.archon/workflows/build-issue-2.yaml"
git -C "$repo" add -A
"${git_c[@]}" -C "$repo" commit -qm "rendered"
for n in 3 2; do
  (cd "$repo" && archon validate workflows "build-issue-$n" --json > "$scratch/validate-$n.json") \
    || { cat "$scratch/validate-$n.json"; echo "archon validate rejected build-issue-$n" >&2; exit 1; }
  echo "validate build-issue-$n: ok"
done

# c. structure
bun -e '
const [wide, serial] = process.argv.slice(1).map((f) => Bun.YAML.parse(require("node:fs").readFileSync(f, "utf8")) as any);
const eq = (a: unknown, b: unknown, what: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); process.exit(1); } };
const has = (s: string, part: string, what: string) => { if (!s.includes(part)) { console.error(`FAIL ${what}: no ${JSON.stringify(part)} in ${JSON.stringify(s)}`); process.exit(1); } };
const ids = (d: any) => d.nodes.map((n: any) => n.id);
const node = (d: any, id: string) => d.nodes.find((n: any) => n.id === id);
eq(wide.name, "build-issue-3", "three-wide name");
eq(serial.name, "build-issue-2", "serial name");
eq(ids(wide).sort(), ["phase-p1","phase-p2","phase-p3","phase-p4","phase-p5","start","trace-start","merge-1","merge-2","deliver","result","prerequisites","stop-at-prerequisites","after-steps","worktree-check","confirm-worktree-removal","stop-at-worktrees","remove-worktrees"].sort(), "three-wide node ids");
for (const p of ["p1","p2","p3"]) eq(node(wide, `phase-${p}`).depends_on, ["start"], `phase-${p} deps`);
for (const p of ["p4","p5"]) eq(node(wide, `phase-${p}`).depends_on, ["merge-1"], `phase-${p} deps`);
for (const p of ["p1","p2","p3","p4","p5"]) eq(node(wide, `phase-${p}`).isolation, "worktree", `phase-${p} isolation`);
eq(node(wide,"phase-p1").workflow, "test/devflow:mod-devflow-phase", "phase workflow");
eq(node(wide,"phase-p1").with.plan_path, "plans/plans/issue-3/plan.md", "phase plan path");
eq(node(wide,"deliver").workflow, "test/devflow:mod-devflow-deliver", "deliver workflow");
eq(node(wide,"deliver").with.issue, "3", "deliver issue");
eq(node(wide,"deliver").with.slug, "issue-3", "deliver slug");
eq(node(wide,"deliver").with.branch, "feat/three-wide", "deliver branch from the manifest");
eq(node(wide,"trace-start").workflow, "test/devflow:mod-devflow-trace", "trace-start workflow");
eq(node(wide,"trace-start").depends_on, ["start"], "trace-start after start");
eq(node(wide,"trace-start").with, { issue: "3", event: "building", branch: "feat/three-wide" }, "trace-start inputs");
eq(wide.returns, "result", "returns");
eq(ids(wide).includes("merge-3"), false, "no merge-3");
has(node(wide, "merge-1").bash, "Merge issue-3 p1: it’s ＄x", "title replacement");
has(node(wide, "merge-1").bash, "Plan-Phase: issue-3/p1", "merge trailer");
has(node(wide, "prerequisites").wait.attention, "plans/plans/issue-3/before.md on the plans branch", "prerequisites name before.md");
has(wide.description, "#3 (https://github.com/o/r/issues/3)", "description names the issue");
has(wide.description, "design r2, plan r1", "description names the revisions");
has(wide.description, "plans/plans/issue-3/plan.md on the plans branch", "description names the plan path");
// serial has a before.md but no manual_before and no manual_after: no prerequisites, no after-steps.
eq(ids(serial).sort(), ["phase-p1","phase-p2","start","trace-start","merge-1","merge-2","deliver","result","worktree-check","confirm-worktree-removal","stop-at-worktrees","remove-worktrees"].sort(), "serial node ids");
for (const d of [wide, serial]) if (JSON.stringify(d).includes("devflow-run")) { console.error("FAIL a rendered workflow names devflow-run"); process.exit(1); }
' "$scratch/three-wide.yaml" "$scratch/serial.yaml"
echo "structure: ok"

# d. a cycle is an error
if rend "$fx/cycle.md" 6 >/dev/null 2>"$scratch/cycle.err"; then
  echo "cycle.md rendered without error" >&2; exit 1
fi
grep -q "dependency cycle" "$scratch/cycle.err"
echo "cycle: ok"

# d2. a phase id that is not kebab-case, an issue that is not a number, and a plan_slug of another issue are errors
if rend "$fx/bad-id.md" 4 >/dev/null 2>"$scratch/badid.err"; then
  echo "bad-id.md rendered without error" >&2; exit 1
fi
grep -q "invalid phase id" "$scratch/badid.err"
if rend "$fx/serial.md" "2'x" >/dev/null 2>"$scratch/badissue.err"; then
  echo "a bad issue rendered without error" >&2; exit 1
fi
grep -q "invalid issue" "$scratch/badissue.err"
if rend "$fx/serial.md" 5 >/dev/null 2>"$scratch/otherissue.err"; then
  echo "another issue's plan rendered without error" >&2; exit 1
fi
grep -q "the manifest's plan_slug 'issue-2' must be 'issue-5'" "$scratch/otherissue.err"
if bun "$render" "$fx/serial.md" --issue 2 --title T --main main --pack test/devflow >/dev/null 2>"$scratch/flags.err"; then
  echo "missing flags rendered without error" >&2; exit 1
fi
grep -q "missing --design-revision" "$scratch/flags.err"
echo "bad-id: ok"

# d3. render-run, the plan block's node script: plan errors are output, environment errors fail
rr="$repo_root/packs/devflow/mod-devflow-plan-block/scripts/render-run.ts"
(
  real_archon="$(command -v archon)"
  mkdir -p "$scratch/rstub"
  cat > "$scratch/rstub/archon" <<STUB
#!/bin/sh
if [ "\$1 \$2 \$3" = "workflow list --json" ]; then printf '%s\n' "\$STUB_LIST"; exit 0; fi
if [ "\$1 \$2" = "workflow get" ]; then if [ -n "\${STUB_GET_FAIL-}" ]; then echo "boom" >&2; exit 1; fi; printf '%s\\n' "\$STUB_GET"; exit 0; fi
exec "$real_archon" "\$@"
STUB
  printf '#!/bin/sh\necho o/r\n' > "$scratch/rstub/gh"
  chmod +x "$scratch/rstub/archon" "$scratch/rstub/gh"
  rart="$scratch/rart"
  mkdir -p "$rart"
  cp "$fx/serial.md" "$rart/plan.md"
  mods() { local p="$1"; printf '{"name":"%s:mod-devflow-phase"},{"name":"%s:mod-devflow-deliver"},{"name":"%s:mod-devflow-trace"},{"name":"%s:devflow-plan"}' "$p" "$p" "$p" "$p"; }
  list_ok="{\"workflows\":[$(mods test/devflow)]}"
  list_bad='{"workflows":[{"name":"test/devflow:devflow-plan"},{"name":"test/devflow:mod-devflow-phase"},{"name":"test/devflow:mod-devflow-deliver"}]}'
  list_two="{\"workflows\":[$(mods test/devflow),$(mods other/devflow)]}"
  rr_run() {
    PATH="$scratch/rstub:$PATH" STUB_LIST="$1" WORKFLOW_ID="${RR_WORKFLOW_ID-wf-test}" STUB_GET="${STUB_GET-}" ARTIFACTS_DIR="$rart" \
      INPUTS_ISSUE="$2" INPUTS_BRANCH="${RR_BRANCH:-feat/serial}" INPUTS_EXISTING_BRANCH="${RR_EXISTING-}" INPUTS_TITLE=S \
      INPUTS_DESIGN_REVISION=1 INPUTS_PLAN_REVISION_BASE=0 INPUTS_MAIN_BRANCH=main INPUTS_BRANCH_REGEX='^feat/[a-z0-9]+(-[a-z0-9]+)*$' \
      INPUTS_PLANS_REF=plans INPUTS_PLANS_DIR=plans INPUTS_PACK="${3-test/devflow}" INPUTS_SOFT_ERRORS=true bun "$rr"
  }
  cd "$repo"
  out="$(rr_run "$list_ok" 2)"
  echo "$out" | grep -q '"ok":true'
  echo "$out" | grep -q '"workflow":"build-issue-2"'
  test -f "$rart/build-issue-2.yaml"
  # the published plan is r0 (none): the rendered workflow is plan r1, the revision check-plan stamps
  grep -q 'design r1, plan r1, planned by run' "$rart/build-issue-2.yaml"
  out="$(rr_run "$list_ok" 9)"
  echo "$out" | grep -q '"ok":false'
  echo "$out" | grep -q "plan_slug 'issue-2' must be 'issue-9'"
  out="$(RR_BRANCH=feat/other rr_run "$list_ok" 2)"
  echo "$out" | grep -q "differs from the branch 'feat/other'"
  out="$(RR_EXISTING=feat/kept rr_run "$list_ok" 2)"
  echo "$out" | grep -q "a re-plan keeps the branch"
  if rr_run "$list_bad" 2 >/dev/null 2>"$scratch/rr.err"; then echo "missing mod-devflow-trace was accepted" >&2; exit 1; fi
  grep -q 'has no test/devflow:mod-devflow-trace' "$scratch/rr.err"
  # pack default: the pack this run was started from
  rm -f "$rart/build-issue-2.yaml"
  out="$(STUB_GET='{"workflow_name":"test/devflow:devflow-plan"}' rr_run "$list_ok" 2 "")"
  echo "$out" | grep -q '"ok":true'
  grep -q 'test/devflow:mod-devflow-phase' "$rart/build-issue-2.yaml"
  rm -f "$rart/build-issue-2.yaml"
  out="$(STUB_GET='{"workflow_name":"test/devflow:devflow-refine"}' rr_run "$list_two" 2 "")"
  echo "$out" | grep -q '"ok":true'
  grep -q 'test/devflow:' "$rart/build-issue-2.yaml"
  if grep -q 'other/devflow:' "$rart/build-issue-2.yaml"; then echo "wrong pack rendered" >&2; exit 1; fi
  if STUB_GET='{"workflow_name":"devflow-plan"}' rr_run "$list_ok" 2 "" >/dev/null 2>"$scratch/rr.err"; then echo "local workflow accepted" >&2; exit 1; fi
  grep -q 'is not from an installed pack' "$scratch/rr.err"
  rm -f "$rart/build-issue-2.yaml"
  out="$(STUB_GET='{"workflow_name":"other/devflow:devflow-plan"}' rr_run "$list_two" 2 test/devflow)"
  echo "$out" | grep -q '"ok":true'
  grep -q 'test/devflow:' "$rart/build-issue-2.yaml"
  if grep -q 'other/devflow:' "$rart/build-issue-2.yaml"; then echo "input did not win" >&2; exit 1; fi
  if RR_WORKFLOW_ID= rr_run "$list_ok" 2 "" >/dev/null 2>"$scratch/rr.err"; then echo "unset WORKFLOW_ID accepted" >&2; exit 1; fi
  grep -q 'WORKFLOW_ID is not set' "$scratch/rr.err"
  if STUB_GET_FAIL=1 rr_run "$list_ok" 2 "" >/dev/null 2>"$scratch/rr.err"; then echo "failing workflow get accepted" >&2; exit 1; fi
  grep -q 'workflow get wf-test --json` failed' "$scratch/rr.err"
  echo "render-run node: ok"
)

# d4. test-plan.ts
tp="$repo_root/packs/devflow/mod-devflow-plan-block/scripts/test-plan.ts"
(
  mkdir -p "$scratch/fakeflow" "$scratch/tpart"
  cat > "$scratch/fakeflow/validate-manifest.py" <<'PY'
import os, sys
code = int(os.environ.get("VM_EXIT", "0"))
if code:
    print("ERROR: stub")
sys.exit(code)
PY
  cp "$fx/serial.md" "$scratch/tpart/plan.md"
  rend "$fx/serial.md" 2 > "$scratch/t-serial.yaml"
  cd "$repo"
  tp_run() { ARTIFACTS_DIR="$scratch/tpart" INPUTS_SHARED_DIR="$scratch/fakeflow" INPUTS_RENDER="$1" bun "$tp"; }
  good='{"ok":true,"error":"","workflow":"build-issue-2","file":"'$scratch'/t-serial.yaml","waves":2}'
  tp_run "$good" | grep -q '"ok":true'
  VM_EXIT=1 tp_run "$good" | grep -q '"source":"validate_manifest"'
  VM_EXIT=1 tp_run "$good" | grep -q '"ok":false'
  tp_run '{"ok":false,"error":"x differs from the slug","workflow":"","file":"","waves":0}' | grep -q '"source":"render"'
  bun -e '
const fs = require("node:fs");
const [src, dst] = process.argv.slice(1);
const d: any = Bun.YAML.parse(fs.readFileSync(src, "utf8"));
d.nodes = d.nodes.filter((n: any) => n.id !== "result");
delete d.returns;
delete d.outcome_field;
fs.writeFileSync(dst, Bun.YAML.stringify(d));
' "$scratch/t-serial.yaml" "$scratch/t-broken.yaml"
  broken='{"ok":true,"error":"","workflow":"build-issue-2","file":"'$scratch'/t-broken.yaml","waves":2}'
  if tp_run "$broken" >/dev/null 2>"$scratch/tp.err"; then echo "a broken rendered workflow passed the dry run" >&2; exit 1; fi
  grep -q 'does not complete a dry run' "$scratch/tp.err"
  echo "test-plan: ok"
)


# d5. check-plan.ts: stamps the drafted files, validates them with the design, decides the round
cp_script="$repo_root/packs/devflow/mod-devflow-plan-block/scripts/check-plan.ts"
(
  docs="$repo_root/scripts/fixtures/docs/valid"
  chk="$scratch/chk"
  body() { awk 'f>=2{print} /^---$/{f++}' "$1" | sed '1{/^$/d}'; }
  reset() {
    rm -rf "$chk"; mkdir -p "$chk"
    cp "$docs/design.md" "$chk/design.md"
    for k in plan plan-test before after; do body "$docs/$k.md" > "$chk/$k.md"; done
  }
  draft='{"scope":"small","title":"Export reports as CSV","branch":"feat/issue-7-csv-export","before":false,"after":true,"needs_refine_present":false,"needs_refine_question":"","needs_refine_why":""}'
  res='{"issue":7,"plan_revision":0}'
  ld='{"design_revision":1,"refusal":""}'
  ren='{"ok":true,"error":"","workflow":"build-issue-7","file":"/x","waves":3}'
  tst='{"ok":true,"findings":[]}'
  rev='{"findings":[{"id":"R1","source":"review","kind":"mechanical","phase":"p1-export","problem":"p","fix":"f"}]}'
  cp_run() {
    (cd "$scratch" && ARTIFACTS_DIR="$chk" WORKFLOW_ID=run-7 INPUTS_DRAFT="${DRAFT:-$draft}" INPUTS_RESOLVE="$res" INPUTS_LOAD_DESIGN="$ld" \
      INPUTS_RENDER="$ren" INPUTS_TEST="$tst" INPUTS_REVIEW="$1" INPUTS_ROUND="$2" bun "$cp_script")
  }
  reset
  out="$(cp_run "" "")"
  echo "$out" | grep -q '"done":true'
  echo "$out" | grep -q '"needs_refine_present":false'
  grep -q '"workflow":"build-issue-7"' "$chk/tested.json"
  grep -q '"issue":7,"revision":1,' "$chk/tested.json"
  head -8 "$chk/final/plan.md" | grep -q '^revision: 1$'
  test ! -e "$chk/test-findings.md" && test ! -e "$chk/validation.json"
  head -8 "$chk/final/plan.md" | grep -q '^design_revision: 1$'
  head -8 "$chk/final/plan-test.md" | grep -q '^kind: plan-test$'
  out="$(cp_run "$rev" "")"
  echo "$out" | grep -q '"done":false'
  echo "$out" | grep -q '"round":1'
  grep -q '## F1. \[review, mechanical\]' "$chk/test-findings.md"
  out="$(cp_run "$rev" 2)"
  echo "$out" | grep -q '"done":true'
  grep -q '"unresolved":1' "$chk/tested.json"
  grep -q '### Unresolved validation findings' "$chk/unresolved.md"
  grep -qF -- '- F1 [review, mechanical] p1-export: p' "$chk/unresolved.md"
  # The review's text is quoted into plan.md, so its template leftovers and links are made harmless.
  todo='{"findings":[{"id":"R1","source":"review","kind":"mechanical","phase":"p1-export","problem":"TODO in {{x}}, TBD, see [x](src/y.ts)","fix":"f"}]}'
  cp_run "$todo" 2 >/dev/null
  grep -qF -- 'p1-export: todo in { {x}}, tbd, see [x] (src/y.ts)' "$chk/unresolved.md"
  (cd "$scratch" && bun -e '
    import { markUnresolved } from "'"$repo_root"'/packs/devflow/.shared/publish-plan.ts";
    import { readFileSync, writeFileSync } from "node:fs";
    const f = process.argv[1] + "/final/plan.md";
    writeFileSync(f, markUnresolved(readFileSync(f, "utf8"), readFileSync(process.argv[1] + "/unresolved.md", "utf8")).text);
  ' "$chk")
  grep -qF '> [!WARNING]' "$chk/final/plan.md"
  bun "$repo_root/packs/devflow/.shared/validate-docs.ts" --issue 7 --dir "$chk/final" --kinds plan >/dev/null
  # A drafted file that breaks the scheme is a finding the next round fixes, listed in validation.json.
  reset
  sed -i '/^- r1 (2026-11-06, run run-7): first test plan$/d' "$chk/plan-test.md"
  out="$(cp_run "" "")"
  echo "$out" | grep -q '"done":false'
  grep -q '"rule": "V5"' "$chk/validation.json"
  grep -q 'validate_docs, mechanical' "$chk/test-findings.md"
  if cp_run "" 2 >/dev/null 2>"$scratch/cp.err"; then echo "an invalid plan-test.md at the last round did not fail" >&2; exit 1; fi
  grep -q 'nothing was published' "$scratch/cp.err"
  grep -q 'plan-test.md:.* \[V5\]' "$scratch/cp.err"
  reset
  vm='{"ok":false,"findings":[{"id":"T1","source":"validate_manifest","kind":"mechanical","phase":"","problem":"bad","fix":"f"}]}'
  if tst="$vm" cp_run "" 2 >/dev/null 2>"$scratch/cp.err"; then echo "round 3 with a manifest finding did not fail" >&2; exit 1; fi
  grep -q 'after 2 fix rounds' "$scratch/cp.err"
  # needs_refine ends the loop at once and validates nothing.
  rm -rf "$chk"; mkdir -p "$chk"; echo '{}' > "$chk/tested.json"
  out="$(DRAFT='{"scope":"small","title":"","branch":"","before":false,"after":false,"needs_refine_present":true,"needs_refine_question":"Which dialect?","needs_refine_why":"no doc"}' cp_run "" "")"
  echo "$out" | grep -q '"done":true'
  echo "$out" | grep -q '"needs_refine_present":true'
  echo "$out" | grep -q '"needs_refine_question":"Which dialect?"'
  test ! -e "$chk/tested.json" && test ! -e "$chk/final"
  echo "check-plan: ok"
)

# d6. model keys are required
for spec in '5|bad-model|phase '"'"'p2'"'"': model must be small, medium or large (got "haiku")' \
            '8|no-reason|phase '"'"'p2'"'"': model medium needs a model_reason' \
            '9|no-review-model|review_model must be medium or large (got nothing)'; do
  issue="${spec%%|*}"; rest="${spec#*|}"; name="${rest%%|*}"; want="${rest#*|}"
  if bun "$render" "$fx/$name.md" --issue "$issue" --design-revision 1 --plan-revision 1 --repo o/r --title M --main main --pack test/devflow >/dev/null 2>"$scratch/$name.err"; then
    echo "$name.md rendered without error" >&2; exit 1
  fi
  grep -qF "$want" "$scratch/$name.err" || { echo "$name: expected '$want', got:" >&2; cat "$scratch/$name.err" >&2; exit 1; }
done
echo "models: ok"


# e. load-plan against a local bare origin
origin="$scratch/origin.git"
clone="$scratch/clone"
git init -q --bare -b main "$origin"
git clone -q "$origin" "$clone" 2>/dev/null
cd "$clone"
mkdir -p .devflow
cp "$repo_root/.devflow/devflow.yaml" .devflow/devflow.yaml
echo base > f.txt
git add -A
"${git_c[@]}" commit -qm base
git push -q origin main
main_sha="$(git rev-parse HEAD)"
git switch -q -c plans
mkdir -p plans/plans/issue-2
cp "$fx/serial.md" plans/plans/issue-2/plan.md
git add -A
"${git_c[@]}" commit -qm "plan"
git push -q origin plans
git switch -q main

export ARTIFACTS_DIR="$scratch/art"
mkdir -p "$ARTIFACTS_DIR"
lp() { INPUTS_PLAN_REF=plans INPUTS_PLAN_PATH=plans/plans/issue-2/plan.md INPUTS_SHARED_DIR=/x "$@" bun "$loader"; }

out="$(INPUTS_MODE=phase INPUTS_PHASE=p1 INPUTS_BASE="$main_sha" lp env)"
echo "$out" | grep -q '"done":false'
echo "$out" | grep -q '"model":"small"'
echo "$out" | grep -q '"review_model":"medium"'
test -f "$ARTIFACTS_DIR/plan.md" && test -f "$ARTIFACTS_DIR/context.json"
echo "load-plan phase (not done): ok"

"${git_c[@]}" commit -q --allow-empty -m "Phase one" -m "Plan-Phase: issue-2/p1"
done_sha="$(git rev-parse HEAD)"
out="$(INPUTS_MODE=phase INPUTS_PHASE=p1 INPUTS_BASE="$done_sha" lp env)"
echo "$out" | grep -q '"done":true'
echo "load-plan phase (done): ok"

git switch -q -c feat/serial
INPUTS_MODE=deliver lp env >/dev/null
INPUTS_MODE=deliver lp env | grep -q '"model":""'
git switch -q -c feat/other
if INPUTS_MODE=deliver lp env >/dev/null 2>&1; then echo "deliver on the wrong branch succeeded" >&2; exit 1; fi
echo "load-plan deliver: ok"
# h. pick-one
pick="$repo_root/packs/devflow/.shared/pick-one.ts"
test "$(INPUTS_MEDIUM='{"a":1}' bun "$pick")" = '{"a":1}'
if bun "$pick" >/dev/null 2>"$scratch/pick.err"; then echo "pick-one with no input succeeded" >&2; exit 1; fi
grep -qF 'got 0 (none)' "$scratch/pick.err"
if INPUTS_SMALL=x INPUTS_LARGE=y bun "$pick" >/dev/null 2>"$scratch/pick.err"; then echo "pick-one with two inputs succeeded" >&2; exit 1; fi
grep -qF 'got 2 (small, large)' "$scratch/pick.err"
echo "pick-one: ok"
echo "test-render-run: all ok"
