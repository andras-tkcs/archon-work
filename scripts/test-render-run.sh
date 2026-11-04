#!/usr/bin/env bash
# Tests packs/devflow/.shared/render-run.ts (the generated devflow-run-<slug> workflow) and
# load-plan.ts. The rendered workflows are validated by `archon validate` in a scratch git repo.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
fx="$repo_root/scripts/fixtures/render-run"
render="$repo_root/packs/devflow/.shared/render-run.ts"
loader="$repo_root/packs/devflow/.shared/load-plan.ts"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
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
eq(ids(wide).sort(), ["phase-p1","phase-p2","phase-p3","phase-p4","phase-p5","start","merge-1","merge-2","deliver","result","prerequisites","stop-at-prerequisites","after-steps"].sort(), "three-wide node ids");
for (const p of ["p1","p2","p3"]) eq(node(wide, `phase-${p}`).depends_on, ["start"], `phase-${p} deps`);
for (const p of ["p4","p5"]) eq(node(wide, `phase-${p}`).depends_on, ["merge-1"], `phase-${p} deps`);
for (const p of ["p1","p2","p3","p4","p5"]) eq(node(wide, `phase-${p}`).isolation, "worktree", `phase-${p} isolation`);
eq(wide.returns, "result", "returns");
eq(ids(wide).includes("merge-3"), false, "no merge-3");
if (!node(wide, "merge-1").bash.includes("Merge three-wide p1: it’s ＄x")) { console.error("FAIL title replacement"); process.exit(1); }
eq(ids(serial).sort(), ["phase-p1","phase-p2","start","merge-1","merge-2","deliver","result"].sort(), "serial node ids");
' "$scratch/three-wide.yaml" "$scratch/serial.yaml"
echo "structure: ok"

# d. a cycle is an error
if bun "$render" "$fx/cycle.md" --slug cyc --branch feat/cyc --title C --main main --pack test/devflow >/dev/null 2>"$scratch/cycle.err"; then
  echo "cycle.md rendered without error" >&2; exit 1
fi
grep -q "dependency cycle" "$scratch/cycle.err"
echo "cycle: ok"

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
  PATH="$stubs:$PATH" ARTIFACTS_DIR="$pub_art" WORKFLOW_ID=test INPUTS_SLUG=s INPUTS_TITLE=S \
    INPUTS_WORKFLOW=devflow-run-s INPUTS_PLANS_REF=plans INPUTS_PLANS_DIR=plans INPUTS_MAIN_BRANCH=main \
    bun "$publisher"
}
publish > "$scratch/publish1.json"
git -C "$porigin" show plans:plans/s/plan.md >/dev/null
git -C "$porigin" show plans:plans/s/after.md >/dev/null
git -C "$porigin" show plans:plans/workflows/devflow-run-s.yaml >/dev/null
test ! -e "$scratch/archon-called"
grep -q extraWorkflowSources "$pub_art/published.md"
test -z "$(git branch --list 'plans-*')"
test -z "$(git -C "$porigin" branch --list 'plans-*')"
n1="$(git -C "$porigin" rev-list --count plans)"
echo "# changed" >> "$pub_art/plan.md"
publish > "$scratch/publish2.json"
n2="$(git -C "$porigin" rev-list --count plans)"
test "$((n2 - n1))" -eq 1
echo "publish-plan: ok"
echo "test-render-run: all ok"
