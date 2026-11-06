# Profile reference: `.devflow/devflow.yaml`

The profile is the only place a project's facts live. Every devflow run validates it first with
`validate-profile.py` (in the pack's `.shared/` directory) and reads the resolved result from
`$ARTIFACTS_DIR/profile.json`. The schema is `profile.schema.json` beside the validator; the pack
README's section "Profile" has a commented example.

Rules:

- A **required** key that is missing stops the run with a message that names it, for example
  `devflow.yaml: missing required key 'verify.fast'`. The workflows never fall back to a value of
  their own.
- An **optional** key that is missing means "not used in this project".
- `version` is required and must be `1`.
- An unknown key is an error, so a typo is never silent.
- The keys of the retired plugin profile that no longer apply (its installer key, `models` and
  `docs.plan_dir`) are still accepted, with a warning ("ignored"), and are dropped from the
  resolved profile.
- A file listed in `docs.must_read` or `project_steward` that does not exist is an error, and so is
  a `verify.ci_local.jobs` name that is not a job in `.github/workflows/*.yml` (skipped with
  `--no-file-checks`).

## Keys

| Key | Required | Meaning |
|---|---|---|
| `version` | **yes** | Profile format version; must be `1` |
| `project.name` | no | Name used in prose; default is the repository name |
| `docs.must_read` | **yes** (may be `[]`) | Files the planner reads first, every worker brief names, and the final reviewer reads |
| `docs.adr_dir` | no | If set, the project uses ADRs and the workflows plan, write and check them |
| `docs.adr_index` | no (needs `adr_dir`) | File that must list every new ADR |
| `docs.adr_bar` | no (needs `adr_dir`) | Where the criteria for needing an ADR are written (`path` or `path#anchor`) |
| `docs.changelog.file`, `docs.changelog.section` | no | A user-visible change adds a line under this heading; never a version heading |
| `git.main_branch` | **yes** | Base of feature branches, the merge target and the PR base |
| `git.branch_pattern` | **yes** | Human-readable branch rule, quoted into prompts, for example `<type>/<kebab-case>` |
| `git.branch_types` | no | Allowed `<type>` values; `validate-manifest.py` rejects a manifest whose `feature_branch` uses another |
| `git.merge_style` | no | `merge-commit` or `squash`; only quoted to workers and the steward |
| `verify.fast` | **yes** | Commands run after every merge by the build workflow and by the final reviewer. Seconds to a minute |
| `verify.dod` | **yes** | The blocking definition-of-done gate, run in order |
| `verify.dod_conditional` | no | `{when: [globs], do: text}`: checked against the diff by the definition-of-done run |
| `verify.dod_manual` | no | Judgement rows the definition-of-done report marks `ok / needs attention / n/a` |
| `verify.dod_doc` | no | Pointer to the project's human-readable definition of done, quoted in its report |
| `verify.ci_local` | no | Running the repository's GitHub Actions jobs locally; see below. Absent means `jobs: auto` |
| `ci.dispatchable` | no | `{workflow, use_when, notes?}`: workflows a session may dispatch against its own branch for work the container cannot do |
| `plans.ref`, `plans.dir` | no | The branch plans live on and the directory on it; each defaults to `plans`. A run's own `plans_ref` / `plans_dir` input wins when non-empty |
| `stacks` | **yes** (may be `[]`) | Stack knowledge to load: `python` reads `stack-python.md`, `go` reads `stack-go.md`, `swift` reads `stack-swift.md`, `ipados` reads `stack-ipados.md` (list it with `swift`) |
| `project_steward` | no | Path to a project doc with policy that fits no other key; read after `pr-steward.md` and wins where more specific |
| `models`, `docs.plan_dir`, the old installer key | no | Retired: accepted with a warning and ignored |

### Command entries

Every entry of `verify.fast` and `verify.dod` is a string, or a mapping:

```yaml
- run: npm test            # required
  cwd: web                 # relative to the repo root
  narrow: "npm test -- {args}"   # narrowed definition-of-done run: run this instead of `run`, with {args} replaced
  skip_when_narrowed: true # narrowed definition-of-done run: report n/a (partial run) instead of running
```

### `verify.ci_local`

```yaml
verify:
  ci_local:
    enabled: true          # true/false
    jobs: auto             # "auto", or a list of job ids from .github/workflows/*.yml
    skip_jobs: []          # job ids never run locally
    timeout_minutes: 20    # integer, at least 1
    env: {}                # extra environment variables, string to string
```

Every subkey is optional; an unknown subkey is an error.

### `ci.dispatchable`

```yaml
ci:
  dispatchable:
    - workflow: macos-tests.yml
      use_when: Build or test an iOS/macOS target
      notes: No inputs.
```

The planner treats anything one of these covers as a phase task, never a manual step; the PR
steward (`$ARTIFACTS_DIR/knowledge/pr-steward.md`) dispatches it instead of skipping the row; a
swift or ipados project with an empty list gets a warning. The workflow file must be on the default
branch to be dispatchable.

### `verify.dod_conditional`

`when` globs are matched against `git diff --name-only origin/<main_branch>...HEAD`.

## The manifest

Planning and building both run `python3 <shared_dir>/validate-manifest.py <plan.md> --profile
.devflow/devflow.yaml`. The manifest format is the one described in
`$ARTIFACTS_DIR/knowledge/plan-method.md`; the validator checks required keys, unique phase ids,
known `depends_on`, no cycles, `brief` and `acceptance` on every phase, `complexity` of `S` or `M`,
`worker_model_reason` for `worker_model: opus`, honest manual-step entries, `feature_branch` against
`git.branch_types`, and that phases which can run at the same time share no path in `touches`
(globs included).
