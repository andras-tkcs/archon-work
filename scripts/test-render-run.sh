#!/usr/bin/env bash
# Tests packs/devflow/.shared/render-run.ts (the generated devflow-run-<slug> workflow) and
# load-plan.ts. The rendered workflows are validated by `archon validate` in a scratch git repo.
set -euo pipefail

# Hermetic: an INPUTS_* variable from the calling workflow (e.g. INPUTS_PLAN_COMMIT) must not leak into the loaders.
while IFS= read -r v; do unset "$v"; done < <(compgen -e | grep "^INPUTS_" || true)

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
fx="$repo_root/scripts/fixtures/render-run"
render="$repo_root/packs/devflow/.shared/render-run.ts"
loader="$repo_root/packs/devflow/.shared/load-plan.ts"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
# Hermetic: a caller (a workflow run) may export INPUTS_* that the scripts under test read.
for v in $(compgen -e | grep '^INPUTS_' || true); do unset "$v"; done
git_c=(git -c user.name=test -c user.email=test@example.invalid)

# a. render
bun "$render" "$fx/three-wide.md" --slug three-wide --branch feat/three-wide --title "Three wide" \
  --main main --pack test/devflow --after "$fx/after.md" --prerequisites "$fx/prereq.md" > "$scratch/three-wide.yaml"
bun "$render" "$fx/serial.md" --slug serial --branch feat/serial --title "Serial" \
  --main main --pack test/devflow > "$scratch/serial.yaml"

# b. archon validate accepts both
repo="$scratch/repo"
mkdir -p "$repo/.archon/workflows"
git -C "$repo" init -q -b main
cp "$scratch/three-wide.yaml" "$repo/.archon/workflows/devflow-run-three-wide.yaml"
cp "$scratch/serial.yaml" "$repo/.archon/workflows/devflow-run-serial.yaml"
git -C "$repo" add -A
"${git_c[@]}" -C "$repo" commit -qm "rendered"
for s in three-wide serial; do
  (cd "$repo" && archon validate workflows "devflow-run-$s" --json > "$scratch/validate-$s.json") \
    || { cat "$scratch/validate-$s.json"; echo "archon validate rejected devflow-run-$s" >&2; exit 1; }
  echo "validate devflow-run-$s: ok"
done

# c. structure
bun -e '
const [wide, serial] = process.argv.slice(1).map((f) => Bun.YAML.parse(require("node:fs").readFileSync(f, "utf8")) as any);
const eq = (a: unknown, b: unknown, what: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); process.exit(1); } };
const ids = (d: any) => d.nodes.map((n: any) => n.id);
const node = (d: any, id: string) => d.nodes.find((n: any) => n.id === id);
eq(ids(wide).sort(), ["phase-p1","phase-p2","phase-p3","phase-p4","phase-p5","start","merge-1","merge-2","deliver","result","prerequisites","stop-at-prerequisites","after-steps","worktree-check","confirm-worktree-removal","stop-at-worktrees","remove-worktrees"].sort(), "three-wide node ids");
for (const p of ["p1","p2","p3"]) eq(node(wide, `phase-${p}`).depends_on, ["start"], `phase-${p} deps`);
for (const p of ["p4","p5"]) eq(node(wide, `phase-${p}`).depends_on, ["merge-1"], `phase-${p} deps`);
for (const p of ["p1","p2","p3","p4","p5"]) eq(node(wide, `phase-${p}`).isolation, "worktree", `phase-${p} isolation`);
eq(node(wide,"phase-p1").workflow, "test/devflow:mod-devflow-phase", "phase workflow");
eq(node(wide,"deliver").workflow, "test/devflow:mod-devflow-deliver", "deliver workflow");
eq(wide.returns, "result", "returns");
eq(ids(wide).includes("merge-3"), false, "no merge-3");
if (!node(wide, "merge-1").bash.includes("Merge three-wide p1: it’s ＄x")) { console.error("FAIL title replacement"); process.exit(1); }
eq(ids(serial).sort(), ["phase-p1","phase-p2","start","merge-1","merge-2","deliver","result","worktree-check","confirm-worktree-removal","stop-at-worktrees","remove-worktrees"].sort(), "serial node ids");
' "$scratch/three-wide.yaml" "$scratch/serial.yaml"
echo "structure: ok"

# d. a cycle is an error
if bun "$render" "$fx/cycle.md" --slug cyc --branch feat/cyc --title C --main main --pack test/devflow >/dev/null 2>"$scratch/cycle.err"; then
  echo "cycle.md rendered without error" >&2; exit 1
fi
grep -q "dependency cycle" "$scratch/cycle.err"
echo "cycle: ok"

# d2. a phase id or slug that is not kebab-case is an error
if bun "$render" "$fx/bad-id.md" --slug bad --branch feat/bad --title B --main main --pack test/devflow >/dev/null 2>"$scratch/badid.err"; then
  echo "bad-id.md rendered without error" >&2; exit 1
fi
grep -q "invalid phase id" "$scratch/badid.err"
if bun "$render" "$fx/serial.md" --slug "x'y" --branch feat/bad --title B --main main --pack test/devflow >/dev/null 2>"$scratch/badslug.err"; then
  echo "bad slug rendered without error" >&2; exit 1
fi
grep -q "invalid slug" "$scratch/badslug.err"
echo "bad-id: ok"

# d3. render-run.ts, the devflow-plan node script: plan errors are output, environment errors fail
rr="$repo_root/packs/devflow/devflow-plan/scripts/render-run.ts"
(
  real_archon="$(command -v archon)"
  mkdir -p "$scratch/rstub"
  cat > "$scratch/rstub/archon" <<STUB
#!/bin/sh
if [ "\$1 \$2 \$3" = "workflow list --json" ]; then printf '%s\n' "\$STUB_LIST"; exit 0; fi
exec "$real_archon" "\$@"
STUB
  chmod +x "$scratch/rstub/archon"
  rart="$scratch/rart"
  mkdir -p "$rart"
  cp "$fx/serial.md" "$rart/plan.md"
  list_ok='{"workflows":[{"name":"test/devflow:devflow-plan"},{"name":"test/devflow:mod-devflow-phase"},{"name":"test/devflow:mod-devflow-deliver"}]}'
  list_bad='{"workflows":[{"name":"test/devflow:devflow-plan"},{"name":"test/devflow:mod-devflow-phase"}]}'
  rr_run() {
    PATH="$scratch/rstub:$PATH" STUB_LIST="$1" ARTIFACTS_DIR="$rart" INPUTS_SLUG="$2" INPUTS_BRANCH=feat/serial INPUTS_TITLE=S \
      INPUTS_MAIN_BRANCH=main INPUTS_BRANCH_REGEX='^feat/[a-z0-9]+(-[a-z0-9]+)*$' INPUTS_PLANS_REF=plans \
      INPUTS_PLANS_DIR=plans INPUTS_PACK=test/devflow INPUTS_SOFT_ERRORS=true bun "$rr"
  }
  cd "$repo"
  out="$(rr_run "$list_ok" serial)"
  echo "$out" | grep -q '"ok":true'
  test -f "$rart/devflow-run-serial.yaml"
  out="$(rr_run "$list_ok" other)"
  echo "$out" | grep -q '"ok":false'
  echo "$out" | grep -q 'differs from the slug'
  if rr_run "$list_bad" serial >/dev/null 2>"$scratch/rr.err"; then echo "missing mod-devflow-deliver was accepted" >&2; exit 1; fi
  grep -q 'has no test/devflow:mod-devflow-deliver' "$scratch/rr.err"
  echo "render-run node: ok"
)

# d4. test-plan.ts
tp="$repo_root/packs/devflow/devflow-plan/scripts/test-plan.ts"
(
  mkdir -p "$scratch/fakeflow/scripts" "$scratch/tpart"
  cat > "$scratch/fakeflow/scripts/validate_manifest.py" <<'PY'
import os, sys
code = int(os.environ.get("VM_EXIT", "0"))
if code:
    print("ERROR: stub")
sys.exit(code)
PY
  cp "$fx/serial.md" "$scratch/tpart/plan.md"
  bun "$render" "$fx/serial.md" --slug serial --branch feat/serial --title "Serial" \
    --main main --pack test/devflow > "$scratch/t-serial.yaml"
  cd "$repo"
  tp_run() { ARTIFACTS_DIR="$scratch/tpart" INPUTS_DEVFLOW_ROOT="$scratch/fakeflow" INPUTS_RENDER="$1" bun "$tp"; }
  good='{"ok":true,"error":"","workflow":"devflow-run-serial","file":"'$scratch'/t-serial.yaml","waves":2}'
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
  broken='{"ok":true,"error":"","workflow":"devflow-run-serial","file":"'$scratch'/t-broken.yaml","waves":2}'
  if tp_run "$broken" >/dev/null 2>"$scratch/tp.err"; then echo "a broken rendered workflow passed the dry run" >&2; exit 1; fi
  grep -q 'does not complete a dry run' "$scratch/tp.err"
  echo "test-plan: ok"
)

# d5. check-plan.ts
cp_script="$repo_root/packs/devflow/devflow-plan/scripts/check-plan.ts"
(
  chk="$scratch/chk"
  mkdir -p "$chk"
  fin='{"scope":"large","slug":"s","branch":"feat/s","title":"S","prerequisites":false,"after":false}'
  ren='{"ok":true,"error":"","workflow":"devflow-run-s","file":"/x","waves":1}'
  tst='{"ok":true,"findings":[]}'
  rev='{"findings":[{"id":"R1","source":"review","kind":"mechanical","phase":"p1","problem":"p","fix":"f"}]}'
  cp_run() { ARTIFACTS_DIR="$chk" INPUTS_FINALIZE="$fin" INPUTS_RENDER="$ren" INPUTS_TEST="$tst" INPUTS_REVIEW="$1" INPUTS_ROUND="$2" bun "$cp_script"; }
  cp_run "" "" | grep -q '"done":true'
  grep -q '"workflow":"devflow-run-s"' "$chk/tested.json"
  test ! -e "$chk/test-findings.md"
  out="$(cp_run "$rev" "")"
  echo "$out" | grep -q '"done":false'
  echo "$out" | grep -q '"round":1'
  grep -q '## F1. \[review, mechanical\]' "$chk/test-findings.md"
  if cp_run "$rev" 2 >/dev/null 2>"$scratch/cp.err"; then echo "round 3 with findings did not fail" >&2; exit 1; fi
  grep -q 'after 2 fix rounds' "$scratch/cp.err"
  echo "check-plan: ok"
)

# e. load-plan against a local bare origin
origin="$scratch/origin.git"
clone="$scratch/clone"
git init -q --bare -b main "$origin"
git clone -q "$origin" "$clone" 2>/dev/null
cd "$clone"
mkdir -p .claude
cp "$repo_root/.claude/toolkit.yaml" .claude/toolkit.yaml
echo base > f.txt
git add -A
"${git_c[@]}" commit -qm base
git push -q origin main
main_sha="$(git rev-parse HEAD)"
git switch -q -c plans
mkdir -p plans/s
cp "$fx/serial.md" plans/s/plan.md
git add -A
"${git_c[@]}" commit -qm "plan"
git push -q origin plans
git switch -q main

export ARTIFACTS_DIR="$scratch/art"
mkdir -p "$ARTIFACTS_DIR"
lp() { INPUTS_PLAN_REF=plans INPUTS_PLAN_PATH=plans/s/plan.md INPUTS_DEVFLOW_ROOT=/x "$@" bun "$loader"; }

out="$(INPUTS_MODE=phase INPUTS_PHASE=p1 INPUTS_BASE="$main_sha" lp env)"
echo "$out" | grep -q '"done":false'
test -f "$ARTIFACTS_DIR/plan.md" && test -f "$ARTIFACTS_DIR/context.json"
echo "load-plan phase (not done): ok"

"${git_c[@]}" commit -q --allow-empty -m "Phase one" -m "Plan-Phase: serial/p1"
done_sha="$(git rev-parse HEAD)"
out="$(INPUTS_MODE=phase INPUTS_PHASE=p1 INPUTS_BASE="$done_sha" lp env)"
echo "$out" | grep -q '"done":true'
echo "load-plan phase (done): ok"

git switch -q -c feat/serial
INPUTS_MODE=deliver lp env >/dev/null
git switch -q -c feat/other
if INPUTS_MODE=deliver lp env >/dev/null 2>&1; then echo "deliver on the wrong branch succeeded" >&2; exit 1; fi
echo "load-plan deliver: ok"
# f. publish-plan against a fresh bare origin: no plans branch yet, no .archon/config.yaml
publisher="$repo_root/packs/devflow/devflow-plan/scripts/publish-plan.ts"
porigin="$scratch/porigin.git"
pclone="$scratch/pclone"
git init -q --bare -b main "$porigin"
git clone -q "$porigin" "$pclone" 2>/dev/null
cd "$pclone"
echo base > f.txt
git add -A
"${git_c[@]}" commit -qm base
git push -q origin main
stubs="$scratch/stubs"
mkdir -p "$stubs"
printf '#!/bin/sh\necho test/repo\n' > "$stubs/gh"
printf '#!/bin/sh\ntouch "%s/archon-called"\n' "$scratch" > "$stubs/archon"
chmod +x "$stubs/gh" "$stubs/archon"
pub_art="$scratch/pub-art"
mkdir -p "$pub_art"
cp "$fx/serial.md" "$pub_art/plan.md"
echo "# After implementing S" > "$pub_art/after.md"
printf 'name: devflow-run-s\nnodes: []\n' > "$pub_art/devflow-run-s.yaml"
publish() {
  PATH="$stubs:$PATH" ARTIFACTS_DIR="$pub_art" WORKFLOW_ID=test INPUTS_SLUG="${PSLUG:-s}" INPUTS_TITLE=S \
    INPUTS_WORKFLOW="${PWF:-devflow-run-s}" INPUTS_PLANS_REF=plans INPUTS_PLANS_DIR=plans INPUTS_MAIN_BRANCH=main \
    bun "$publisher"
}
publish > "$scratch/publish1.json"
git -C "$porigin" show plans:plans/s/plan.md >/dev/null
git -C "$porigin" show plans:plans/s/after.md >/dev/null
git -C "$porigin" show plans:plans/workflows/devflow-run-s.yaml >/dev/null
test ! -e "$scratch/archon-called"
grep -q extraWorkflowSources "$pub_art/published.md"
grep -q 'assumptions: none' "$scratch/publish1.json"
test -z "$(git branch --list 'plans-*')"
test -z "$(git -C "$porigin" branch --list 'plans-*')"
n1="$(git -C "$porigin" rev-list --count plans)"
printf '\n## Assumptions\n\n- **A**: b.\n- **C**: d.\n' >> "$pub_art/plan.md"
publish > "$scratch/publish2.json"
grep -q 'assumptions: 2' "$scratch/publish2.json"
grep -q '\*\*A\*\*: b\.' "$pub_art/published.md"
n2="$(git -C "$porigin" rev-list --count plans)"
test "$((n2 - n1))" -eq 1
test "$(git -C "$porigin" log -1 --format=%s plans)" = "Plan s: S"
echo "# refined" >> "$pub_art/plan.md"
INPUTS_COMMIT_VERB=Refine publish > "$scratch/publish3.json"
test "$(git -C "$porigin" log -1 --format=%s plans)" = "Refine s: S"
if INPUTS_COMMIT_VERB=Bad publish >/dev/null 2>"$scratch/verb.err"; then echo "bad commit_verb succeeded" >&2; exit 1; fi
grep -q "invalid commit_verb" "$scratch/verb.err"
echo "publish-plan: ok"
if ARTIFACTS_DIR="$scratch" bun "$repo_root/packs/devflow/devflow-plan/scripts/render-run.ts" 2>"$scratch/rp.err"; then echo "render-run without inputs succeeded" >&2; exit 1; fi
grep -q "input 'slug' is empty" "$scratch/rp.err"
echo "render-run entry: ok"
# g. load-published against the bare origin of section f
loader2="$repo_root/packs/devflow/devflow-refine/scripts/load-published.ts"
cp "$fx/serial.md" "$pub_art/plan.md"
printf 'name: devflow-run-serial\nnodes: []\n' > "$pub_art/devflow-run-serial.yaml"
PSLUG=serial PWF=devflow-run-serial publish >/dev/null
cp "$fx/three-wide.md" "$pub_art/plan.md"
printf 'name: devflow-run-three-wide\nnodes: []\n' > "$pub_art/devflow-run-three-wide.yaml"
PSLUG=three-wide PWF=devflow-run-three-wide publish >/dev/null
mkdir -p "$scratch/stubs2"
printf '%s\n' '#!/bin/sh' 'case "$*" in *"pr list"*) echo "${GH_MERGED:-0}";; *) echo test/repo;; esac' > "$scratch/stubs2/gh"
chmod +x "$scratch/stubs2/gh"
mkdir -p "$scratch/lp2-art"
lp2() { PATH="$scratch/stubs2:$PATH" ARTIFACTS_DIR="$scratch/lp2-art" INPUTS_PLANS_REF=plans INPUTS_PLANS_DIR=plans INPUTS_MAIN_BRANCH=main "$@" bun "$loader2"; }
rm -rf "$scratch/lp2-art"/*
msg1="refine serial: split p2 into two"
out="$(lp2 env USER_MESSAGE="$msg1")"
echo "$out" | grep -q '"slug":"serial"'
echo "$out" | grep -q '"branch":"feat/serial"'
echo "$out" | grep -q '"started":false'
test -e "$scratch/lp2-art/original/plan.md"
test -e "$scratch/lp2-art/original/after.md"
out="$(lp2 env USER_MESSAGE="please refine https://github.com/test/repo/blob/plans/plans/three-wide/plan.md: add a phase")"
echo "$out" | grep -q '"slug":"three-wide"'
out="$(lp2 env USER_MESSAGE="refine plans/serial: add a phase")"
echo "$out" | grep -q '"slug":"serial"'
if lp2 env USER_MESSAGE="merge serial and three-wide plans" >/dev/null 2>"$scratch/lp2.err"; then echo "several plans succeeded" >&2; exit 1; fi
grep -q "names more than one plan (serial, three-wide)" "$scratch/lp2.err"
if lp2 env USER_MESSAGE="refine the plan please" >/dev/null 2>"$scratch/lp2.err"; then echo "no plan succeeded" >&2; exit 1; fi
grep -q "no plan named" "$scratch/lp2.err"
if lp2 env USER_MESSAGE="refine serial" >/dev/null 2>"$scratch/lp2.err"; then echo "no change succeeded" >&2; exit 1; fi
grep -q "say what to change in the plan serial" "$scratch/lp2.err"
out="$(lp2 env INPUTS_PLAN=three-wide USER_MESSAGE="refine serial: add a phase")"
echo "$out" | grep -q '"slug":"three-wide"'
if lp2 env INPUTS_PLAN=nope USER_MESSAGE="x" >/dev/null 2>"$scratch/lp2.err"; then echo "unknown plan succeeded" >&2; exit 1; fi
grep -q "no plan 'nope' on plans" "$scratch/lp2.err"
git push -q origin HEAD:refs/heads/feat/serial
out="$(lp2 env USER_MESSAGE="$msg1")"
echo "$out" | grep -q '"started":true'
echo "$out" | grep -q '"reason":"branch"'
echo "$out" | grep -q "is already being implemented"
if lp2 env INPUTS_CHECK_ONLY=true USER_MESSAGE="$msg1" >/dev/null 2>"$scratch/lp2.err"; then echo "check-only on a started plan succeeded" >&2; exit 1; fi
grep -q "Not refined: the plan serial is already being implemented" "$scratch/lp2.err"
git push -q origin :refs/heads/feat/serial
"${git_c[@]}" commit -q --allow-empty -m "Phase one" -m "Plan-Phase: serial/p1"
git push -q origin HEAD:main
out="$(lp2 env USER_MESSAGE="$msg1")"
echo "$out" | grep -q '"reason":"merged"'
out="$(lp2 env GH_MERGED=1 INPUTS_PLAN=three-wide USER_MESSAGE="add a phase")"
echo "$out" | grep -q '"reason":"merged"'
out="$(lp2 env GH_MERGED=0 INPUTS_CHECK_ONLY=true INPUTS_PLAN=three-wide USER_MESSAGE="add a phase")"
test "$out" = '{"ok":true}'
echo "load-published: ok"
echo "test-render-run: all ok"
