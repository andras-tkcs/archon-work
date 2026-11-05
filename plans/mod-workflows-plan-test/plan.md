# Plan: mod-devflow-* internal workflows, and devflow-plan tests every plan before it publishes

## Goal

The run's message asked for three things:

1. The devflow pack's workflows that a person never starts get the prefix `mod-devflow-`. The
   Archon workflow list then shows which entries are not for users. Today `devflow-phase` and
   `devflow-deliver` sit in that list next to the real entry points.
2. `devflow-plan` never publishes a plan, or a generated `devflow-run-<slug>` workflow, that cannot
   run. The end of the plan workflow tests the plan, and publication waits for that test.
3. The plan workflow and the workflow it generates get a robustness review, and this change fixes
   what the review found (see Design §7).

No issue is linked; the run's message is the whole ask.

## Current state

- **Pack manifest.** `packs/devflow/archon-plugin.json:6-14` lists 8 entrypoints, including
  `devflow-phase` and `devflow-deliver`. These two must stay entrypoints, because Archon lets a
  `workflow:` node start only an entrypoint. A support (non-entrypoint) workflow composes only
  through `include:` (Archon `packages/workflows/src/packaged-workflow.ts`,
  `qualifyPackReferences`: "support workflows compose through `include:` only"). Both appear in
  `archon workflow list --json` as `tkcs-lab/devflow:devflow-phase` and `:devflow-deliver`.
  `include:` and `workflow:` targets resolve by the workflow's authored `name:`.
- **The four workflows nobody starts by hand:**
  - `packs/devflow/devflow-phase/devflow-phase.yaml:1` (`name: devflow-phase`). The rendered
    workflow starts it (`packs/devflow/.shared/render-run.ts:223`).
  - `packs/devflow/devflow-deliver/devflow-deliver.yaml:1`. The rendered workflow starts it
    (`render-run.ts:259`).
  - `packs/devflow/devflow-tail/devflow-tail.yaml:1`. Pulled in with `include: devflow-tail` by
    `devflow-quick.yaml:132`, `devflow-docs.yaml:131`, `devflow-config.yaml:261`,
    `devflow-deps.yaml:239`, `devflow-audit-fix.yaml:158` and `devflow-deliver.yaml:110`. It is
    not an entrypoint.
  - `packs/devflow/devflow-audit-fix/devflow-audit-fix.yaml:1`. Pulled in with
    `include: devflow-audit-fix` by `devflow-audit.yaml:98`. It is not an entrypoint.
- **Other mentions of the old names** (the complete `grep -rn` list outside `.git`):
  - `packs/devflow/README.md` lines 3, 26-29, 83 and 131.
  - `.shared/render-run.ts:2` and `:83`.
  - The first-line comments of `.shared/load-plan.ts` and `.shared/gate-phase.ts`.
  - `devflow-deps.yaml:12`, and `devflow-audit.yaml` lines 4, 13 and 96.
  - No fixture and no root `README.md` line mentions them.
- **Script entry points.** Each workflow folder holds `scripts/*.ts` thin entries such as
  `import "../../.shared/x.ts"`. Their relative paths do not change when a folder is renamed,
  because the folder depth stays the same.
- **devflow-plan** (`packs/devflow/devflow-plan/devflow-plan.yaml`) runs these nodes:
  1. `preflight` and `setup`.
  2. The `interview` loop_group (`draft`, `challenge`, `next`, `ask`), and `stop-at-interview`.
  3. `finalize` (`commands/finalize.md`, Opus). Only finalize runs `validate_manifest.py` and the
     section-4 review, and it reports the results itself.
  4. `render` (`devflow-plan/scripts/render-run.ts`):
     - It extracts the manifest and checks that slug and branch match.
     - It detects the pack from `archon workflow list --json`.
     - It renders the workflow and runs `archon validate` in a scratch repo.
     - Every problem fails the node.
  5. `publish` (`devflow-plan/scripts/publish-plan.ts`), which pushes to the `plans` branch.
- **What runs before publication today:** only `archon validate` of the rendered YAML.
  - Validate passes even when a child workflow does not exist. Checked on this runner:
    `archon workflow run devflow-run-three-wide --dry-run --stubs …` reports `completed` with
    `--pack nope/devflow` just as with `--pack tkcs-lab/devflow`. Neither validate nor dry-run
    resolves `workflow:` targets.
  - Nothing reruns `validate_manifest.py` after finalize.
  - Nothing checks a brief against the code.
- **How dry-run behaves on a rendered workflow** (archon v0.13.4, checked on this runner):
  - `archon workflow run <name> --dry-run --stubs <file> --json` with every reached node stubbed
    reports `"outcome": "completed"`. It needs these stubs:
    - wait nodes: `{decision, text}`
    - `workflow:` nodes: any object, for example `{head, merged}`
    - bash nodes: their `output_format`
  - `--default-stubs` fills `worktree-check.held` with `"TODO"`, so the run pauses at
    `confirm-worktree-removal`. Explicit stubs are needed.
  - On failure, stdout holds the pretty-printed trace object followed by a second JSON object,
    `{"ok": false, …}`. Exit code: 0 on `completed`, 1 on `failed`.
- **Tests:**
  - `scripts/test-render-run.sh` is **red on main** (run 2026-11-05). Its step c's expected node
    ids lack `worktree-check`, `confirm-worktree-removal`, `stop-at-worktrees` and
    `remove-worktrees`, which PR #18 (38265c0) added.
  - `scripts/test-devflow-pack.sh` is green (33 passed). It replays every
    `packs/devflow/*/fixtures/*.stubs.yaml`.
  - `devflow-plan/scripts/render-run.ts` (the node script, not the `.shared` renderer) has no test.
- **Loop semantics** (Archon docs `guides/loop-nodes.md`, `reference/variables.md`):
  - A `loop_group` body is sealed, but a body node may read outer `$node.output` and
    `$INPUTS.*`.
  - `$LOOP_PREV.<id>.output.<field>` is empty on iteration 1. It works in command prompts (as
    `draft.md` already does) and in whole-value `with:` bindings.
  - A body node that fails fails the group. Exceeding `max_iterations` fails the node.
  - Body nodes keep their bare ids in stub files.
  - A `workflow:` node cannot sit in a body. That does not matter here.
- **A plan published under the old names** (Q2/Q3): in `privacyfence/peek`, branch `plans`,
  `plans/workflows/devflow-run-backend-token-calls.yaml` starts
  `tkcs-lab/devflow:devflow-phase` 8 times and `:devflow-deliver` once.

## Design

### §0 User decisions (from the interview)

- **D1, the rename set (settled by the ask).** All four workflows nobody starts by hand are
  renamed: `devflow-phase`, `devflow-deliver`, `devflow-tail` and `devflow-audit-fix` become
  `mod-devflow-phase`, `mod-devflow-deliver`, `mod-devflow-tail` and `mod-devflow-audit-fix`.
  The rename covers the folder, the YAML file name, `name:`, the manifest entrypoint keys and
  paths, every `include:` and `workflow:` reference, the renderer, descriptions, comments and the
  READMEs. `mod-devflow-phase` and `mod-devflow-deliver` stay entrypoints; Archon requires it.
- **D4, what "the plan must be tested" covers (Q1 answer: B).** The deterministic checks run
  first:
  - the manifest validator, rerun;
  - a check that the child workflows exist in the installed catalog;
  - a dry run of the rendered workflow with stubbed children.

  An executability review by a fresh Opus agent follows. Findings go back to finalize for at most
  2 fix rounds. If findings remain after that, the run fails with them and publishes nothing.
- **D5, back-compat (Q2 had no answer and was asked again as Q3; Q3 answer: C). Clean break, no
  migration.**
  - The old names are removed and no aliases stay behind.
  - This change touches no other repository.
  - A published `devflow-run-*` that starts the old names fails at its first phase once the runner
    has the new pack. Known case: peek's `backend-token-calls`. If that plan is still needed, it
    goes through `devflow-plan` again or gets edited by hand.
  - A run already in flight keeps the pack revision it started with (root `README.md`, "Upgrading
    with the script").
  - `packs/devflow/README.md` and the PR description state the break.
- **D8, open decisions the reviewer finds (Q4 answer: A).** They go through the same fix loop as
  mechanical findings:
  - finalize picks the answer, records it under `## Assumptions` in the plan, and fixes the
    briefs;
  - the run does not go back into the interview;
  - `publish` lists the assumptions in `published.md` and gives their count in its message;
  - a plan with assumptions is still published.
- **D6, no ADR and no changelog.** The profile has no `docs.adr_*` or `docs.changelog`, and the
  repo has neither.

### §1 Rename, exact edits (phase p1)

The new folders are `packs/devflow/mod-devflow-phase/`, `packs/devflow/mod-devflow-deliver/`,
`packs/devflow/mod-devflow-tail/` and `packs/devflow/mod-devflow-audit-fix/`. Move each folder
with `git mv`, then `git mv` the YAML inside it to `mod-devflow-<x>.yaml`. The folders'
`commands/`, `scripts/` and `fixtures/` move with them unchanged.

| File | Edit |
|---|---|
| each `mod-devflow-<x>.yaml` line 1 | `name: mod-devflow-<x>` |
| `mod-devflow-phase.yaml`, `mod-devflow-deliver.yaml` description line 1 | `Internal building block (mod-), started by a devflow-run-<slug> workflow; never start it yourself.` |
| `mod-devflow-tail.yaml`, `mod-devflow-audit-fix.yaml` description line 1 | keep the text; replace any old name in it with the new one |
| `archon-plugin.json` | `"mod-devflow-phase": "mod-devflow-phase/mod-devflow-phase.yaml"`, `"mod-devflow-deliver": "mod-devflow-deliver/mod-devflow-deliver.yaml"` (same positions; the other 6 keys unchanged) |
| `devflow-quick.yaml:132`, `devflow-docs.yaml:131`, `devflow-config.yaml:261`, `devflow-deps.yaml:239`, `mod-devflow-audit-fix.yaml:158`, `mod-devflow-deliver.yaml:110` | `include: mod-devflow-tail` |
| `devflow-audit.yaml:98` | `include: mod-devflow-audit-fix` |
| `devflow-audit.yaml` lines 4, 13, 96; `devflow-deps.yaml:12` | the old name becomes the new name in the comment or description text |
| `.shared/render-run.ts:2`, `:83` | `mod-devflow-deliver` in the comment and in the description string |
| `.shared/render-run.ts:223` | `workflow: \`${o.pack}:mod-devflow-phase\`` |
| `.shared/render-run.ts:259` | `workflow: \`${o.pack}:mod-devflow-deliver\`` |
| `.shared/load-plan.ts:1`, `.shared/gate-phase.ts:1` | the comment names `mod-devflow-phase` / `mod-devflow-deliver` |
| `packs/devflow/README.md` lines 3, 26-29, 83, 131 | the new names (§6 rewrites the step-by-step section later; p1 changes only the names) |

The include node ids (`tail`, `ship`) do not change, so fixture keys such as `tail__review-gate`
stay as they are.

The completeness check is this command, which must print nothing after p1:
`grep -rnP '(?<!mod-)devflow-(phase|deliver|tail|audit-fix)\b' packs scripts README.md`

### §2 `scripts/test-render-run.sh` repair (R1, phase p1)

Step c's expected id lists get the four worktree nodes. The node set is the same for every
render; `prerequisites` and `stop-at-prerequisites` appear only when there are prerequisites.

- three-wide gains `"worktree-check","confirm-worktree-removal","stop-at-worktrees","remove-worktrees"`.
- serial gains the same four.
- Add two assertions:
  - `eq(node(wide,"phase-p1").workflow, "test/devflow:mod-devflow-phase", "phase workflow")`
  - `eq(node(wide,"deliver").workflow, "test/devflow:mod-devflow-deliver", "deliver workflow")`

### §3 `devflow-plan/scripts/render-run.ts` (phase p2)

**Plan errors become output, not node failures.** Finalize can fix these, so the fix loop must see
them.

- These cases print `{"ok":false,"error":"<message>","workflow":"","file":"","waves":0}` to stdout
  and exit 0:
  - `plan.md` is missing;
  - `extractManifest` throws;
  - `plan_slug` differs from the slug;
  - `feature_branch` differs from the branch;
  - the branch does not match `branch_regex`;
  - `renderRunWorkflow` throws (a cycle, an invalid id or slug, a quote).
- Each `<message>` is the text that `fail()` prints today, without the `devflow: ` prefix.
- On success the script prints
  `{"ok":true,"error":"","workflow":"devflow-run-<slug>","file":"<path>","waves":<n>}`.

**Environment errors still fail the node** (exit 1 through `fail()`). Finalize cannot fix them.

- **The pack cannot be detected.** This is the existing message.
- **`archon workflow list --json` exits non-zero.** New message:
  ``devflow: `archon workflow list --json` failed:\n<tail 20>``.
- **Catalog check (new, R2).** Read the list once into `names: string[]`. Use it both for the
  auto-detect and for this check. When `${pack}:mod-devflow-phase` or
  `${pack}:mod-devflow-deliver` is not in `names`, fail with:
  `the installed pack <pack> has no <missing names joined with " and "> in \`archon workflow list\`; update the pack (bootstrap.sh, or archon plugin update <its plugin id>) or start devflow-plan with --input pack=<owner>/devflow`.
  The check also runs when the `pack` input is set.
- **`archon validate` rejects the rendered YAML.** This is the existing message. It points to a
  renderer bug, not a plan problem.

### §4 `devflow-plan/scripts/test-plan.ts` (new, phase p2)

This file holds its logic directly, like `render-run.ts` and `publish-plan.ts` in the same folder.
It imports `artifactsDir, fail, input, run, tail` from `../../.shared/util.ts`.

**Inputs** (env `INPUTS_*`):

- `render`: the JSON of `$render.output`.
- `devflow_root`.

**The finding object** (shared with §5 and the review agent):

```json
{ "id": "T1", "source": "render | validate_manifest | review", "kind": "mechanical | open-decision",
  "phase": "<phase id or empty>", "problem": "<one paragraph>", "fix": "<what to change>" }
```

Steps:

1. `const r = JSON.parse(input("render"))`. Use a local `parse` helper like `next-question.ts`
   does: on bad JSON, `fail("input 'render' is not JSON: …")`. If `!r.ok`, push this finding:
   `{id:"T<n>",source:"render",kind:"mechanical",phase:"",problem:r.error,fix:"Change plan.md so the renderer accepts it."}`.
2. Run `python3 <devflow_root>/scripts/validate_manifest.py <art>/plan.md --profile .claude/toolkit.yaml`.
   If it exits non-zero, push this finding:
   `{source:"validate_manifest",kind:"mechanical",phase:"",problem:tail(out+err,40),fix:"Fix every error validate_manifest.py prints."}`.
3. **Dry run, only when `r.ok`** (R4). Each problem below is a **hard failure** (`fail()`). The
   renderer is deterministic, so a rendered workflow that does not complete is a renderer bug.
   Finalize cannot fix it.
   1. Create a scratch git repo with `mkdtempSync(join(tmpdir(), "devflow-test-plan-"))`. Copy
      `r.file` to `.archon/workflows/<r.workflow>.yaml`. Run `git init -q -b main`, `git add -A`,
      and commit with the `-c user.name=devflow -c user.email=devflow@example.invalid` identity
      that `render-run.ts` uses. Remove the repo in `finally`.
   2. Parse the YAML with `Bun.YAML.parse` and build the stubs, one entry per node:
      - a node with `wait` → `{decision: "approve", text: "ok"}`;
      - a node with `workflow` → `{head: "0000000000000000000000000000000000000000", merged: true}`;
      - a node with `cancel` → no stub;
      - a `bash` or `script` node with `output_format` → an object with one entry per property:
        `string` → `""`, `boolean` → `true`, `integer` or `number` → `0`. An empty `held` makes
        `worktree-check` take the no-held-worktree path.
      - a `bash` or `script` node without `output_format` → `"ok"`.

      Write the stubs with `Bun.YAML.stringify` to `<scratch>/stubs.yaml`.
   3. Run `run(["archon","workflow","run",r.workflow,"--dry-run","--stubs",stubsPath,"--json"], {cwd: scratch, timeoutMs: 180000})`.
   4. Parse the trace. Take stdout up to and including its first line that is exactly `}`, then
      `JSON.parse` that text. If no such line exists, parse all of stdout. If parsing throws,
      `fail` with `tail(out+err,40)`.
   5. Require all of the following. Read the trace as `(j.trace ?? [])`, and treat a missing
      `outcome` as not completed: a workflow that Archon refuses to load prints no trace.
      - `outcome === "completed"`;
      - every id in `missingStubs` is also in `toleratedMissingStubs`;
      - every node id of the parsed doc that has `workflow`, plus `result`, appears in `trace`
        with `state === "stubbed"`.

      Otherwise `fail("the rendered <r.workflow> does not complete a dry run (a renderer bug, not a plan problem):\n" + <lines "nodeId state reason" of every trace entry whose state is not stubbed or skipped> )`.
4. Print `{"ok": <findings.length === 0>, "findings": [...]}`. Number the ids `T1`, `T2`, … in
   order.

### §5 `devflow-plan/scripts/check-plan.ts` (new, phase p2)

**Inputs:**

- `test`: the JSON of `$plan-test.output`.
- `review`: the JSON of `$plan-review.output`, or `""` when that node was skipped.
- `round`: `$LOOP_PREV.plan-check.output.round`. This is `""` on the first iteration.
- `finalize`: the JSON of `$finalize.output`.
- `render`: the JSON of `$render.output`.

Constant `MAX_ROUNDS = 3`: the first pass plus 2 fix rounds (D4).

1. Compute `round = (Number(input("round", false)) || 0) + 1`.
2. Collect the findings: `test.findings`, then `review.findings` if `review` is not empty. Renumber
   all of them `F1…Fn`.
3. **No findings:**
   1. Write `<art>/tested.json` with these fields:
      `{slug, branch, title, scope}` from `finalize`, and `{workflow, waves}` from `render`.
   2. Delete `<art>/test-findings.md` if it exists.
   3. Print `{"done":true,"round":round,"findings":0}`.
4. **Findings:**
   1. Write `<art>/test-findings.md` as below.
   2. If `round < MAX_ROUNDS`, print `{"done":false,"round":round,"findings":n}`.
   3. Otherwise
      `fail("the plan still has <n> findings after 2 fix rounds; nothing was published. They are in test-findings.md in the run artifacts:\n" + lines "- F<k> [<source>, <kind>] <phase or plan>: <problem's first line>")`.

`test-findings.md`:

```markdown
# Plan test findings, round <round>

Fix every finding in plan.md. A mechanical finding: change the plan to match the code. An
open decision: decide it, record it under `## Assumptions`, and fix the briefs it affects.

## F<k>. [<source>, <kind>] <phase or "plan">

**Problem:** <problem>

**Fix:** <fix>
```

### §6 The devflow-plan DAG (phase p3)

`finalize` and `render` move into a new `loop_group`. `publish` reads the tested result. The node
list after `stop-at-interview`:

```yaml
  - id: plan-loop
    depends_on: [interview]
    when: "$interview.output.stop == false"
    loop_group:
      max_iterations: 3
      until_bash: 'd=$plan-check.output.done; [ "$d" = true ]'
      nodes:
        - id: finalize            # unchanged keys: command, model, context: fresh, output_format
          command: finalize
          model: large
          context: fresh
          output_format: <the existing finalize schema, unchanged>
        - id: render
          depends_on: [finalize]
          script: render-run
          runtime: bun
          with: <the existing render `with:`, unchanged>
          output_format:
            type: object
            properties:
              ok: { type: boolean }
              error: { type: string }
              workflow: { type: string }
              file: { type: string }
              waves: { type: integer }
            required: [ok, error, workflow, file, waves]
        - id: plan-test
          depends_on: [render]
          script: test-plan
          runtime: bun
          timeout: 600000
          with:
            render: "$render.output"
            devflow_root: "$preflight.output.devflow_root"
          output_format:
            type: object
            properties:
              ok: { type: boolean }
              findings: { type: array, items: { type: object } }
            required: [ok, findings]
        - id: plan-review
          depends_on: [plan-test]
          when: "$plan-test.output.ok == true"
          command: review-plan
          model: large
          context: fresh
          denied_tools: [Write, Edit, NotebookEdit]
          output_format:
            type: object
            properties:
              clean: { type: boolean }
              summary: { type: string }
              findings:
                type: array
                items:
                  type: object
                  properties:
                    id: { type: string }
                    source: { type: string, enum: [review] }
                    kind: { type: string, enum: [mechanical, open-decision] }
                    phase: { type: string }
                    problem: { type: string }
                    fix: { type: string }
                  required: [id, source, kind, phase, problem, fix]
            required: [clean, summary, findings]
        - id: plan-check
          depends_on: [plan-test, plan-review]
          trigger_rule: all_done
          script: check-plan
          runtime: bun
          with:
            test: "$plan-test.output"
            review: { from: "$plan-review.output", if_skipped: "" }
            round: "$LOOP_PREV.plan-check.output.round"
            finalize: "$finalize.output"
            render: "$render.output"
          output_format:
            type: object
            properties:
              done: { type: boolean }
              round: { type: integer }
              findings: { type: integer }
            required: [done, round, findings]

  - id: plan-result
    depends_on: [plan-loop]
    script: plan-result
    runtime: bun
    output_format:
      type: object
      properties:
        slug: { type: string }
        branch: { type: string }
        title: { type: string }
        workflow: { type: string }
      required: [slug, branch, title, workflow]

  - id: publish
    depends_on: [plan-result]
    script: publish-plan
    runtime: bun
    with:
      slug: "$plan-result.output.slug"
      title: "$plan-result.output.title"
      workflow: "$plan-result.output.workflow"
      plans_ref: "$INPUTS.plans_ref"
      plans_dir: "$INPUTS.plans_dir"
      main_branch: "$preflight.output.main_branch"
    output_format: <the existing publish schema, unchanged>
```

**`devflow-plan/scripts/plan-result.ts` (new).** It reads `<art>/tested.json` and prints it as one
JSON line with `{slug, branch, title, workflow}`. If the file is missing it calls
`fail("tested.json does not exist: the plan test did not pass")`.

**The `devflow-plan.yaml` description.** Replace "writes the plan, publishes" with "writes the
plan, tests it (the manifest validator, a dry run of the generated workflow, and a fresh reviewer
who checks every phase against the code; up to two fix rounds), publishes". Everything else in the
description stays.

### §7 Robustness findings (all fixed by this plan)

- **R1.** `test-render-run.sh` is red on main → §2 (p1).
- **R2.** Nothing checks that the child workflows exist → the catalog check in §3 (p2).
- **R3.** `validate_manifest.py` runs only inside the finalize agent, which reports its own
  result → `test-plan` step 2 (p2).
- **R4.** The rendered workflow never runs in any form before publication → the dry run in §4
  (p2).
- **R5.** Only their author checks the briefs against the code → `plan-review` (§8) inside the
  fix loop (§6, p3).
- **R6.** A plan problem caught by `render` fails the run outright, though finalize could fix it.
  Examples: a slug mismatch, a cycle, a phase id that is not kebab-case. Fixed: §3 turns these
  into output, and §4 turns them into findings (p2).
- **R7.** A fix round must not start from stale state. finalize tells a fix round from the first
  pass by `$LOOP_PREV.plan-check.output.round`, not by checking whether `test-findings.md`
  exists. This holds on resume too: a resumed loop_group restarts at iteration 1 (§9, p3).
- **R8.** Assumptions are visible: `publish` reports them (§10, p3).

Rejected:

- **A push retry in `publish-plan.ts`**, for two devflow-plan runs that publish at the same instant.
  The failure is loud and a resume fixes it, and a test for it needs a race we cannot stage
  deterministically. Left as is.
- **Making `test-plan`'s dry-run failure a finding.** finalize cannot fix the renderer, so two fix
  rounds would be spent for nothing.

### §8 `devflow-plan/commands/review-plan.md` (new, phase p3). Write exactly this file:

```markdown
You are the **executability reviewer** (Opus, a fresh session) for a plan that a Sonnet worker
will implement phase by phase. You change nothing and write no files. You find what would make a
phase fail or force its worker to guess.

Read `$ARTIFACTS_DIR/plan.md`, the project profile `$ARTIFACTS_DIR/profile.json`, the must-read
docs it lists, and `$preflight.output.devflow_root/commands/make-plan.md` ("Sizing for Sonnet").
The repository is your working directory, at the commit the phases will start from.

For every phase in the manifest, check against the code as it is now:

1. Every path in `touches` exists, or the phase's brief (or an earlier phase it depends on)
   creates it. A glob matches at least one file, or the brief creates one.
2. Every file, function, symbol, config key, test file and command the brief names exists (use
   grep and read the files), unless this phase or a phase it depends on creates it.
3. Every `acceptance` item is a named test, a grep or a command with its expected result, and
   what it names exists or is created by the phase. The executable of each command is on PATH
   (`command -v`).
4. Every command in `verify_after_merge` and in the profile's `verify.fast` and `verify.dod`
   names an executable that exists.
5. The brief leaves no decision open: "choose", "decide", "consider", "if appropriate" and "e.g."
   appear only with the choice spelled out. Each step names its files and symbols.
6. `depends_on` is honest: a phase that uses what another phase creates depends on it.
7. A file the brief edits is in `touches`.

Kinds:
- `mechanical`: the code, the profile or the plan itself settles the fix (a wrong path, a
  missing `touches` entry, a command that does not exist, a missing dependency).
- `open-decision`: the fix needs a choice that only the user could make (scope, behaviour, a
  user-visible name or string) and that neither the plan nor the code settles.
- A decision already listed under `## Assumptions` in plan.md is settled; never report it again.

You may run read-only commands (grep, ls, `command -v`, `git log`, `--help`). Never run a
command that changes files, git state or anything outside the repository.

Return `findings`: one object per problem, with `id` (`R1`, `R2`, …), `source: review`, `kind`,
`phase` (the phase id, or `""` for the plan as a whole), `problem` (what is wrong, with the
`path:line` evidence) and `fix` (exactly what to change in plan.md). Return `clean: true` only
when `findings` is empty. `summary` is one paragraph listing what you checked.
```

### §9 `finalize.md` changes (phase p3)

Insert this section after "## Inputs from the interview":

```markdown
## Fix rounds

This node runs again when the plan test finds problems. The round number of the last test is
`$LOOP_PREV.plan-check.output.round`.

- If it is empty, this is the first pass: write the plan as described below, and ignore any
  `$ARTIFACTS_DIR/test-findings.md` (it is left over from an earlier attempt).
- If it is not empty, this is a fix round. Read `$ARTIFACTS_DIR/plan.md` and
  `$ARTIFACTS_DIR/test-findings.md`, and fix every finding in place:
  - `mechanical`: change the plan to match the code, the profile or the validator.
  - `open-decision`: you decide; nobody can be asked any more. Pick the answer the code, the
    ADRs and the interview support best, record it under `## Assumptions`, and fix every brief
    it affects.
  - Keep `slug`, `branch` and `title` unchanged. Rerun `validate_manifest.py`. Skip the section 4
    `Plan` subagent review in a fix round: the plan test's reviewer replaces it.
  - Return the same output fields as on the first pass.

## Assumptions

plan.md always has an `## Assumptions` section, right before `## Implementation manifest`. It
lists every decision made after the interview, one bullet each:

`- **<the decision>**: <the choice>. Why: <reason>. Made after the interview, not asked (round <n>, finding <F-id>).`

When there are none, the section holds the single line `None.`.
```

### §10 `publish-plan.ts`: assumptions (phase p3)

- Read `<art>/plan.md` line by line, skipping fenced code: a line starting with three backticks
  toggles "in a fence", and lines in a fence are ignored. A plan can quote `## Assumptions` inside
  a fence, as this plan does in §9. The section is the text after the **last** non-fenced line
  matching `^## Assumptions\s*$`, up to the next non-fenced `^## ` line or the end of the file.
  Its non-fenced lines that start with `- ` are the assumptions.
- `published.md` gains a section after the workflow line:
  - `## Assumptions`, then the bullets verbatim;
  - or, when there are none, the line
    `None: every decision in the plan was made in the interview.`
- The printed `message` becomes one of:
  - `published <workflow>; assumptions: none; run archon workflow sync to load it`
  - `published <workflow>; assumptions: <n> (listed in published.md); run archon workflow sync to load it`

### §11 Docs (phase p4)

**`packs/devflow/README.md`, "devflow-plan, step by step":**

- Replace steps 2-4 with:
  - **2. Plan:** unchanged text.
  - **3. Render:** a deterministic renderer turns the manifest into `devflow-run-<slug>.yaml`,
    checked with `archon validate`. It checks that the installed pack has `mod-devflow-phase` and
    `mod-devflow-deliver`.
  - **4. Test:**
    - The manifest validator runs again, and the generated workflow is dry-run with stubbed
      children.
    - A fresh reviewer then walks every phase against the code: paths, symbols, acceptance and
      verify commands, open decisions.
    - Findings go back to the planner for up to two fix rounds. If findings remain, the run fails
      and nothing is published (`test-findings.md` in the run's artifacts).
    - A decision the reviewer finds open is made by the planner and listed under
      `## Assumptions` in the plan and in `published.md`.
  - **5. Publish:** the old step 4 text.
- Below the workflow table, add a paragraph that starts with **Renamed building blocks:**. Write
  it as **one line** with no hard wraps, so the final grep prints exactly one
  `packs/devflow/README.md` line. It is the only place that still names the old names. It says:
  - `devflow-phase`, `devflow-deliver`, `devflow-tail` and `devflow-audit-fix` are now
    `mod-devflow-phase`, `mod-devflow-deliver`, `mod-devflow-tail` and `mod-devflow-audit-fix`;
  - the `mod-` prefix marks a workflow you never start yourself;
  - the old names are gone, with no aliases;
  - a `devflow-run-<slug>` published before the rename fails at its first phase, so run
    `devflow-plan` again for that plan, or edit its workflow file to the new names.
- In "Prove changes", add one sentence: `scripts/test-render-run.sh` also tests the plan test's
  scripts (`render-run.ts`, `test-plan.ts`, `check-plan.ts`) and `publish-plan.ts`.

**Root `README.md` line 22:** the description of `scripts/test-render-run.sh` becomes:
"Tests the devflow pack's plan workflow renderer, its plan test scripts and its git scripts (needs
`archon` and `bun`)."

## Manual steps

- **Before phase 1:** none.
- **After the last merge** (`manual_after`, full steps in `after.md`):
  1. Update the installed pack on the runner:
     `sudo -iu agent archon plugin update tkcs-lab/archon-work/packs/devflow` (or rerun
     `bootstrap.sh`). Then, in any registered repo, `archon workflow list --json` must show
     `tkcs-lab/devflow:mod-devflow-phase` and `:mod-devflow-deliver`, and no `:devflow-phase` or
     `:devflow-deliver`.
  2. Run `tkcs-lab/devflow:devflow-plan` once on a small real change. Its run shows `plan-loop`
     with `plan-test`, `plan-review` and `plan-check`, and it publishes. `published.md` has an
     `## Assumptions` section.

  Old published plans are not migrated (D5).

## Risks and open questions

**Why there were no more questions** (from interview.md):

- **Scope:** the ask names the three parts. D1 fixes the rename set, Q1 (B) fixes what the test
  covers, and R1-R8 come from reading the code and running the tests.
- **Behaviour:**
  - Q1 (B) settles the test stage.
  - Q4 (A) settles open decisions: finalize decides them and records each as an assumption; there
    is no loop back to `ask`.
  - Q3 (C) settles back-compat: a clean break, no aliases, no migration.
- **Names:** the `mod-devflow-<name>` prefix comes from the ask. The folder, file, `name:` and
  manifest keys follow the pack's one-folder-per-workflow layout. Two of the workflows stay
  entrypoints, because `workflow:` starts only entrypoints.
- **Data and schema:** the manifest format and `validate_manifest.py` are unchanged. The plan body
  gains `## Assumptions`, which the validator does not parse. Only the child names the renderer
  writes change.
- **Security:** no new credentials or network access. The reviewer runs with
  `denied_tools: [Write, Edit, NotebookEdit]`, and the dry run stubs every script node; there is
  no `--exec-code`.
- **Prerequisites:** the `--dry-run`/`--stubs` flags were checked on this runner's archon v0.13.4.
- **After merge:** update the pack on the runner. Old plans are not migrated.

**Interview notes.** Q2 got no recorded answer and was asked again verbatim as Q3. Q3's answer (C)
is the decision.

**Risks, and how a worker recognises them** (stop with `status=blocked`, do not improvise):

- **Loop wiring.** §6 relies on four features the docs describe but no existing pack file uses
  inside a `loop_group`:
  - `with:` bindings that read `$LOOP_PREV…`;
  - an array of objects in `output_format`;
  - `denied_tools` on a body command node;
  - `when:` on the `loop_group` node.

  If `archon validate workflows` rejects any of them, stop blocked and quote the error. Exception:
  `items: { type: object }` without properties on `plan-test.findings`. If that one is rejected,
  give it the same properties as `plan-review`'s items, with `source` enum
  `[render, validate_manifest]`.
- **Fixture naming.** A dry run executes a `loop_group` body only once and does not run
  `until_bash`. The reviewer checked this: the trace says "assumed complete after 1 iteration(s)".
  So the red fixture cannot reach round 3. Instead it removes the `plan-result` stub and expects
  `fail-node: plan-result`: the real `plan-result.ts` finds no `tested.json`, because check-plan
  wrote none. The reviewer ran this and the fixture passed. The "after 2 fix rounds" failure is
  covered by test-render-run.sh step d5 (iii). If the fixture fails at any other node, stop
  blocked.
- **Dry-run output format.** If `archon workflow run --dry-run --json` prints compact (one-line)
  JSON, the "first line that is exactly `}`" rule finds nothing. test-plan then parses all of
  stdout. If that fails on a red dry run (two JSON objects), stop blocked and quote stdout.
- **Peek's published plan breaks** (D5, accepted by the user).
- **Cost:** the test adds 1-3 Opus reviewer sessions and up to 2 extra finalize sessions per plan
  (accepted in Q1).

**The section 4 review** (a fresh Opus `Plan` agent) built the §6 loop in a scratch copy of the
pack, and `archon validate` accepted it, including:
- `$LOOP_PREV` in `with:`;
- `when:` on the group;
- `denied_tools` in a body;
- array `output_format`, also with `items: {type: object}`.

It confirmed the rename list, the R1 repair and the dry-run stub rules. Every one of its findings
is fixed in this plan:
1. The red fixture now fails at `plan-result`.
2. Test d4 (iv) also drops `outcome_field`, and test-plan reads `trace ?? []`.
3. `planError` is spelled out as a function declaration that returns `never`.
4. The `STUB_LIST` shape is given.
5. D8 says the publish message carries the count.
6. The final grep check is a line count.

## Assumptions

None.

## Implementation manifest

```yaml
plan_slug: mod-workflows-plan-test
feature_branch: feat/mod-workflows-plan-test
max_parallel: 1
manual_before: []
manual_after:
  - id: ma1-update-pack
    title: Update the installed devflow pack on the runner and check the mod- names in the catalog
    why: The runner keeps the old pack until it is updated; CI cannot reach the runner's Archon install
  - id: ma2-plan-run
    title: Run devflow-plan once on a small real change and check the plan test runs and publishes
    why: Only a live run exercises the Opus reviewer, the fix loop and the publish message; fixtures stub them
verify_after_merge:
  - scripts/test-render-run.sh
  - scripts/test-devflow-pack.sh
final_checks:
  - 'grep -rnP ''(?<!mod-)devflow-(phase|deliver|tail|audit-fix)\b'' packs scripts README.md prints exactly one line: the "Renamed building blocks" paragraph of packs/devflow/README.md'
  - 'scripts/test-render-run.sh ends with "test-render-run: all ok" and scripts/test-devflow-pack.sh reports 0 failed'
  - 'packs/devflow/archon-plugin.json has exactly the entrypoints devflow-plan, mod-devflow-phase, mod-devflow-deliver, devflow-quick, devflow-docs, devflow-audit, devflow-config, devflow-deps'
phases:
  - id: p1-rename-internal-workflows
    title: Rename the four internal workflows to mod-devflow-* and repair test-render-run.sh
    depends_on: []
    complexity: M
    touches:
      - packs/devflow/devflow-phase/**
      - packs/devflow/devflow-deliver/**
      - packs/devflow/devflow-tail/**
      - packs/devflow/devflow-audit-fix/**
      - packs/devflow/mod-devflow-phase/**
      - packs/devflow/mod-devflow-deliver/**
      - packs/devflow/mod-devflow-tail/**
      - packs/devflow/mod-devflow-audit-fix/**
      - packs/devflow/archon-plugin.json
      - packs/devflow/devflow-quick/devflow-quick.yaml
      - packs/devflow/devflow-docs/devflow-docs.yaml
      - packs/devflow/devflow-config/devflow-config.yaml
      - packs/devflow/devflow-deps/devflow-deps.yaml
      - packs/devflow/devflow-audit/devflow-audit.yaml
      - packs/devflow/.shared/render-run.ts
      - packs/devflow/.shared/load-plan.ts
      - packs/devflow/.shared/gate-phase.ts
      - packs/devflow/README.md
      - scripts/test-render-run.sh
    brief: |
      Read the plan's Design §0 (D1, D5) and §1, §2 first.
      1. `git mv packs/devflow/devflow-phase packs/devflow/mod-devflow-phase`, then
         `git mv packs/devflow/mod-devflow-phase/devflow-phase.yaml packs/devflow/mod-devflow-phase/mod-devflow-phase.yaml`.
         Do the same for devflow-deliver, devflow-tail and devflow-audit-fix.
      2. Make every edit in the table of Design §1, in the order given: `name:` fields, the
         description first lines, archon-plugin.json, the seven `include:` lines, the comments and
         descriptions, `.shared/render-run.ts` lines 2, 83, 223 and 259, the first-line comments
         of `.shared/load-plan.ts` and `.shared/gate-phase.ts`, and the README lines.
      3. In `scripts/test-render-run.sh`, step c, do what Design §2 says: add the four worktree
         node ids to both expected lists, and add the two `workflow` assertions after the
         `isolation` loop.
      4. Run `grep -rnP '(?<!mod-)devflow-(phase|deliver|tail|audit-fix)\b' packs scripts README.md`.
         It must print nothing. Fix every line it prints.
      5. Run `scripts/test-render-run.sh` and `scripts/test-devflow-pack.sh`. Both must pass
         (`test-render-run: all ok`; `33 passed, 0 failed`).
      Stop condition: `archon validate workflows` (inside test-devflow-pack.sh) reports that a
      `workflow:` or `include:` target cannot be resolved. That means discovery resolves by
      something other than `name:`, against what Current state says. Stop with status=blocked and
      quote the error. Do not add aliases (D5).
    acceptance:
      - 'grep -rnP ''(?<!mod-)devflow-(phase|deliver|tail|audit-fix)\b'' packs scripts README.md prints nothing'
      - 'test -f packs/devflow/mod-devflow-phase/mod-devflow-phase.yaml && test -f packs/devflow/mod-devflow-deliver/mod-devflow-deliver.yaml && test -f packs/devflow/mod-devflow-tail/mod-devflow-tail.yaml && test -f packs/devflow/mod-devflow-audit-fix/mod-devflow-audit-fix.yaml'
      - 'test ! -e packs/devflow/devflow-phase && test ! -e packs/devflow/devflow-deliver && test ! -e packs/devflow/devflow-tail && test ! -e packs/devflow/devflow-audit-fix'
      - 'grep -c ''"mod-devflow-'' packs/devflow/archon-plugin.json prints 2'
      - 'scripts/test-render-run.sh ends with "test-render-run: all ok"'
      - 'scripts/test-devflow-pack.sh prints "33 passed, 0 failed"'

  - id: p2-plan-test-scripts
    title: render-run reports plan errors as output and checks the catalog; new test-plan and check-plan scripts with tests
    depends_on: [p1-rename-internal-workflows]
    complexity: M
    touches:
      - packs/devflow/devflow-plan/scripts/render-run.ts
      - packs/devflow/devflow-plan/scripts/test-plan.ts
      - packs/devflow/devflow-plan/scripts/check-plan.ts
      - scripts/test-render-run.sh
      - scripts/fixtures/render-run/**
    brief: |
      Read the plan's Design §3, §4 and §5 first. They give every message, field and step.
      1. `packs/devflow/devflow-plan/scripts/render-run.ts`:
         - Add `function planError(msg: string): never { … }` (a function declaration, so that
           TypeScript sees it never returns). It prints
           `JSON.stringify({ok:false,error:msg,workflow:"",file:"",waves:0})` and calls
           `process.exit(0)`.
         - Replace the `fail(...)` calls for the six plan errors listed in Design §3 with
           `planError(...)`, keeping the same message text.
         - Read `archon workflow list --json` once into `names` (fail with Design §3's message
           when it exits non-zero). Use `names` for the existing auto-detect, then add the
           catalog check exactly as Design §3 words it.
         - Change the final `console.log` to include `ok:true,error:""`.
      2. Create `packs/devflow/devflow-plan/scripts/test-plan.ts` per Design §4, steps 1-4. Put a
         one-line comment at the top in the style of the other scripts.
      3. Create `packs/devflow/devflow-plan/scripts/check-plan.ts` per Design §5, with the
         `test-findings.md` format exactly as shown there.
      4. Extend `scripts/test-render-run.sh`. Add new steps after step d2 and before step e. Each
         runs in its own subshell `( … )` so `cd` and env stay local.
         Step d3, render-run.ts (the devflow-plan node script):
         - Make a stub dir `$scratch/rstub` holding an executable `archon`. On `workflow list
           --json` it prints `$STUB_LIST` (an env var shaped like
           `{"workflows":[{"name":"test/devflow:devflow-plan"},{"name":"test/devflow:mod-devflow-phase"},{"name":"test/devflow:mod-devflow-deliver"}]}`). For any other arguments it runs
           `exec "$real_archon" "$@"`, where `real_archon=$(command -v archon)` is resolved
           before PATH changes.
         - Make an artifacts dir and copy `$fx/serial.md` in as `plan.md`.
         - Run the script from the existing `$repo` of step b. Set these
           env vars: `ARTIFACTS_DIR`, `INPUTS_SLUG=serial`, `INPUTS_BRANCH=feat/serial`,
           `INPUTS_TITLE=S`, `INPUTS_MAIN_BRANCH=main`,
           `INPUTS_BRANCH_REGEX='^feat/[a-z0-9]+(-[a-z0-9]+)*$'`, `INPUTS_PLANS_REF=plans`,
           `INPUTS_PLANS_DIR=plans`, `INPUTS_PACK=test/devflow`.
         - (i) With STUB_LIST listing `test/devflow:devflow-plan`, `test/devflow:mod-devflow-phase`
           and `test/devflow:mod-devflow-deliver`, the output contains `"ok":true` and the file
           `$ARTIFACTS_DIR/devflow-run-serial.yaml` exists.
         - (ii) The same run with `INPUTS_SLUG=other` exits 0, and its output contains
           `"ok":false` and `differs from the slug`.
         - (iii) With STUB_LIST missing `test/devflow:mod-devflow-deliver`, the run exits
           non-zero, and its stderr contains `has no test/devflow:mod-devflow-deliver`.
         Step d4, test-plan.ts:
         - Create `$scratch/fakeflow/scripts/validate_manifest.py`. It exits with `$VM_EXIT`
           (default 0) and prints `ERROR: stub` when non-zero.
         - Render serial.md to `$scratch/t-serial.yaml` with the `.shared` CLI, as step a does.
         - (i) `INPUTS_RENDER='{"ok":true,"error":"","workflow":"devflow-run-serial","file":"'$scratch'/t-serial.yaml","waves":2}'`
           with `INPUTS_DEVFLOW_ROOT=$scratch/fakeflow`, run from `$repo`: output contains
           `"ok":true`.
         - (ii) The same with `VM_EXIT=1`: output contains `"ok":false` and
           `"source":"validate_manifest"`.
         - (iii) `INPUTS_RENDER` with `ok:false, error:"x differs from the slug"`: output contains
           `"source":"render"`.
         - (iv) A copy of t-serial.yaml with the `result` node removed (`bun -e` with
           `Bun.YAML.parse`/`stringify`, with `returns` and `outcome_field` deleted as well): exits non-zero, and
           stderr contains `does not complete a dry run`.
         Step d5, check-plan.ts. Use ARTIFACTS_DIR=$scratch/chk and these JSON inputs:
         - finalize `{"scope":"large","slug":"s","branch":"feat/s","title":"S","prerequisites":false,"after":false}`
         - render `{"ok":true,"error":"","workflow":"devflow-run-s","file":"/x","waves":1}`
         - (i) Test `{"ok":true,"findings":[]}`, review `""`, round `""`: output contains
           `"done":true`, `tested.json` has `"workflow":"devflow-run-s"`, and `test-findings.md`
           does not exist.
         - (ii) A review with one mechanical finding, round `""`: output contains `"done":false`
           and `"round":1`, and `test-findings.md` contains `## F1. [review, mechanical]`.
         - (iii) The same with round `"2"`: exits non-zero, and stderr contains
           `after 2 fix rounds`.
         Steps d3, d4 and d5 end with `echo "render-run node: ok"`, `echo "test-plan: ok"` and
         `echo "check-plan: ok"` respectively.
      5. Run `scripts/test-render-run.sh`; it must end with `test-render-run: all ok`. Run
         `scripts/test-devflow-pack.sh`; it must still print `33 passed, 0 failed`. The fixtures
         stub `render`, so its new output fields do not affect them.
      Stop condition: the dry run of an unmodified rendered serial or three-wide workflow does not
      report `completed` with the stub rules of Design §4. That means the renderer's node set or
      Archon's dry-run contract differs from Current state. Stop with status=blocked and quote
      the trace.
    acceptance:
      - 'scripts/test-render-run.sh prints "render-run node: ok", "test-plan: ok", "check-plan: ok" and ends with "test-render-run: all ok"'
      - 'grep -c ''planError('' packs/devflow/devflow-plan/scripts/render-run.ts prints at least 7 (the definition and the six calls)'
      - 'grep -q ''mod-devflow-deliver'' packs/devflow/devflow-plan/scripts/render-run.ts'
      - 'grep -q ''MAX_ROUNDS = 3'' packs/devflow/devflow-plan/scripts/check-plan.ts'
      - 'scripts/test-devflow-pack.sh prints "33 passed, 0 failed"'

  - id: p3-plan-test-loop
    title: Wire the plan test into devflow-plan as a fix loop, add the reviewer, assumptions in finalize and publish
    depends_on: [p2-plan-test-scripts]
    complexity: M
    touches:
      - packs/devflow/devflow-plan/devflow-plan.yaml
      - packs/devflow/devflow-plan/commands/finalize.md
      - packs/devflow/devflow-plan/commands/review-plan.md
      - packs/devflow/devflow-plan/scripts/plan-result.ts
      - packs/devflow/devflow-plan/scripts/publish-plan.ts
      - packs/devflow/devflow-plan/fixtures/**
      - scripts/test-render-run.sh
    brief: |
      Read the plan's Design §0 (D4, D8), and §6, §8, §9 and §10 first.
      1. `packs/devflow/devflow-plan/devflow-plan.yaml`:
         - Replace the `finalize` and `render` nodes with the `plan-loop` node, the `plan-result`
           node and the new `publish` wiring, exactly as in Design §6. Copy the existing finalize
           `output_format` and the existing render `with:` unchanged.
         - Update the description sentence as §6 says.
         - Keep `returns: publish`.
      2. Create `packs/devflow/devflow-plan/commands/review-plan.md` with exactly the text in
         Design §8.
      3. In `packs/devflow/devflow-plan/commands/finalize.md`, insert the two sections of
         Design §9 after "## Inputs from the interview". In its "Output" section, add the
         sentence: "plan.md has an `## Assumptions` section (see Assumptions above)."
      4. Create `packs/devflow/devflow-plan/scripts/plan-result.ts` per Design §6. Import
         `artifactsDir, fail` from `../../.shared/util.ts`.
      5. In `packs/devflow/devflow-plan/scripts/publish-plan.ts`, add the assumptions handling of
         Design §10: the `published.md` section and the new `message`.
      6. Fixtures in `packs/devflow/devflow-plan/fixtures/`:
         - In `happy-path.stubs.yaml` and `interview-done.stubs.yaml`:
           - replace the `render:` stub with
             `{ok: true, error: "", workflow: devflow-run-x, file: /stub/x.yaml, waves: <keep the existing number>}`;
           - add `plan-test: {ok: true, findings: []}`;
           - add `plan-review: {clean: true, summary: ok, findings: []}`;
           - add `plan-check: {done: true, round: 1, findings: 0}`;
           - add `plan-result: {slug: x, branch: feat/x, title: X, workflow: devflow-run-x}`.
         - Leave `interview-user-stops.stubs.yaml` unchanged.
         - Add `plan-test-never-clears.stubs.yaml`. Copy happy-path. Add a first comment line:
           "# RED: the reviewer keeps finding a problem; after two fix rounds the run fails and
           nothing is published." Add `exec-code: true`. Set `fixture: {expect: failed, fail-node: plan-result}`.
           Set `plan-review` to `{clean: false, summary: s, findings: [{id: R1, source: review, kind: mechanical, phase: p1-x, problem: stub, fix: stub}]}`.
           Remove the `plan-check` and `plan-result` stubs, so the real check-plan.ts and
           plan-result.ts run. A dry run executes the loop body once: check-plan prints
           `done:false` and writes no `tested.json`, so plan-result fails. Keep the stubs for
           every other node (preflight, setup, finalize, render, plan-test, publish).
      7. In `scripts/test-render-run.sh` step f:
         - After `publish > "$scratch/publish1.json"`, add
           `grep -q 'assumptions: none' "$scratch/publish1.json"`.
         - Replace `echo "# changed" >> "$pub_art/plan.md"` with
           `printf '\n## Assumptions\n\n- **A**: b.\n- **C**: d.\n' >> "$pub_art/plan.md"`.
         - After publish2, add `grep -q 'assumptions: 2' "$scratch/publish2.json"` and
           `grep -q '\*\*A\*\*: b\.' "$pub_art/published.md"`.
      8. Run `scripts/test-devflow-pack.sh`; it must print `34 passed, 0 failed`. Run
         `scripts/test-render-run.sh`; it must end with `test-render-run: all ok`.
      Stop conditions:
      - `archon validate workflows` rejects a construct in §6 (`$LOOP_PREV` in `with:`, an
        `output_format` array, `denied_tools` in a body, `when:` on the loop_group). Apply the
        one fallback named in the plan's Risks; for anything else, stop with status=blocked and
        quote the error.
      - The red fixture does not fail at `plan-result`. Stop with status=blocked and quote the
        `archon workflow test` output.
    acceptance:
      - 'scripts/test-devflow-pack.sh prints "34 passed, 0 failed"'
      - 'scripts/test-render-run.sh ends with "test-render-run: all ok"'
      - 'grep -q ''id: plan-loop'' packs/devflow/devflow-plan/devflow-plan.yaml && grep -q ''max_iterations: 3'' packs/devflow/devflow-plan/devflow-plan.yaml && grep -q ''command: review-plan'' packs/devflow/devflow-plan/devflow-plan.yaml'
      - 'grep -q ''LOOP_PREV.plan-check.output.round'' packs/devflow/devflow-plan/commands/finalize.md'
      - 'grep -q ''## Assumptions'' packs/devflow/devflow-plan/commands/finalize.md'
      - 'test -f packs/devflow/devflow-plan/commands/review-plan.md && grep -q ''open-decision'' packs/devflow/devflow-plan/commands/review-plan.md'
      - 'test -f packs/devflow/devflow-plan/fixtures/plan-test-never-clears.stubs.yaml'

  - id: p4-retire-docs
    title: Retirement - README updates for the plan test and the renamed building blocks
    depends_on: [p3-plan-test-loop]
    complexity: S
    touches:
      - packs/devflow/README.md
      - README.md
    brief: |
      Read the plan's Design §11 and D5. There is no ADR and no changelog in this repo (D6), and no
      plan document to delete.
      1. In `packs/devflow/README.md`, rewrite "devflow-plan, step by step" steps 2-5 as Design §11
         says. Add the "Renamed building blocks" paragraph below the workflow table, and the
         "Prove changes" sentence.
      2. In the root `README.md`, replace line 22's description of `scripts/test-render-run.sh`
         with the text in Design §11.
      3. Run the final grep:
         `grep -rnP '(?<!mod-)devflow-(phase|deliver|tail|audit-fix)\b' packs scripts README.md`.
         It prints exactly one line, and that line is the "Renamed building blocks" paragraph of
         packs/devflow/README.md.
      4. Run `scripts/test-render-run.sh` and `scripts/test-devflow-pack.sh`.
    acceptance:
      - 'grep -rnP ''(?<!mod-)devflow-(phase|deliver|tail|audit-fix)\b'' packs scripts README.md prints exactly one line, it starts with packs/devflow/README.md: and contains "Renamed building blocks"'
      - 'grep -q ''test-findings.md'' packs/devflow/README.md'
      - 'grep -q ''its plan test scripts'' README.md'
      - 'scripts/test-render-run.sh ends with "test-render-run: all ok" and scripts/test-devflow-pack.sh prints "34 passed, 0 failed"'
```
