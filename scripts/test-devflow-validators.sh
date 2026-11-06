#!/usr/bin/env bash
# Runs packs/devflow/.shared/validate-profile.py and validate-manifest.py on the fixtures in
# scripts/fixtures/validators/ and checks each exit code and message. Needs python3 with PyYAML.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1  # the importlib checks must not leave __pycache__ in the pack

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
shared="$repo_root/packs/devflow/.shared"
vp="$shared/validate-profile.py"
vm="$shared/validate-manifest.py"
fx="$repo_root/scripts/fixtures/validators"
pf="$fx/profile"
mf="$fx/manifest"
# Run from an empty directory, so no .devflow/devflow.yaml there is picked up as a default.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

passed=0
out=""
code=0

# run <cmd...>: run from $work, keep stdout+stderr in $out and the exit code in $code.
run() {
  set +e
  out="$(cd "$work" && "$@" 2>&1)"
  code=$?
  set -e
}

fail() {
  echo "FAIL $1"
  echo "  exit code: $code"
  printf '%s\n' "$out" | sed 's/^/  | /'
  exit 1
}

# expect <case> <exit code> [+fragment | -fragment]... -- <cmd...>
# +fragment must appear in the output, -fragment must not.
expect() {
  local name="$1" want="$2"
  shift 2
  local frags=()
  while [ "$1" != "--" ]; do frags+=("$1"); shift; done
  shift
  run "$@"
  [ "$code" -eq "$want" ] || fail "$name"
  local f
  for f in ${frags[@]+"${frags[@]}"}; do
    case "$f" in
      +*) grep -qF -- "${f#+}" <<<"$out" || fail "$name" ;;
      -*) if grep -qF -- "${f#-}" <<<"$out"; then fail "$name"; fi ;;
    esac
  done
  echo "PASS $name"
  passed=$((passed + 1))
}

# check <case> <cmd...>: the command must exit 0.
check() {
  local name="$1"
  shift
  run "$@"
  [ "$code" -eq 0 ] || fail "$name"
  echo "PASS $name"
  passed=$((passed + 1))
}

P() { python3 "$vp" "$@"; }
M() { python3 "$vm" "$@"; }

# ---------------------------------------------------------------- profile
expect profile-minimal-valid 0 "+devflow.yaml: OK" -warning -- P "$pf/minimal.yaml" --no-file-checks
expect profile-version-missing 1 "+devflow.yaml: missing required key 'version'" -- P "$pf/missing-version.yaml" --no-file-checks
expect profile-version-2 1 "+devflow.yaml: 'version': must be 1 (got 2)" -- P "$pf/version-2.yaml" --no-file-checks
expect profile-version-string 1 "+'version': must be an integer" -- P "$pf/version-string.yaml" --no-file-checks

for key in docs docs.must_read git git.main_branch git.branch_pattern verify verify.fast verify.dod stacks; do
  expect "profile-missing-$key" 1 "+missing required key '$key'" -- P "$pf/missing-${key//./-}.yaml" --no-file-checks
done

expect profile-unknown-keys 1 "+unknown key 'verfy'" "+unknown key 'git.main'" '+see the section "Profile" in packs/devflow/README.md' \
  -- P "$pf/unknown-keys.yaml" --no-file-checks

expect profile-type-stacks-item 1 "+'stacks[0]': must be a string" -- P "$pf/type-stacks-item.yaml" --no-file-checks
expect profile-type-verify-fast 1 "+'verify.fast': must be a list" -- P "$pf/type-verify-fast.yaml" --no-file-checks
expect profile-type-verify-dod-empty 1 "+'verify.dod': needs at least 1 item" -- P "$pf/type-verify-dod-empty.yaml" --no-file-checks
expect profile-type-verify-dod-no-run 1 "+missing required key 'verify.dod[0].run'" -- P "$pf/type-verify-dod-no-run.yaml" --no-file-checks
expect profile-type-merge-style 1 "+'git.merge_style': must be one of" -- P "$pf/type-merge-style.yaml" --no-file-checks
expect profile-type-changelog-section 1 "+missing required key 'docs.changelog.section'" -- P "$pf/type-changelog-section.yaml" --no-file-checks
expect profile-type-dispatchable-use_when 1 "+missing required key 'ci.dispatchable[0].use_when'" -- P "$pf/type-dispatchable-use_when.yaml" --no-file-checks
expect profile-type-main-branch-empty 1 "+'git.main_branch': must not be empty" -- P "$pf/type-main-branch-empty.yaml" --no-file-checks

check profile-resolved-has-no-defaults bash -c '
  python3 "$1" "$2" --no-file-checks --resolved | python3 -c "
import json, sys
r = json.load(sys.stdin)
assert r[\"version\"] == 1, r
assert \"plan_dir\" not in r[\"docs\"] and \"adr_dir\" not in r[\"docs\"], r
for k in (\"models\", \"ci\", \"project_steward\", \"plans\"):
    assert k not in r, k
"' _ "$vp" "$pf/minimal.yaml"

expect profile-adr-keys-need-adr-dir 1 "+need 'docs.adr_dir'" -- P "$pf/adr-index-without-adr-dir.yaml" --no-file-checks
expect profile-swift-without-dispatchable-warns 0 "+macOS workflow" -- P "$pf/swift-no-dispatchable.yaml" --no-file-checks
expect profile-swift-with-dispatchable-quiet 0 -warning -- P "$pf/swift-with-dispatchable.yaml" --no-file-checks
expect profile-ipados-alone-warns 0 "+macOS workflow" "+stacks: [swift, ipados]" -- P "$pf/ipados-alone.yaml" --no-file-checks
expect profile-ipados-with-swift-quiet 0 -warning -- P "$pf/ipados-with-swift.yaml" --no-file-checks
expect profile-listed-files-must-exist 1 "+'docs/missing.md'" "+'docs/steward-missing.md'" "-'README.md'" \
  -- P "$pf/listed-files.yaml" --root "$pf/root"
expect profile-listed-files-skipped 0 "+devflow.yaml: OK" -- P "$pf/listed-files.yaml" --no-file-checks

expect profile-cli-missing-profile 1 "+devflow.yaml: no profile at" '+"Profile"' -- P /nonexistent/.devflow/devflow.yaml
expect profile-cli-default-path-missing 1 "+no profile at '.devflow/devflow.yaml'" -- P
expect profile-cli-bad-yaml 1 "+devflow.yaml: not valid YAML" -- P "$pf/bad-yaml.yaml"

check profile-full-profile-valid bash -c '
  err="$(python3 "$1" "$2" --no-file-checks --resolved 2>&1 >"$3/resolved.json")" || exit 1
  [ -z "$err" ] || { echo "unexpected stderr: $err"; exit 1; }
  python3 -c "
import json, sys
r = json.load(open(sys.argv[1]))
fast = [c if isinstance(c, str) else c[\"run\"] for c in r[\"verify\"][\"fast\"]]
assert fast == [\"ruff check .\", \"python3 -m pytest tests/unit -q\"], fast
assert len(r[\"ci\"][\"dispatchable\"]) == 7
assert r[\"plans\"] == {\"ref\": \"plans\", \"dir\": \"plans\"}
" "$3/resolved.json"' _ "$vp" "$pf/full-profile.yaml" "$work"

check profile-schema-keys-match-validator python3 -c '
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("vp", sys.argv[1])
vp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vp)
schema = json.loads(vp.SCHEMA.read_text())
assert set(schema["properties"]) == set(vp.TOP_LEVEL_KEYS), (sorted(schema["properties"]), sorted(vp.TOP_LEVEL_KEYS))
assert set(schema["required"]) == {"version", "docs", "git", "verify", "stacks"}, schema["required"]
assert schema["additionalProperties"] is False
assert schema["properties"]["version"]["const"] == 1
' "$vp"

# Retired keys: a warning, exit 0, and absent from the resolved profile.
expect profile-retired-key-warns 0 "+devflow.yaml: warning: toolkit: ignored: the toolkit is retired" "+devflow.yaml: OK" \
  -- P "$pf/retired-toolkit.yaml" --no-file-checks
expect profile-retired-plan-dir-warns 0 "+warning: docs.plan_dir: ignored: plans live on the plans branch" "+devflow.yaml: OK" \
  -- P "$pf/retired-plan-dir.yaml" --no-file-checks
expect profile-retired-models-warns 0 "+warning: models: ignored: model aliases replace it" "+devflow.yaml: OK" \
  -- P "$pf/retired-models.yaml" --no-file-checks
for f in retired-toolkit retired-plan-dir retired-models; do
  check "profile-$f-not-resolved" bash -c '
    python3 "$1" "$2" --no-file-checks --resolved 2>/dev/null | python3 -c "
import json, sys
r = json.load(sys.stdin)
assert \"models\" not in r and \"plan_dir\" not in r[\"docs\"] and len(r) == 5, r
"' _ "$vp" "$pf/$f.yaml"
done

# plans
expect profile-plans-valid 0 "+devflow.yaml: OK" -- P "$pf/plans-valid.yaml" --no-file-checks
expect profile-plans-not-mapping 1 "+'plans': must be a mapping" -- P "$pf/plans-not-mapping.yaml" --no-file-checks
expect profile-plans-ref-int 1 "+'plans.ref': must be a string" -- P "$pf/plans-ref-int.yaml" --no-file-checks
expect profile-plans-dir-empty 1 "+'plans.dir': must not be empty" -- P "$pf/plans-dir-empty.yaml" --no-file-checks
expect profile-plans-unknown-key 1 "+unknown key 'plans.branch'" -- P "$pf/plans-unknown-key.yaml" --no-file-checks

# verify.ci_local
expect profile-ci-local-valid 0 "+devflow.yaml: OK" -- P "$pf/ci-local-valid.yaml" --no-file-checks
expect profile-ci-local-not-mapping 1 "+'verify.ci_local': must be a mapping" -- P "$pf/ci-local-not-mapping.yaml" --no-file-checks
expect profile-ci-local-enabled-string 1 "+'verify.ci_local.enabled': must be true/false" -- P "$pf/ci-local-enabled-string.yaml" --no-file-checks
expect profile-ci-local-jobs-string 1 "+'verify.ci_local.jobs': must be one of auto" -- P "$pf/ci-local-jobs-string.yaml" --no-file-checks
expect profile-ci-local-jobs-int 1 "+'verify.ci_local.jobs': must be a string or a list" -- P "$pf/ci-local-jobs-int.yaml" --no-file-checks
expect profile-ci-local-skip-jobs-string 1 "+'verify.ci_local.skip_jobs': must be a list" -- P "$pf/ci-local-skip-jobs-string.yaml" --no-file-checks
expect profile-ci-local-timeout-zero 1 "+'verify.ci_local.timeout_minutes': must be at least 1" -- P "$pf/ci-local-timeout-zero.yaml" --no-file-checks
expect profile-ci-local-timeout-string 1 "+'verify.ci_local.timeout_minutes': must be an integer" -- P "$pf/ci-local-timeout-string.yaml" --no-file-checks
expect profile-ci-local-env-int 1 "+'verify.ci_local.env.RETRIES': must be a string" -- P "$pf/ci-local-env-int.yaml" --no-file-checks
expect profile-ci-local-unknown-key 1 "+unknown key 'verify.ci_local.parallel'" -- P "$pf/ci-local-unknown-key.yaml" --no-file-checks
expect profile-ci-local-jobs-known 0 "+devflow.yaml: OK" -- P "$pf/ci-local-jobs-known.yaml" --root "$pf/root"
expect profile-ci-local-jobs-unknown 1 "+'verify.ci_local.jobs': no job 'deploy'" "-no job 'lint'" -- P "$pf/ci-local-jobs-unknown.yaml" --root "$pf/root"
expect profile-ci-local-jobs-unknown-no-file-checks 0 "+devflow.yaml: OK" -- P "$pf/ci-local-jobs-unknown.yaml" --no-file-checks

# This repository's own profile.
if [ -f "$repo_root/.devflow/devflow.yaml" ]; then
  expect repo-profile 0 "+devflow.yaml: OK" -- P "$repo_root/.devflow/devflow.yaml" --root "$repo_root"
else
  echo "SKIP repo profile"
fi

# ---------------------------------------------------------------- manifest
expect manifest-good 0 "+manifest: OK (demo, 3 phases)" -warning -- M "$mf/good.yaml"
for key in plan_slug feature_branch phases; do
  expect "manifest-missing-$key" 1 "+missing required key '$key'" -- M "$mf/missing-$key.yaml"
done
for field in brief acceptance title; do
  expect "manifest-phase-missing-$field" 1 "+phase 'p1-core' is missing '$field'" -- M "$mf/phase-missing-$field.yaml"
done
expect manifest-empty-acceptance 1 "+missing 'acceptance'" -- M "$mf/empty-acceptance.yaml"
expect manifest-unknown-depends-on 1 "+unknown phase 'p9-nope'" -- M "$mf/unknown-depends-on.yaml"
expect manifest-duplicate-id 1 "+duplicate phase id 'p1-core'" -- M "$mf/duplicate-id.yaml"
expect manifest-cycle 1 "+dependency cycle: " "+p1-core" "+p2-api" -- M "$mf/cycle.yaml"
expect manifest-self-dependency 1 "+depends on itself" -- M "$mf/self-dependency.yaml"
expect manifest-parallel-overlap 1 "+phases 'p2-api' and 'p3-docs' can run at the same time" "+src/api.py" -- M "$mf/parallel-overlap.yaml"
expect manifest-parallel-glob-overlap 1 "+phases 'p2-api' and 'p3-docs'" -- M "$mf/parallel-glob-overlap.yaml"
expect manifest-overlap-allowed-with-dependency 0 "+manifest: OK" -- M "$mf/good.yaml"
expect manifest-overlap-allowed-transitively 0 "+manifest: OK (demo, 4 phases)" -- M "$mf/transitive-overlap.yaml"
expect manifest-opus-needs-reason 1 "+worker_model_reason" -- M "$mf/opus-without-reason.yaml"
expect manifest-opus-with-reason 0 "+manifest: OK" -- M "$mf/opus-with-reason.yaml"
expect manifest-complexity-s-or-m 1 "+complexity must be S or M" -- M "$mf/complexity-l.yaml"
expect manifest-manual-item-fields 1 "+manual_before[0]" "+done_when" -- M "$mf/manual-item-missing-done-when.yaml"
expect manifest-legacy-manual-key 0 "+manifest: OK" -- M "$mf/legacy-manual-key.yaml"
expect manifest-artifact-without-source-warns 0 "+manifest: warning: " "+manual_steps_source" -- M "$mf/artifact-without-source.yaml"
expect manifest-feature-branch-vs-types 1 "+feat/demo" "+feature/" -- M "$mf/feat-branch.yaml" --profile "$mf/branch-types-profile.yaml"
expect manifest-feature-branch-ok 0 "+manifest: OK" -- M "$mf/good.yaml" --profile "$mf/branch-types-profile.yaml"
expect manifest-not-a-mapping 1 "+manifest: the manifest must be a YAML mapping" -- M "$mf/not-a-mapping.yaml"

for pair in "src/a.py|src/a.py|True" "src/a.py|src/b.py|False" "src/|src/a.py|True" "src/a.py|src/*.py|True" \
            "src/**/*.py|tests/*.py|False" "src/**|src/x/y.py|True" "docs/*.md|src/*.py|False" "src/*|src/x/*|True"; do
  IFS='|' read -r a b want <<<"$pair"
  check "manifest-paths-overlap $a $b" python3 -c '
import importlib.util, sys
spec = importlib.util.spec_from_file_location("vm", sys.argv[1])
vm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vm)
a, b, want = sys.argv[2], sys.argv[3], sys.argv[4] == "True"
assert vm.paths_overlap(a, b) is want and vm.paths_overlap(b, a) is want
' "$vm" "$a" "$b" "$want"
done

expect manifest-cli-plan-markdown 0 "+manifest: OK (demo, 3 phases)" -- M "$mf/plan-with-manifest.md"
expect manifest-cli-plan-without-manifest 1 "+only runs plans that have a manifest" -- M "$mf/plan-without-manifest.md"
check manifest-cli-reports-every-error bash -c '
  out="$(cd "$3" && python3 "$1" "$2" 2>&1)" && exit 1
  [ "$(grep -c "^manifest: " <<<"$out")" -ge 2 ]' _ "$vm" "$mf/every-error.yaml" "$work"
expect manifest-cli-missing-file 1 "+manifest: no such file" -- M "$mf/nope.yaml"

check manifest-real-sized-phase-counts python3 -c '
import sys, yaml
assert len(yaml.safe_load(open(sys.argv[1]))["phases"]) == 7
assert len(yaml.safe_load(open(sys.argv[2]))["phases"]) == 21
' "$mf/manifest-seven-phases.yaml" "$mf/manifest-twenty-one-phases.yaml"
expect manifest-real-sized-seven-phases 0 "+manifest: OK (user-names, 7 phases)" -- M "$mf/manifest-seven-phases.yaml" --profile "$pf/full-profile.yaml"
expect manifest-real-sized-twenty-one-phases 0 "+manifest: OK (extension-api, 21 phases)" -- M "$mf/manifest-twenty-one-phases.yaml" --profile "$pf/full-profile.yaml"

echo "OK: $passed validator cases passed"
