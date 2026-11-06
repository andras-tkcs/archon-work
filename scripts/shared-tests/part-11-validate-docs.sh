#!/usr/bin/env bash
# validate-docs.ts and the templates: each template matches doc-schema.ts, each template filled with
# sample values passes, every rule's invalid fixture fails with exactly that rule and all its errors,
# --ref reads a commit, --warn exits 0.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fx="$REPO_ROOT/scripts/fixtures/docs"
vd() { bun "$SHARED/validate-docs.ts" "$@"; }

# 1. Each template's H1, H2s and labels are the schema's.
out="$(bun -e "
import { SCHEMA, KINDS } from '$SHARED/doc-schema.ts';
import { templateText } from '$SHARED/render-template.ts';
const bad = [];
for (const k of KINDS) {
  const s = SCHEMA[k];
  const lines = templateText(k).split('\n');
  if (lines[0] !== '# ' + s.h1 + '{{title}}') bad.push(k + ': H1 ' + lines[0]);
  const h2 = lines.filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
  const want = s.items ? ['{{n}}. {{title}}'] : s.sections.filter((x) => x.title !== 'Proposed rulings').map((x) => x.title);
  if (h2.join('|') !== want.join('|')) bad.push(k + ': H2s ' + h2.join('|'));
  const labelsOf = (from) => lines.slice(from).filter((l) => /^(- )?(\*\*)?[A-Z][a-z]*( [a-z]+)?:(\*\*)? /.test(l) || /^(- )?[A-Z][a-z]+:$/.test(l)).map((l) => l.split(/(?<=:\*\*|:) /)[0].replace(/ \{\{.*/, ''));
  for (const b of s.blocks ?? []) {
    const i = lines.findIndex((l) => l.startsWith('### ' + b.prefix + '{{n}}. '));
    const got = labelsOf(i + 1).slice(0, b.labels.length);
    if (i < 0 || got.join('|') !== b.labels.join('|')) bad.push(k + ': block labels ' + got.join('|'));
  }
  if (s.items) {
    const i = lines.findIndex((l) => l.startsWith('## {{n}}. '));
    const got = labelsOf(i + 1);
    if (got.join('|') !== s.items.labels.join('|')) bad.push(k + ': item labels ' + got.join('|'));
  }
  for (const sec of s.sections) for (const lab of sec.labels ?? []) if (!lines.some((l) => l.startsWith(lab + ' '))) bad.push(k + ': label ' + lab);
}
console.log(bad.join('\n'));
")"
eq "$out" "" "every template matches doc-schema.ts"

# 2. Each template filled with sample values (plus front matter) is the valid set, and it passes.
samples="$(mk_tmp)"
bun "$REPO_ROOT/scripts/shared-tests/fill-samples.ts" "$samples"
eq "$(diff -r "$samples" "$fx/valid" && echo same)" "same" "the filled templates are scripts/fixtures/docs/valid"
cd "$(mk_tmp)"
out="$(vd --issue 7 --dir "$samples" --kinds all)"; code=$?
eq "$code" "0" "the filled templates pass"
contains "$out" '"ok":true' "ok is true"
contains "$out" '"checked":["'"$samples"'/design.md",' "checked lists the files"
contains "$out" "phase 'verify' has no 'touches'" "manifest warnings are passed on"
eq "$(vd --issue 7 --dir "$samples" --kinds design >/dev/null; echo $?)" "0" "a single kind passes on its own"
out="$(vd --issue 8 --dir "$samples" --kinds design)"; code=$?
eq "$code" "1" "a single file of another issue fails"
contains "$out" '"rule":"V1","message":"front matter issue 7 is not issue 8"' "V1 names the issue"

# 3. Every invalid fixture fails with exactly its rule, and every error is listed (each breaks twice,
# except V4 whose one rename is two errors; a fixture's expected-count file says otherwise).
for d in "$fx"/*/; do
  rule="$(basename "$d")"
  [ "$rule" = valid ] && continue
  set_dir="$(mk_tmp)"
  cp "$fx"/valid/*.md "$set_dir"/
  cp "$d"*.md "$set_dir"/
  out="$(vd --issue 7 --dir "$set_dir" --kinds all 2>/dev/null)"; code=$?
  eq "$code" "1" "$rule fixture fails"
  got="$(echo "$out" | bun -e 'const r=JSON.parse(await Bun.stdin.text());console.log([...new Set(r.errors.map(e=>e.rule))].join(",")+" "+r.errors.length)')"
  want=2; [ -f "$d/expected-count" ] && want="$(cat "$d/expected-count")"
  eq "$got" "$rule $want" "$rule fixture fails with exactly $rule, every error listed"
done

# 4. --ref reads the files at a commit; X8 needs the workflow and its plan revision.
mk_clone
repo="$REPO"
folder="$repo/plans/plans/issue-7"
mkdir -p "$folder" "$repo/plans/workflows"
cp "$fx"/valid/*.md "$folder"/
printf 'name: build-issue-7\ndescription: "Build issue #7: design r1, plan r1 (plans/plans/issue-7/plan.md)."\n' > "$repo/plans/workflows/build-issue-7.yaml"
git -C "$repo" add plans && git -C "$repo" commit -qm plans
good="$(git -C "$repo" rev-parse HEAD)"
echo "changed after the commit" >> "$folder/design.md"
out="$(cd "$repo" && vd --issue 7 --ref "$good" --kinds all)"; code=$?
eq "$code" "0" "--ref passes on the committed set (the working copy is not read)"
contains "$out" '"checked":["plans/plans/issue-7/design.md",' "--ref names branch paths"
git -C "$repo" checkout -q -- .
printf 'name: build-issue-7\ndescription: "Build issue #7: design r1, plan r2."\n' > "$repo/plans/workflows/build-issue-7.yaml"
git -C "$repo" commit -qam "wrong revision"
out="$(cd "$repo" && vd --issue 7 --ref HEAD --kinds plan,plan-test,before,after --with-design)"; code=$?
eq "$code" "1" "--ref fails when the workflow names another plan revision"
contains "$out" '"rule":"X8","message":"the workflow'"'"'s description does not name plan r1"' "X8 names the revision"
git -C "$repo" rm -q plans/workflows/build-issue-7.yaml && git -C "$repo" commit -qm "no workflow"
out="$(cd "$repo" && vd --issue 7 --ref HEAD --kinds all)"; code=$?
eq "$code" "1" "--ref fails without the workflow"
contains "$out" '"file":"plans/workflows/build-issue-7.yaml","line":1,"rule":"X8"' "X8 names the missing workflow"
out="$(cd "$repo" && vd --issue 7 --ref HEAD --plans-dir other --kinds design)"; code=$?
contains "$out" '"message":"design.md is missing"' "--plans-dir changes the folder"

# 5. --warn exits 0 and still lists the errors; bad arguments exit 2.
out="$(cd "$repo" && vd --issue 7 --ref HEAD --kinds all --warn)"; code=$?
eq "$code" "0" "--warn exits 0"
contains "$out" '"ok":false' "--warn still reports the errors"
eq "$(vd --issue 7 --kinds all 2>/dev/null; echo $?)" "2" "--dir or --ref is required"
eq "$(vd --issue 7 --dir "$samples" --kinds deviations >/dev/null; echo $?)" "0" "--kinds deviations passes on the valid set"
eq "$(vd --issue 7 --dir . --kinds nonsense 2>/dev/null; echo $?)" "2" "an unknown kind is refused"
# 6. `all` is the five plans-branch documents with --ref and all six with --dir.
out="$(cd "$repo" && vd --issue 7 --ref "$good" --kinds all)"
eq "$(echo "$out" | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).checked.length)')" "5" "--ref with all checks five files"
out="$(vd --issue 7 --dir "$samples" --kinds all)"
eq "$(echo "$out" | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).checked.length)')" "6" "--dir with all checks six files"
finish
