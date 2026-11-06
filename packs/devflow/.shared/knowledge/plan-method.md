# The planning method

How to research a change and write a plan document whose implementation manifest the build
workflow can run with Sonnet worker sessions. You research and plan; you do not implement any of it.

## The profile

The method is project-independent; everything specific to the repository comes from the profile
(`.devflow/devflow.yaml`), resolved in `$ARTIFACTS_DIR/profile.json`. Read
`$ARTIFACTS_DIR/knowledge/project-profile.md` first; never substitute a value of your own for a
missing key. In this file:

- `<main>` is `git.main_branch`, `<branch pattern>` is `git.branch_pattern`.
- "the must-read docs" are the files in `docs.must_read`.
- "ADR parts" (the ADRs section, the ADR step, the ADR `final_checks` item) apply only when the
  profile has `docs.adr_dir`; without it, leave them out and never mention ADRs.
- "changelog parts" apply only when the profile has `docs.changelog`.
- "the dispatch table" is `ci.dispatchable`, read through `$ARTIFACTS_DIR/knowledge/pr-steward.md`.
- "the stack knowledge" is `$ARTIFACTS_DIR/knowledge/stack-<name>.md` for each name in `stacks`;
  read it now. It says how to write `acceptance` and `verify_after_merge` entries for that stack.

## 0. Understand the ask

1. If the ask names an issue (`#<n>` or a URL), read it and its comments. If the ask is empty,
   stop and say there is nothing to plan.
2. Read the must-read docs, `$ARTIFACTS_DIR/knowledge/pr-steward.md`, the profile's
   `project_steward` file if it has one, the ADR index (`docs.adr_index`) and every ADR if the
   profile has ADRs, and every reference doc and source module the change touches. Use subagents
   for broad sweeps; read the files that matter yourself. The plan's quality depends on this step:
   a Sonnet worker executes what the plan says and does not rediscover what it leaves out.
3. Settle by reading the code everything the code can settle. A decision that is genuinely the
   user's (scope, product behaviour, a trade-off with no default in the code or the ADRs) is not
   yours to make: record it as an open question rather than choosing silently.
4. **Size the change.** A change that fits one "Sizing for Sonnet" phase (section 1: complexity S
   or M, one coherent change, one PR, nothing that has to be merged and reviewed in stages) is a
   one-phase plan. Otherwise split it into phases as below. When in doubt, prefer fewer phases: each
   phase costs a session and a review round.

## 1. Write the plan

The plan document has these sections, in this order:

1. **Goal**: what changes for the user, in a paragraph, with the issue link.
2. **Current state**: what the code does today, with `path:line` references and measurements
   (sizes, counts, timings) where they matter.
3. **Design**: the spec. Every decision is made here, not deferred to a phase: names of new
   modules, functions, config keys, routes, schema versions, exact user-visible strings, error
   texts. Where you chose between alternatives, say what you rejected and why; that text becomes
   the ADRs in the last phase.
4. **ADRs** (ADR parts only; otherwise omit this section and renumber): one bullet per decision
   that meets the bar in `docs.adr_bar`, with the ADR number it will take (next free number in
   `docs.adr_dir`) and its one-line decision. Write "none" if there are none.
5. **Manual steps**: a summary of `manual_before` and `manual_after` (see section 2).
6. **Risks and open questions**: what could make a phase's brief wrong, and how a worker
   recognises it (so it stops with `status=blocked` instead of improvising).
7. **Implementation manifest**: a fenced ` ```yaml ` block, below.

### The manifest

The build workflow parses this block and nothing else, so it is exact. `validate-manifest.py`
checks it. Fields:

```yaml
plan_slug: <slug>
feature_branch: <type>/<slug>          # <branch pattern>; with git.branch_types, the type is one of them
tracking_issue: <n>                     # optional; the orchestrator's ledger goes there
max_parallel: 2                         # phases in one wave must have disjoint `touches`
manual_steps_artifact: <URL of a step-by-step page for the manual steps; omit if there are none>
manual_steps_source: <path of that page's source; omit if there are no manual steps>
manual_before:                          # the user does these BEFORE any phase starts
  - id: mb1-<kebab>
    title: <one line>
    why: <which phase needs it, and what fails without it>
    done_when: <what the user sees, or what a phase can check, when it is done>
manual_after:                           # the user does these AFTER the last merge, before the PR merges
  - id: ma1-<kebab>
    title: <one line>
    why: <what it verifies that CI cannot>
verify_after_merge:                     # commands the orchestrator runs after each merge, in addition to verify.fast
  - <command that exercises this plan's tests; the stack knowledge says how to write it>
screenshots_after_merge: <command>      # optional
final_checks:                           # checked before the PR opens
  - <the plan document is deleted and nothing links to it>
  - <each ADR from the ADRs section exists, is Accepted, and is in docs.adr_index>   # ADR parts only
  - <the changelog has entries under docs.changelog.section and no version heading>   # changelog parts only
phases:
  - id: p1-<kebab>
    title: <one line>
    depends_on: []
    complexity: S                       # S or M; see "Sizing for Sonnet" below
    touches:                            # every file or glob this phase may change
      - <path or glob of a source file this phase changes>
      - <path or glob of its test file>
    brief: |
      <numbered, prescriptive steps; see below>
    acceptance:
      - <each one checkable by a named test or a command>
```

Rules the validator enforces: `plan_slug`, `feature_branch` and a non-empty `phases` list are
required; phase ids are unique; every `depends_on` id exists and there is no cycle; every phase has
`title`, `brief` and a non-empty `acceptance` list; `complexity` is `S` or `M`; `worker_model` is
`opus` or `sonnet`, and `opus` needs a `worker_model_reason`; `manual_before` items have `id`,
`title`, `why` and `done_when`, `manual_after` items `id`, `title` and `why`; `feature_branch` starts
with one of `git.branch_types` when the profile lists them; and two phases that can run at the same
time share no path in `touches` (globs included).

Optional per phase, rarely: `human_gate: true` (see section 2) and `worker_model: opus` with
`worker_model_reason:` (see below). The last phase is always the retirement phase: it writes the
ADRs (ADR parts), updates the reference docs, deletes the plan document, and adds the changelog
entry if earlier phases did not (changelog parts only), and does only the parts of that list that
apply to this project (ADR parts, reference docs).

### Writing acceptance

Each acceptance item is checkable without judgement: a named test that must pass (and that fails
without the change), a `grep` with its expected match or absence, or a command and its expected
output or exit code. "Works well", "is clean" and "handles errors" are not acceptance. When the
change fixes a reported finding or issue, name its id in the acceptance item that proves the fix.
The stack knowledge says how to write test commands for that stack, in `acceptance` and in
`verify_after_merge`.

### Sizing for Sonnet

The build workflow runs every phase in a Sonnet session. You are the Opus in this pipeline: do the
judgement here so the worker only has to execute. Every phase must pass all of these:

- **Complexity S** (up to about 3 source files and 150 changed lines, tests excluded) or **M** (up
  to about 8 source files and 400 lines). Anything bigger is two phases. There is no L.
- **No open decisions in a brief.** "Choose", "decide", "consider", "if appropriate" and "e.g." do
  not appear in a brief unless the choice is spelled out right there. Every name, string, schema
  and signature the worker needs is either in the brief or in a named subsection of the Design
  section, which the brief points to.
- **Numbered steps naming files and symbols**, in the order to do them, ending with tests, docs and
  the changelog line. Name the existing test files to extend and the pattern commit to copy (by
  SHA) when there is one.
- **Acceptance is mechanical**: a named test, a grep, or a command and its expected output. "Works
  well" is not acceptance.
- **`touches` is honest and disjoint within a wave**: two phases that can run at the same time
  (neither depends on the other) share no path in `touches`. If they must share one, add a
  `depends_on` edge.
- **A stop condition** for each risky step: what the worker should see if the brief is wrong, and
  that it should then stop with `status=blocked`.

### Model tiers

Workers are **Sonnet** by default. `worker_model: opus` is the escape hatch for a phase that cannot
be made mechanical, such as a subtle concurrency fix or a security-sensitive parser. Use it only
with a `worker_model_reason` the user can read, and prefer splitting the phase first. The same rule
applies to a one-phase plan: say Sonnet, or Opus with the reason.

## 2. Manual steps: only at the very beginning and the very end

Some things only the user can do: create an account or an OAuth client in a third-party console,
set up a test tenant, put a secret into the environment or into GitHub, click through a real device
or a real third-party UI. The plan collects every one of them into exactly two places:

- **`manual_before`**: everything a phase needs to already exist. The build asks the user to finish
  all of these before it starts the first phase.
- **`manual_after`**: every human verification. The build lists them in the PR as unchecked items.

Nothing manual happens in the middle. If a phase seems to need the user half-way, restructure the
plan: move the prerequisite into `manual_before`, move the check into `manual_after`, or have the
phase build against a fake and the final verification exercise the real thing. `human_gate: true`
is the last resort, for a review that would make every later phase wrong if skipped; say why in the
plan.

Before calling a step manual, check whether it is not. Anything in the dispatch table
(`ci.dispatchable`: whatever the container cannot do itself, such as packaged builds, live
external-service checks, other operating systems) runs on a runner and belongs in a phase's brief,
not in `manual_*`.

Secrets never travel through chat or the plan. A step that produces a secret says exactly where the
user stores it (the environment's settings, or the repo's **Settings → Secrets and variables →
Actions**) and under which name.
