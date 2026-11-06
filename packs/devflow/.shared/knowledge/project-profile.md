# The project profile

Everything specific to a repository (paths, commands, branch rules, CI workflows) lives in the
profile, `.devflow/devflow.yaml` at the repo root. The workflows contain no project facts of their
own. Two rules follow from that:

1. **Never guess a value.** If a key you need is missing, say which key and stop. Do not fall back
   to what a similar project does, and do not infer a command from the repository layout.
2. **A missing optional key means "not used here".** No `docs.adr_dir` means no ADRs: leave out
   every ADR step and never mention them. No `docs.changelog` means no changelog step. No
   `ci.dispatchable` means nothing can be dispatched.

## Loading the profile

1. **Read the resolved profile.** The run's preflight has already validated `.devflow/devflow.yaml`
   with `validate-profile.py --resolved` and written the result to `$ARTIFACTS_DIR/profile.json`.
   Read it from there; it is the one you use from here on. A profile that does not validate stops
   the run before any agent starts, with one message per problem, each naming the key (for example
   `devflow.yaml: missing required key 'verify.fast'`). Warnings (for example a key that is
   ignored) do not stop the run.

2. **Read the stack knowledge.** For each name in `stacks`, read
   `$ARTIFACTS_DIR/knowledge/stack-<name>.md`. If one is missing, say which and stop.

3. **Load the project's own policy.** If `project_steward` is set, read that file now.

## Keys, in the order the workflows use them

| Key | Used for |
|---|---|
| `docs.must_read` | Read first by the planner; named in every worker brief and in the final review |
| `docs.adr_dir`, `adr_index`, `adr_bar` | ADR steps, only when `adr_dir` is set |
| `docs.changelog.file`, `.section` | The changelog line a user-visible change adds |
| `git.main_branch` | Base for feature branches, merges and the PR |
| `git.branch_pattern`, `branch_types` | Names of feature branches; checked by `validate-manifest.py` |
| `git.merge_style` | Quoted to workers and in `$ARTIFACTS_DIR/knowledge/pr-steward.md` |
| `verify.fast` | Run after every merge in the build workflow and by the final reviewer |
| `verify.dod`, `dod_conditional`, `dod_manual`, `dod_doc` | The definition of done (`verify.dod`) |
| `verify.ci_local` | Which GitHub Actions jobs are run locally; absent means `jobs: auto` |
| `ci.dispatchable` | The dispatch table in `$ARTIFACTS_DIR/knowledge/pr-steward.md`; what is not "manual" in a plan |
| `plans` | The branch (`ref`) and directory (`dir`) plans live in; both default to `plans` |
| `stacks` | Which `$ARTIFACTS_DIR/knowledge/stack-<name>.md` files to read |
| `project_steward` | A project doc with policy that fits none of the keys |

A command entry in `verify.*` is a string or `{run, cwd?, narrow?, skip_when_narrowed?}`; a string
means `run` with no options. `cwd` is relative to the repo root.

## Quoting

When a prompt or a brief needs a project fact, write the actual value into it (the real paths and
commands), not "see the profile": child sessions start from a fresh checkout and should not have to
rediscover it. They do have the profile in the checkout, so the definition of done (`verify.dod`)
can run there.
