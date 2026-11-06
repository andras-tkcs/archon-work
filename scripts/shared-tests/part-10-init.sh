#!/usr/bin/env bash
# devflow-init's scripts: scan-repo detects stacks, commands and the branch pattern in python, go,
# node and empty repositories and converts a legacy toolkit.yaml; write-profile rejects an invalid
# draft with every error and writes a valid one in the fixed key order (an equal one is left
# alone); scaffold-repo never overwrites and keeps the other Archon config keys; publish-init makes
# no branch or PR when nothing changed and one branch and one PR otherwise; doctor reports a
# missing command, and a missing archon or python3 as a warn row, never a failure.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
js() { bun -e "const r=JSON.parse(process.argv[1]); console.log($2)" "$1"; }
scan() { # scan <dir> [branch names...]: the scan JSON of <dir>
  local d="$1"; shift
  (cd "$d" && bun -e "
    import { scanRepo } from '$SHARED/scan-repo.ts';
    console.log(JSON.stringify(scanRepo('.', { mainBranch: 'trunk', branchNames: process.argv.slice(1), mergeStyle: 'squash', plansBranch: false })));" "$@")
}
export ARTIFACTS_DIR="$(mk_tmp)"

# --- scan-repo
py="$(mk_scratch)"
printf '[project]\nname="x"\n[tool.ruff]\n[tool.pytest.ini_options]\n' > "$py/pyproject.toml"; echo r > "$py/README.md"
s="$(scan "$py" feat/a-b fix/c chore/d main)"
eq "$(js "$s" 'r.draft.stacks.join()')" "python" "python: stack"
eq "$(js "$s" 'r.draft.verify.fast.join()')" "ruff check ." "python: fast from tool.ruff"
eq "$(js "$s" 'r.draft.verify.dod.join()')" "pytest" "python: dod from tool.pytest"
eq "$(js "$s" 'r.draft.git.branch_pattern + " " + r.draft.git.branch_types.join()')" "<type>/<kebab-case> chore,feat,fix" "branch pattern and types from branch names"
eq "$(js "$s" 'r.draft.git.main_branch + " " + r.provenance["git.main_branch"] + " " + r.draft.git.merge_style')" "trunk detected squash" "main branch and merge style detected"
eq "$(js "$s" 'r.existing.source')" "none" "no profile: source none"
go="$(mk_scratch)"; echo 'module x' > "$go/go.mod"
s="$(scan "$go")"
eq "$(js "$s" 'r.draft.stacks.join() + "|" + r.draft.verify.fast.join() + "|" + r.draft.verify.dod.join()')" "go|go vet ./...|go test ./..." "go: stack and commands"
node="$(mk_scratch)"; echo '{"scripts":{"lint":"eslint .","test":"vitest"}}' > "$node/package.json"; touch "$node/pnpm-lock.yaml"
s="$(scan "$node")"
eq "$(js "$s" 'r.draft.stacks.length + "|" + r.draft.verify.fast.join() + "|" + r.draft.verify.dod.join()')" "0|pnpm run lint|pnpm run test" "node: commands, no stack"
empty="$(mk_scratch)"
s="$(scan "$empty")"
eq "$(js "$s" 'r.draft.verify.dod.length + " " + r.provenance["verify.dod"] + " " + r.draft.docs.must_read.join()')" "0 default README.md" "empty repo: defaults, dod left to a question"
mkdir -p "$empty/.github/workflows"
printf 'on: [push, workflow_dispatch]\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n' > "$empty/.github/workflows/ci.yml"
s="$(scan "$empty")"
eq "$(js "$s" 'r.candidates.dispatchable.join() + " " + r.candidates.ci_local.map(j => j.job + ":" + j.runs).join()')" ".github/workflows/ci.yml t:true" "dispatchable workflows and local CI jobs"
legacy="$(mk_scratch)"; mkdir -p "$legacy/.claude/hooks"
printf 'toolkit: { ref: v1 }\nmodels: { small: x }\ndocs: { must_read: [A.md], plan_dir: plans }\ngit: { main_branch: dev, branch_pattern: "<type>/<slug>" }\nverify: { fast: [make lint], dod: [make test] }\nstacks: [go]\n' > "$legacy/.claude/toolkit.yaml"
touch "$legacy/.claude/hooks/devflow.sh"
s="$(scan "$legacy")"
eq "$(js "$s" 'r.existing.source + " " + r.draft.version + " " + ("toolkit" in r.draft) + " " + ("models" in r.draft) + " " + ("plan_dir" in r.draft.docs)')" "legacy 1 false false false" "legacy: converted"
eq "$(js "$s" 'r.draft.git.main_branch + " " + r.provenance["git.main_branch"] + " " + r.draft.verify.dod.join()')" "dev existing make test" "legacy values win over detection"
eq "$(js "$s" 'r.leftovers.join()')" ".claude/toolkit.yaml,.claude/hooks/devflow.sh" "legacy: leftovers listed"

# --- write-profile
w="$(mk_scratch)"; echo r > "$w/README.md"
wp() { (cd "$w" && INPUTS_PROFILE="$1" bun "$SHARED/write-profile.ts" 2>&1); }
out="$(wp '{"version":1,"docs":{"must_read":["README.md"]},"git":{"main_branch":"main"},"verify":{"fast":[],"dod":[]},"stacks":[],"colour":"x"}')"
contains "$out" "verify.dod" "invalid: the dod error"
contains "$out" "unknown key 'colour'" "invalid: the unknown key error, in the same failure"
contains "$out" "branch_pattern" "invalid: the missing branch_pattern error"
[ ! -e "$w/.devflow/devflow.yaml" ] && ok "invalid: nothing written" || _fail "invalid: a file was written"
good='{"stacks":[],"verify":{"dod":["make test"],"fast":["make lint"]},"git":{"branch_pattern":"<type>/<kebab-case>","main_branch":"main"},"docs":{"must_read":["README.md"]},"version":1}'
eq "$(js "$(wp "$good")" 'r.changed')" "true" "valid: written"
eq "$(grep -E '^[a-z_]+:' "$w/.devflow/devflow.yaml" | cut -d: -f1 | tr '\n' ' ')" "version docs git verify stacks " "valid: fixed key order"
contains "$(cat "$w/.devflow/devflow.yaml")" "# Default branch, branch names and merge style." "valid: a comment per key"
python3 "$SHARED/validate-profile.py" "$w/.devflow/devflow.yaml" --root "$w" >/dev/null 2>&1 && ok "valid: the written file validates" || _fail "valid: the written file does not validate"
before="$(cat "$w/.devflow/devflow.yaml")"
eq "$(js "$(wp '{"version":1,"docs":{"must_read":["README.md"]},"git":{"main_branch":"main","branch_pattern":"<type>/<kebab-case>"},"verify":{"fast":["make lint"],"dod":["make test"]},"stacks":[]}')" 'r.changed')" "false" "equal draft: unchanged"
eq "$(cat "$w/.devflow/devflow.yaml")" "$before" "equal draft: the file is left as it is"

# --- scaffold-repo
sc="$(mk_scratch)"
mkdir -p "$sc/.archon/devflow/policy" "$sc/.claude" "$sc/.devflow"
printf '# keep me\nworktree:\n  baseBranch: main\n' > "$sc/.archon/config.yaml"
echo "custom rulings" > "$sc/.archon/devflow/policy/rulings.md"
echo "x: 1" > "$sc/.claude/toolkit.yaml"; echo "version: 1" > "$sc/.devflow/devflow.yaml"
printf 'node_modules/' > "$sc/.gitignore"
(cd "$sc" && git add -A && git commit -qm base)
out="$(cd "$sc" && bun "$SHARED/scaffold-repo.ts")"
eq "$(js "$out" 'r.changed.join()')" ".archon/config.yaml,.gitignore,.claude/toolkit.yaml" "scaffold: only what is missing"
eq "$(cat "$sc/.archon/devflow/policy/rulings.md")" "custom rulings" "scaffold: rulings.md not overwritten"
contains "$(cat "$sc/.archon/config.yaml")" "# keep me" "scaffold: config comments kept"
eq "$(cd "$sc" && bun -e 'const c=Bun.YAML.parse(await Bun.file(".archon/config.yaml").text()); console.log(c.worktree.baseBranch, JSON.stringify(c.extraWorkflowSources))')" 'main [{"ref":"plans","path":"plans"}]' "scaffold: plans source merged, other keys kept"
eq "$(tail -n 2 "$sc/.gitignore" | tr '\n' ' ')" "node_modules/ .archon/worktrees/ " "scaffold: .gitignore line appended on its own line"
eq "$(cd "$sc" && git status --porcelain -- .claude/toolkit.yaml)" "D  .claude/toolkit.yaml" "scaffold: legacy profile removed with git rm"
eq "$(js "$(cd "$sc" && bun "$SHARED/scaffold-repo.ts")" 'r.changed.length')" "0" "scaffold: a second run changes nothing"
eq "$(bun -e "import { mergeArchonConfig } from '$SHARED/scaffold-repo.ts'; console.log(mergeArchonConfig('extraWorkflowSources:\n  - { ref: other, path: x }\nfoo: 1\n', 'plans', 'plans'))" | bun -e 'const c=Bun.YAML.parse(await Bun.stdin.text()); console.log(c.foo, c.extraWorkflowSources.length)')" "1 2" "scaffold: an existing source list is extended"

# --- publish-init
use_stub_gh
mk_clone
cd "$REPO"
mkdir -p .devflow .archon/devflow/policy
printf 'version: 1\ndocs: { must_read: [README.md] }\ngit: { main_branch: main, branch_pattern: "<type>/<kebab-case>", branch_types: [feat, chore] }\nverify: { fast: ["make lint"], dod: ["make test"] }\nstacks: []\n' > .devflow/devflow.yaml
pi() { env INPUTS_DOCTOR='{"ok":3,"warn":0,"fail":0,"table":"| t |"}' INPUTS_PROVENANCE='{"version":"default"}' INPUTS_LEFTOVERS='[".claude/hooks/devflow.sh"]' bun "$SHARED/publish-init.ts" 2>&1; }
out="$(pi)"
eq "$(js "$out" 'r.changed + " " + r.files.join() + " " + r.plans_branch_created')" "true .devflow/devflow.yaml true" "publish: the changed file; the plans branch was missing"
eq "$(git branch --show-current)" "chore/devflow-init" "publish: branch chore/devflow-init"
eq "$(git log -1 --format=%s)" "Initialise devflow (.devflow/devflow.yaml)" "publish: commit message"
eq "$(git ls-remote origin refs/heads/chore/devflow-init | cut -f1)" "$(git rev-parse HEAD)" "publish: pushed"
eq "$(gh_calls '^pr create')" "1" "publish: one PR"
contains "$(cat "$GH_STUB_DIR/pr-body.md")" "- [ ] Remove the claude-toolkit leftover \`.claude/hooks/devflow.sh\` by hand." "publish: the cleanup checklist in the PR body"
eq "$(git ls-remote origin refs/heads/plans | wc -l | tr -d ' ')" "1" "publish: plans branch created"
git fetch -q origin plans
eq "$(git show FETCH_HEAD:plans/README.md)" "Managed by the devflow workflows; do not edit by hand." "publish: plans README"
git switch -q main && git merge -q --ff-only chore/devflow-init
out="$(pi)"
eq "$(js "$out" 'r.changed + " " + r.pr_url + " " + r.plans_branch_created')" "false  false" "publish: nothing changed, no PR"
eq "$(gh_calls '^pr create')" "1" "publish: still one PR"
eq "$(git branch --show-current)" "main" "publish: no branch made"

# --- doctor
printf 'version: 1\ndocs: { must_read: [README.md] }\ngit: { main_branch: main, branch_pattern: "<type>/<kebab-case>" }\nverify: { fast: [devflow-no-such-tool --x], dod: ["make test"] }\nstacks: []\n' > .devflow/devflow.yaml
out="$(bun "$SHARED/doctor.ts" 2>/dev/null)"
code=$?
eq "$code" "0" "doctor: never fails"
contains "$(js "$out" 'r.table')" "| verify.fast: devflow-no-such-tool | fail |" "doctor: missing command reported"
# Only bun, git, bash and the stub gh on PATH: archon and python3 are missing executables, not failures.
bare="$(mk_tmp)"
for t in bun git bash; do ln -s "$(command -v "$t")" "$bare/$t"; done
ln -s "$GH_STUB_DIR/bin/gh" "$bare/gh"; ln -s "$GH_STUB_DIR/bin/gh.ts" "$bare/gh.ts"
out="$(PATH="$bare" "$bare/bun" "$SHARED/doctor.ts" 2>/dev/null)"
code=$?
eq "$code" "0" "doctor without archon: never fails"
contains "$(js "$out" 'r.table')" "| devflow pack installed | warn | archon workflow list | install archon |" "doctor without archon: a warn row"
contains "$(js "$out" 'r.table')" "| python3 with PyYAML | warn |" "doctor without python3: a warn row"
contains "$(js "$out" 'r.table')" "| verify.fast: devflow-no-such-tool | fail |" "doctor without archon: missing command still reported"
# Without python3 the profile is read unvalidated: mis-shaped lists are ignored, not a crash.
printf 'version: 1\nverify: { fast: { a: b }, dod: "make test", ci_local: { skip_jobs: x, env: [a] } }\nci: { dispatchable: { x: y } }\n' > .devflow/devflow.yaml
out="$(PATH="$bare" "$bare/bun" "$SHARED/doctor.ts" 2>/dev/null)"
code=$?
eq "$code" "0" "doctor without python3, mis-shaped profile: never fails"
eq "$(js "$out" 'r.checks.filter((c) => /^(verify|ci)\./.test(c.name)).length')" "0" "doctor without python3, mis-shaped profile: no command rows"
for broken in 'verify: { fast: [x' ''; do
  printf '%s\n' "$broken" > .devflow/devflow.yaml
  out="$(bun "$SHARED/doctor.ts" 2>/dev/null)"
  code=$?
  eq "$code" "0" "doctor, profile '$broken' not a mapping: never fails"
  contains "$(js "$out" 'r.table')" "| profile valid | fail |" "doctor, profile '$broken' not a mapping: reported"
done
finish
