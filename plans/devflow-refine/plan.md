# devflow-refine: refine a published plan before its implementation starts

## Goal

Today a plan made by `devflow-plan` is published to the `plans` branch: `plans/<slug>/plan.md`,
optionally `prerequisites.md` / `after.md`, and `plans/workflows/devflow-run-<slug>.yaml`. To change
it you either plan again from scratch or edit the files by hand, and a hand edit leaves the rendered
workflow stale. The new **`devflow-refine`** workflow takes an existing published plan and a prompt
that says what to change. It revises the plan with the same method as `devflow-plan`: the same
one-question-at-a-time interview, make-plan, "Sizing for Sonnet", `validate_manifest.py` and the
Opus review. Then it re-renders `devflow-run-<slug>.yaml` and republishes both in place, so the user
can run `archon workflow sync` and start the refined `devflow-run-<slug>`. It refuses a plan whose
implementation has started or is already merged.

Started from a message alone, like every other devflow workflow:

```bash
archon workflow run tkcs-lab/devflow:devflow-refine "refine plans/foo: split phase 2 into two" --detach
```

Scope: **large**. It adds a new workflow, a new script, three commands and fixtures, moves two
scripts to `.shared`, and updates the docs: 4 phases, run one at a time.

## Current state

- `packs/devflow/devflow-plan/devflow-plan.yaml` (190 lines): `preflight` → `setup` → `interview`
  loop_group (`draft` / `challenge` / `next` / `ask`, `max_iterations: 15`,
  `until_bash: 'd=$next.output.done; [ "$d" = true ]'`) → `stop-at-interview` (cancel) →
  `finalize` → `render` → `publish`. The `ask` node's labels are `workflow: devflow-plan`,
  `stage: interview`.
- `packs/devflow/devflow-plan/commands/{draft,challenge,finalize}.md`: planner prompts. Each one
  starts with "The work: `$INPUTS.work`. If that is empty, the work is the run's message:
  `$ARGUMENTS`". They write `$ARTIFACTS_DIR/interview.md`, `plan-draft.md`, and then `plan.md`,
  `prerequisites.md` and `after.md`. They reference outer nodes from inside the loop
  (`$preflight.output.devflow_root`), so a command can also reference `$load.output.*`.
- `packs/devflow/devflow-plan/scripts/render-run.ts` (88 lines) holds the full logic, not a thin
  entry. It renders with `.shared/render-run.ts` `renderRunWorkflow`, checks the manifest's
  `plan_slug`/`feature_branch` against the `slug`/`branch` inputs (lines 25-26), and auto-detects the
  pack from `archon workflow list --json` (lines 29-44; its error text ends
  `start devflow-plan with --input pack=<owner>/devflow`). Then it runs `archon validate` in a
  scratch repo.
- `packs/devflow/devflow-plan/scripts/publish-plan.ts` (93 lines) also holds the full logic. It
  creates a temporary worktree on the plans branch, copies `plan.md` and `prerequisites.md`/`after.md`
  (and removes them when they are absent), copies the workflow, and commits
  `` `Plan ${slug}: ${title}` `` (line 48). It pushes without force and writes `published.md`.
- The thin-entry pattern: `devflow-*/scripts/<x>.ts` is exactly two lines, the comment
  `// Thin entry point: the logic lives in the pack's .shared/<x>.ts.` and then
  `import "../../.shared/<x>.ts";` (see `devflow-plan/scripts/preflight.ts`).
- `packs/devflow/.shared/util.ts`: `run`, `must`, `fail` (prints `devflow: <msg>` to stderr and
  exits 1), `tail`, `artifactsDir`, `input(name, required = true)` (reads
  `INPUTS_<NAME>`).
- `packs/devflow/.shared/render-run.ts`: exports `extractManifest`, `renderRunWorkflow` and `waves`.
  Its CLI is guarded by `import.meta.main` (line 282), so importing it is side-effect free. The
  rendered `start` node pins `plan_commit` and resumes an existing `origin/<feature_branch>`.
  `.shared/load-plan.ts` treats a phase as done when the branch has a `Plan-Phase: <slug>/<phase>`
  commit.
- Archon (0.13.4, checked on this runner) puts the run's message into every script node's
  environment as `USER_MESSAGE` (and `ARGUMENTS`). A test run of a one-node script workflow with
  the message `refine plans/foo: split it` printed `USER_MESSAGE=refine plans/foo: split it`.
- The fixture schema (`archon workflow test`): `fixture: {expect: completed|failed|paused|cancelled,
  fail-node (required when failed), reached, inputs, resolved-text-contains}`, plus one stub per
  node id.
- `packs/devflow/archon-plugin.json` `entrypoints` lists 8 workflows. `packs/devflow/README.md` says
  "Six workflows" (line 3), has the workflow table at lines 17-24 and "## devflow-plan, step by step"
  at line 69. The root `README.md` mentions the pack at line 20 and lists the workflows at line 169.
- Tests: `scripts/test-devflow-pack.sh` (runs `archon validate workflows` and replays every
  `fixtures/*.stubs.yaml`) and `scripts/test-render-run.sh` (150 lines; section f, lines 110-150,
  publishes to a fresh bare origin with a `gh` stub that prints `test/repo` for every call). The
  fixture `scripts/fixtures/render-run/serial.md` has `plan_slug: serial`,
  `feature_branch: feat/serial`, and `three-wide.md` has `plan_slug: three-wide`,
  `feature_branch: feat/three-wide`.
- Profile (`.claude/toolkit.yaml`): no ADR dir, no changelog, no stacks, no dispatch table.
  `verify.dod` is the two test scripts above.

## Design

### Decisions from the interview (the user's)

- **Q1 = A: the same interview loop as devflow-plan.** It is the draft / challenge / next / ask loop,
  one question at a time through the attention queue, at most 14 questions, with
  `.shared/next-question.ts` unchanged. The planner asks only about what the refinement prompt
  leaves open or what the change breaks in the existing plan, so a clear prompt finishes with no
  questions. The draft starts from the loaded plan, not from scratch.
- **Q3 = A: refuse when implementation has started.** "Started" means that the plan's
  `feature_branch` exists on origin. The run is cancelled before any model is called, with the
  "Strings" text for reason `branch`. The check runs again right before publishing, because a run
  may have started during the interview. (Q2 asked the same question and got no recorded answer.)
- **Q4 = A: also refuse plans that are already implemented and merged.** `devflow-config` turns on
  `delete_branch_on_merge`, so the feature branch is gone after delivery. A plan therefore also
  counts as implemented in two more cases:
  - `origin/<main_branch>` has a commit whose message contains `Plan-Phase: <slug>/`. The rendered
    phase merges carry this trailer.
  - As a backstop for squash merges, `gh pr list --head <feature_branch> --state merged` returns a
    PR.
  The same check runs at load and before publish. The refusal text says "already implemented".
- **Q5 = A: the plan comes from `--input plan` or from the message.** As with every other devflow
  workflow, a message alone is enough. `--input plan` wins when it is given. Otherwise `load` finds
  exactly one plan in the run's message (`USER_MESSAGE`), as a plan URL, a `<plans_dir>/<slug>` path
  or a bare known slug. No plan, several plans, or no change text fail before any model runs.

### Decisions settled by the code

- The name is `devflow-refine` (the pack's `devflow-<verb>` convention). The directory is
  `packs/devflow/devflow-refine/`, and the entrypoint is
  `"devflow-refine": "devflow-refine/devflow-refine.yaml"`.
- The slug and feature branch are fixed. They come from the loaded manifest, and `render` fails when
  the refined manifest changes them (the existing check). The workflow name stays
  `devflow-run-<slug>`. The republish is a new, unforced commit on the plans branch. A
  `devflow-run-<slug>` run that is already going is unaffected because it pinned `plan_commit`.
- History lives in the plans branch's git log. The commit message is `Refine <slug>: <title>`.
- No new storage, credentials or prerequisites. It uses the `git` and `gh` access that `preflight`
  already checks.

### Shared-script refactor (phase p1)

- **`packs/devflow/.shared/publish-plan.ts`** gets the body of today's
  `devflow-plan/scripts/publish-plan.ts`, with imports changed to `./util.ts`. It adds one optional
  input, `commit_verb` (`input("commit_verb", false)`, default `Plan`). The node fails with
  `` `invalid commit_verb '${verb}': it must be Plan or Refine` `` unless the verb is `Plan` or
  `Refine`. The commit message is `` `${verb} ${slug}: ${title}` ``. Nothing else changes.
- **`packs/devflow/.shared/render-plan.ts`** gets the body of today's
  `devflow-plan/scripts/render-run.ts`, with imports changed to `./render-run.ts` and `./util.ts`.
  The only text change is the pack-detect error, which becomes
  `` `cannot tell which installed devflow pack to use (${...}); start the workflow with --input pack=<owner>/devflow` ``.
  Detection still looks for `:devflow-plan$`, which both workflows' pack contains.
- `devflow-plan/scripts/publish-plan.ts` and `devflow-plan/scripts/render-run.ts` become thin
  entries, importing `../../.shared/publish-plan.ts` and `../../.shared/render-plan.ts`
  respectively. The node ids and script names in `devflow-plan.yaml` are unchanged.

### Script `devflow-refine/scripts/load-published.ts` (phase p2)

This is full logic, not a thin entry, like `devflow-config/scripts/snapshot.ts`. It imports `fail`,
`input`, `must`, `run`, `tail` and `artifactsDir` from `../../.shared/util.ts`, and
`extractManifest` from `../../.shared/render-run.ts`. The constant `KEBAB` is
`/^[a-z0-9]+(-[a-z0-9]+)*$/`.

Inputs (all through `input(name, false)` except the three required ones):

- `plan` (optional)
- `work` (optional)
- `plans_ref` (required)
- `plans_dir` (required)
- `main_branch` (required)
- `check_only` (optional; `"true"` or empty)

The message is `process.env.USER_MESSAGE ?? ""`.

Steps, in order:

1. **Plans branch.** If `git ls-remote --exit-code --heads origin <plans_ref>` exits non-zero, fail
   with `` `the ${plansRef} branch does not exist on origin: there is no published plan to refine` ``.
   Otherwise run `must(["git","fetch","origin",plansRef])` and set
   `plan_commit = must(["git","rev-parse","FETCH_HEAD"])`. The known slugs are the lines of
   `git ls-tree --name-only <plan_commit>:<plans_dir>/`, without `workflows`, keeping only those
   that match `KEBAB`. If that command fails, the list is empty. **From here on, every `git show`
   and `git ls-tree` reads from the SHA `plan_commit`, never from `FETCH_HEAD`.** Step 7 (b)
   fetches main, which overwrites `FETCH_HEAD`.
2. **Slug from `--input plan`** (when `plan` is non-empty). If `plan` matches `KEBAB`, the slug is
   `plan`. Otherwise the slug is group 1 of the first match of
   `new RegExp("/" + escapeRe(plansDir) + "/([a-z0-9]+(?:-[a-z0-9]+)*)/plan\\.md")`. If neither
   works, fail with `` `'${plan}' is neither a plan slug nor a plan URL` ``. `escapeRe` escapes
   regex metacharacters (`s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`).
3. **Slug from the message** (when `plan` is empty). Collect a set of slugs:
   - (a) group 1 of every match of `"/" + escapeRe(plansDir) + "/([a-z0-9]+(?:-[a-z0-9]+)*)/plan\\.md"`
     (global);
   - (b) group 2 of every match of
     `"(^|[^A-Za-z0-9_/.-])" + escapeRe(plansDir) + "/([a-z0-9]+(?:-[a-z0-9]+)*)"` (global);
   - (c) every token from `message.split(/[^A-Za-z0-9_\/-]+/)` that is in the known slugs. Tokens
     are case-sensitive, so `Refine` is not a slug.
   - An empty set fails with the "No plan" string. A set with more than one slug fails with the
     "Several plans" string, listing the slugs sorted and joined by `, `.
4. **The plan file.** `git show <plan_commit>:<plans_dir>/<slug>/plan.md`. If it exits non-zero, fail
   with `` `no plan '${slug}' on ${plansRef} (${plansDir}/${slug}/plan.md)` ``.
5. **The manifest.** Wrap `extractManifest(text)` in try/catch and fail with its message. When
   `manifest.plan_slug !== slug`, fail with
   `` `the published plan's plan_slug '${manifest.plan_slug}' differs from its directory '${slug}'` ``.
   Then `branch = String(manifest.feature_branch ?? "")`. An empty branch fails with
   `` `the published plan ${slug} has no feature_branch` ``. `title` is the text after `# ` on the
   first line that starts with `# `, trimmed, or else the slug.
6. **The change.** `work` is the `work` input when it is non-empty, else the message. Make a copy of
   it. Run the step 3 (a) and (b) regexes on the copy, whatever the source of the slug, and remove
   every match whose slug group equals the slug. Also remove every whole-word occurrence of the slug and every `refine` word (case-insensitive). If the copy has no letter
   (`/[A-Za-z]/`) left, fail with the "No change" string. The `work` output is the unmodified `work`.
7. **The started check** (`started=false`, `reason=""` to begin with):
   - (a) `git ls-remote --exit-code --heads origin <branch>` exits 0 → `reason = "branch"`.
   - (b) Otherwise `must(["git","fetch","origin",mainBranch])`. If
     `git log origin/<main_branch> --format=%H --fixed-strings --grep=Plan-Phase: <slug>/` prints
     anything → `reason = "merged"`.
   - (c) Otherwise run `gh pr list --head <branch> --state merged --json number --jq length`. A
     non-zero exit or output that is not an integer fails with
     `` `cannot check for a merged pull request from ${branch}: ${tail(out+err, 5)}` ``. A value
     `> 0` → `reason = "merged"`.
   - `started = reason !== ""`. `refusal` is the matching "Refuse" string, or `""`.
8. **Check-only mode** (`check_only === "true"`): skip step 9. If started, fail with `refusal`
   (through `fail`, so stderr shows `devflow: Not refined: …`). Otherwise print `{"ok":true}` and
   exit 0.
9. **The originals.** Create `$ARTIFACTS_DIR/original/` and write `original/plan.md`. Also write
   `original/prerequisites.md` and `original/after.md` from
   `<plan_commit>:<plans_dir>/<slug>/<file>` when `git show` succeeds for them. Print
   `JSON.stringify({slug, branch, title, plan_commit, started, reason, refusal, work})` on stdout
   (stdout holds only that JSON; diagnostics go to stderr). When started is true, it still exits 0,
   so the `refuse-started` node can cancel the run.

### Workflow `devflow-refine/devflow-refine.yaml` (phase p3)

Copy `devflow-plan.yaml` and change it as below. `name: devflow-refine`, `model: large`,
`worktree.enabled: true` and `returns: publish` stay as in `devflow-plan.yaml`. The description reads:

```
Refines a plan that devflow-plan already published, before its implementation starts. It loads
the plan from the plans branch, interviews you one question at a time about what your request
leaves open (a clear request needs no questions), revises the plan with the same method, and
republishes the plan and its devflow-run-<slug> workflow in place.

Use when: "refine plans/<slug>: <what to change>", or a plan URL or slug and the change.
NOT for: a plan whose implementation has started (its branch is on origin) or is merged, a new
plan (devflow-plan), or a quick edit (devflow-quick).
```

Inputs (all `default: ""` except as noted):

- `plan`: "The plan's slug, or its plan.md URL on the plans branch. Empty means the plan is
  named in the run's message."
- `work`: "What to change in the plan. Empty means the run's message."
- `plans_ref` (default `plans`) and `plans_dir` (default `plans`), with descriptions as in
  devflow-plan.
- `pack` (default `""`), as in devflow-plan.

Nodes, in order:

1. `preflight` and `setup`: copied verbatim from devflow-plan. They use the thin entries
   `scripts/preflight.ts` and `scripts/setup-env.ts`.
2. `load`: `depends_on: [setup]`, `script: load-published`, `runtime: bun`. It has `with:`
   `plan: "$INPUTS.plan"`, `work: "$INPUTS.work"`, `plans_ref: "$INPUTS.plans_ref"`,
   `plans_dir: "$INPUTS.plans_dir"` and `main_branch: "$preflight.output.main_branch"`. Its
   `output_format` is an object with string `slug`, `branch`, `title`, `plan_commit`, `reason`,
   `refusal` and `work`, and boolean `started`, all required.
3. `refuse-started`: `depends_on: [load]`, `when: "$load.output.started == true"`,
   `cancel: "$load.output.refusal"`.
4. `interview`: `depends_on: [load]`, `when: "$load.output.started == false"`. The loop_group is
   identical to devflow-plan's (the same four nodes, `max_iterations: 15` and `until_bash`). The
   only change is that `ask.wait.labels.workflow` is `devflow-refine`. The `draft`, `challenge` and
   `next` nodes use this workflow's own `commands/draft.md` and `commands/challenge.md` and the
   thin entry `scripts/next-question.ts`.
5. `stop-at-interview`: as devflow-plan. Its cancel text is "Stopped while refining: the interview
   ended without a refined plan (stopped by the answer, or 14 questions without converging). The
   published plan is unchanged. The questions and answers are interview.md in the run artifacts."
6. `finalize`: as devflow-plan, with the same output schema.
7. `render`: as devflow-plan, except `slug: "$load.output.slug"` and
   `branch: "$load.output.branch"`. It uses the thin entry `scripts/render-run.ts`, which imports
   `.shared/render-plan.ts`.
8. `still-unstarted`: `depends_on: [render]`, `script: load-published`, `runtime: bun`. It has
   `with:` `plan: "$load.output.slug"`, `work: "$load.output.work"`, `plans_ref`, `plans_dir`
   and `main_branch` as in `load`, and `check_only: "true"`. Its `output_format` is an object with
   boolean `ok`, required.
9. `publish`: `depends_on: [still-unstarted]`, as devflow-plan, except `slug: "$load.output.slug"`
   and the extra `commit_verb: Refine`. It uses the thin entry `scripts/publish-plan.ts`, which
   imports `.shared/publish-plan.ts`.

The `devflow-refine/scripts/` directory holds these thin entries: `preflight.ts`, `setup-env.ts`,
`next-question.ts`, `render-run.ts` (importing `.shared/render-plan.ts`) and `publish-plan.ts`. It
also holds `load-published.ts` from p2.

### Commands `devflow-refine/commands/` (phase p3)

These are copies of `devflow-plan/commands/{draft,challenge,finalize}.md` with these changes:

- **All three.** Replace the two lines "The work: `$INPUTS.work`. If that is empty, the work is the
  run's message:" and the `$ARGUMENTS` line after them with this block:

  ```
  The plan to refine is `$ARTIFACTS_DIR/original/plan.md` (with `original/prerequisites.md` and
  `original/after.md` when they exist), published as `$load.output.slug` at commit
  `$load.output.plan_commit` on the plans branch. Its feature branch is `$load.output.branch`.
  Nothing of it is implemented yet.

  What to change (it may name the plan; that is the plan above):

  $load.output.work
  ```

- **draft.md.** Add to "Each round", step 3: "On the first round (`plan-draft.md` does not exist),
  copy `original/plan.md` to `plan-draft.md` first, then apply the change." Add to step 4: "Ask
  only about what the change leaves open or what it breaks in the plan. Never re-open a decision
  the original plan records unless the change contradicts it." The first line's role wording stays.
- **challenge.md.** Add: "Also compare `plan-draft.md` with `original/plan.md`. A decision the draft
  changed that the requested change does not cover, and that no answer in interview.md settled, is
  a question."
- **finalize.md.** Add a new override 7: "**Slug and branch stay.** `slug` is `$load.output.slug`
  and `branch` is `$load.output.branch`, and the manifest's `plan_slug` and `feature_branch` keep
  those values. The plan's Design records the requested change (under `### Refinement`, with the
  change text quoted) and every new interview answer. Phase ids may change freely, because nothing
  is implemented yet." Override 6 stays.

### Strings

- Refuse, reason `branch`: `Not refined: the plan <slug> is already being implemented (its branch <branch> exists on origin). devflow-refine only changes plans whose implementation has not started.`
- Refuse, reason `merged`: `Not refined: the plan <slug> is already implemented (it is merged into <main_branch>). devflow-refine only changes plans whose implementation has not started.`
- No plan: `Not refined: no plan named. Start devflow-refine with a message that names the plan (its slug, <plans_dir>/<slug>, or its plan.md URL on the <plans_ref> branch), or with --input plan=<slug>.`
- Several plans: `Not refined: the message names more than one plan (<slug>, <slug>). Name one, or start devflow-refine with --input plan=<slug>.`
- No change: `Not refined: say what to change in the plan <slug>, in the message or with --input work=<change>.`

Each `<…>` is substituted with the value. `<slug>, <slug>` is the sorted list joined by `, `.

### Docs (phase p4)

- `packs/devflow/README.md`:
  - line 3 says "Seven workflows" instead of "Six workflows".
  - A new table row after `devflow-plan`'s:
    `` | `devflow-refine` | Change a plan devflow-plan published, before its implementation starts: the same interview, then the plan and `devflow-run-<slug>` republished in place | Every question the change leaves open, one at a time; it refuses a plan whose branch is on origin or that is merged | ``
  - A new section `## devflow-refine, step by step` right after "devflow-plan, step by step"
    (before "## Enable plan workflows in a project"). It covers:
    - how to name the plan (a message with the slug, `plans/<slug>` or the plan URL, or
      `--input plan=<slug>`),
    - that it refuses a started or merged plan (the three checks),
    - the interview starting from the published plan,
    - that the slug, branch and workflow name stay the same,
    - the `Refine <slug>: <title>` commit,
    - that you then run `archon workflow sync` and `devflow-run-<slug>`,
    - that a `devflow-run-<slug>` run already going keeps the plan it started with.
  - The run example after it: `archon workflow run tkcs-lab/devflow:devflow-refine "refine plans/<slug>: <what to change>" --detach`.
- `README.md` line 20: replace ``with `devflow-plan` publishing a parallel implementation workflow, for any repo``
  with ``with `devflow-plan` publishing a parallel implementation workflow and `devflow-refine` revising it before implementation, for any repo``.
  Line 169: replace ``(or `-quick`, `-docs`, `-audit`, `-config`, `-deps`)`` with
  ``(or `-refine`, `-quick`, `-docs`, `-audit`, `-config`, `-deps`)``.
- `packs/devflow/archon-plugin.json` `description` (phase p3): replace "plan-only runs that
  publish a parallel implementation workflow" with "plan-only runs that publish a parallel
  implementation workflow, and refinement of a published plan before it is implemented".

## Manual steps

None before or after implementation. No credentials, accounts or consoles are involved. The
workflow uses the plans branch and the `git` and `gh` access that `preflight` already checks.
Nothing has to be dispatched (the profile has no `ci.dispatchable`). Once merged, the runner gets
the new workflow through the usual pack update (`bootstrap.sh` / `archon plugin` update), as for any
pack change. That is routine and not part of this plan.

## Risks and open questions

- **Not detected:** a `devflow-run-<slug>` run that has started but has not pushed its branch to
  origin yet. It keeps the plan it started with (pinned `plan_commit`). A later re-run would use the
  refined plan.
- **Out of scope:** plans whose implementation has started or finished (Q3, Q4). A separate feature
  may handle follow-ups to merged plans.
- **Message with two known slugs:** if a bare word in the message happens to equal another plan's
  slug, `load` fails with "more than one plan", and the user then names the plan with
  `--input plan`. A one-letter slug (for example `s`) matches any standalone `s` token, such as the
  `s` in "it's". The p2 tests avoid such messages.
- **Not detected as merged:** a plan whose phases were merged by hand without the `Plan-Phase`
  trailer and without a PR from `<feature_branch>`.
- **`gh` unavailable at load:** step 7 (c) fails the run instead of skipping the check. Refusing is
  the safe default, and `preflight` already requires an authenticated `gh`.
- **Fixtures cannot make a script node fail.** It was not confirmed that a stub can force a script
  node to fail (`expect: failed` with `fail-node` is used only for executed gates). So the
  "no plan", "several plans", "no change" and `check_only` failure paths are tested in
  `scripts/test-render-run.sh` section g, and the fixtures cover only the completed and cancelled
  paths. **Stop condition (p3):** if `archon workflow test` rejects a fixture because it needs a stub
  shape not described here, stop with `status=blocked` and quote the error.
- **Why no more questions** (from the interview):
  - Scope: Q1 (same interview loop), Q3 (refuse once implementation has started) and Q4 (also
    refuse merged plans) set the edges. Q5 makes the plan reachable from the message alone, like
    the other devflow workflows. The slug and feature branch stay fixed because render already
    rejects a manifest whose `plan_slug` or `feature_branch` differs.
  - Behaviour: the flow mirrors `devflow-plan.yaml` node by node. `--input plan` wins. Otherwise
    `load` reads the run's message from `USER_MESSAGE` (verified on this runner) and finds exactly
    one plan by URL, `plans/<slug>` path or bare known slug. No plan, several plans or no change
    text fail before any model runs. The started check runs at load and again before publish. A run
    already in progress keeps its pinned `plan_commit`.
  - Names and strings: `devflow-refine` follows `devflow-<verb>`. The inputs reuse devflow-plan's
    names plus `plan`. The commit message is `Refine <slug>: <title>`. All refusal and failure texts
    are fixed in Design "Strings".
  - Data and schema: no new storage. The plans-branch layout is unchanged and history is its git
    log.
  - Security: no new credentials. Slugs are validated as kebab-case before any git path is built,
    which is enough to stop path injection (bare-word slugs are also matched against the plans
    branch's directory list). Pushes are never forced. The message is
    only parsed, never executed.
  - Prerequisites, credentials and after-merge steps: none beyond the usual pack update. The
    profile has no ADR dir and no changelog.
- **p3 is above the usual M file count** (about 10 files plus 3 fixtures). Six of them are verbatim
  copies (five two-line thin entries and the devflow-plan YAML/commands as a base), so the real new
  content is within M. The reviewer flagged this, and it is accepted as is.
- **The fixtures do not prove that `$load.output.refusal` is substituted into the cancel text.**
  The semantics of the fixture key `resolved-text-contains` were not verified, so it is not used.
  The refusal texts themselves are covered by the p2 tests.
- **Default taken at finalize:** `commit_verb` accepts only `Plan` and `Refine`. A free-form verb
  would let any input string into the commit subject for no benefit.

## Implementation manifest

```yaml
plan_slug: devflow-refine
feature_branch: feat/devflow-refine
max_parallel: 1
verify_after_merge:
  - scripts/test-render-run.sh
  - scripts/test-devflow-pack.sh
final_checks:
  - packs/devflow/archon-plugin.json maps devflow-refine to devflow-refine/devflow-refine.yaml and `scripts/test-devflow-pack.sh` passes
  - "`grep -c devflow-refine packs/devflow/README.md README.md` is non-zero for both files"
  - "`scripts/test-render-run.sh` ends with `test-render-run: all ok`"
phases:
  - id: p1-shared-publish-render
    title: Move the publish-plan and render-run node logic to .shared and add commit_verb
    depends_on: []
    complexity: S
    touches:
      - packs/devflow/.shared/publish-plan.ts
      - packs/devflow/.shared/render-plan.ts
      - packs/devflow/devflow-plan/scripts/publish-plan.ts
      - packs/devflow/devflow-plan/scripts/render-run.ts
      - scripts/test-render-run.sh
    brief: |
      Read the plan's Design "Shared-script refactor" first.
      1. `git mv packs/devflow/devflow-plan/scripts/publish-plan.ts packs/devflow/.shared/publish-plan.ts`.
         Change its import from "../../.shared/util.ts" to "./util.ts". After the `mainBranch` line, add
         `const verb = input("commit_verb", false) || "Plan";` and
         `if (verb !== "Plan" && verb !== "Refine") fail(\`invalid commit_verb '${verb}': it must be Plan or Refine\`);`.
         Change the commit message `Plan ${slug}: ${title}` to `${verb} ${slug}: ${title}`. Change nothing else.
      2. `git mv packs/devflow/devflow-plan/scripts/render-run.ts packs/devflow/.shared/render-plan.ts`.
         Change its imports to "./render-run.ts" and "./util.ts". Change the pack-detect error's tail from
         "start devflow-plan with --input pack=<owner>/devflow" to "start the workflow with --input pack=<owner>/devflow".
         Change nothing else.
      3. Create packs/devflow/devflow-plan/scripts/publish-plan.ts with exactly two lines:
         `// Thin entry point: the logic lives in the pack's .shared/publish-plan.ts.` and
         `import "../../.shared/publish-plan.ts";`
         Create packs/devflow/devflow-plan/scripts/render-run.ts with the comment naming
         .shared/render-plan.ts and `import "../../.shared/render-plan.ts";`.
      4. scripts/test-render-run.sh, section f. Keep `publisher` pointing at
         packs/devflow/devflow-plan/scripts/publish-plan.ts (the thin entry, which proves the import works).
         In the `publish()` function, replace `INPUTS_SLUG=s` with `INPUTS_SLUG="${PSLUG:-s}"` and
         `INPUTS_WORKFLOW=devflow-run-s` with `INPUTS_WORKFLOW="${PWF:-devflow-run-s}"` (p2 publishes other slugs with it;
         a variable set in front of a function call cannot override one set inside it).
         After the `publish-plan: ok` echo, prove the render thin entry resolves its import:
         `if ARTIFACTS_DIR="$scratch" bun "$repo_root/packs/devflow/devflow-plan/scripts/render-run.ts" 2>"$scratch/rp.err"; then echo "render-run without inputs succeeded" >&2; exit 1; fi`,
         then `grep -q "input 'slug' is empty" "$scratch/rp.err"` and `echo "render-run entry: ok"`.
         Right after `test "$((n2 - n1))" -eq 1`, add
         `test "$(git -C "$porigin" log -1 --format=%s plans)" = "Plan s: S"`. Then append a line to
         "$pub_art/plan.md", run `INPUTS_COMMIT_VERB=Refine publish > "$scratch/publish3.json"` and add
         `test "$(git -C "$porigin" log -1 --format=%s plans)" = "Refine s: S"`. Then assert that
         `INPUTS_COMMIT_VERB=Bad publish` exits non-zero with "invalid commit_verb" on stderr (use the
         `if …; then echo … >&2; exit 1; fi` + `grep -q` pattern of section d).
      5. Run scripts/test-render-run.sh and scripts/test-devflow-pack.sh. Both must pass.
      Stop condition: if the step 4 render-run entry check fails with a module-resolution error instead of
      "input 'slug' is empty", stop with status=blocked and quote the error. Do not inline the logic back.
    acceptance:
      - "`scripts/test-render-run.sh` prints `publish-plan: ok`, `render-run entry: ok` and `test-render-run: all ok`"
      - "`scripts/test-devflow-pack.sh` exits 0"
      - "`wc -l < packs/devflow/devflow-plan/scripts/publish-plan.ts` and `... render-run.ts` both print 2"
      - "`grep -c 'commit_verb' packs/devflow/.shared/publish-plan.ts` is at least 1, and `grep -c 'start devflow-plan with' packs/devflow/.shared/render-plan.ts` is 0"
  - id: p2-load-published
    title: The load-published script and its tests
    depends_on: [p1-shared-publish-render]
    complexity: M
    touches:
      - packs/devflow/devflow-refine/scripts/load-published.ts
      - scripts/test-render-run.sh
    brief: |
      Read the plan's Design "Script devflow-refine/scripts/load-published.ts" and "Strings" first. Implement them exactly.
      1. Create packs/devflow/devflow-refine/scripts/load-published.ts, following Design steps 1-9 in that order.
         Start the file with a two-line comment saying what it does. Use the string texts from "Strings"
         character for character. Use `run` from util.ts where a non-zero exit is expected (ls-remote, git show,
         git ls-tree, gh), and `must` elsewhere. stdout holds only the final JSON line.
      2. scripts/test-render-run.sh: add a section "# g. load-published against the bare origin of section f"
         after section f's last assertion and before the final `echo "test-render-run: all ok"`. Still in "$pclone":
         - `loader2="$repo_root/packs/devflow/devflow-refine/scripts/load-published.ts"`.
         - Publish two more plans with section f's `publish` function (parametrised in p1): copy "$fx/serial.md" to
           "$pub_art/plan.md", write "$pub_art/devflow-run-serial.yaml" (`printf 'name: devflow-run-serial\nnodes: []\n'`),
           run `PSLUG=serial PWF=devflow-run-serial publish >/dev/null`; then the same with "$fx/three-wide.md",
           `PSLUG=three-wide PWF=devflow-run-three-wide`. "$pub_art/after.md" still exists, so both get an after.md.
           The plans branch now holds the slugs s, serial and three-wide.
         - Write the gh stub exactly like this (single quotes, so nothing expands at write time):
           `mkdir -p "$scratch/stubs2"; printf '%s\n' '#!/bin/sh' 'case "$*" in *"pr list"*) echo "${GH_MERGED:-0}";; *) echo test/repo;; esac' > "$scratch/stubs2/gh"; chmod +x "$scratch/stubs2/gh"`.
         - A helper `lp2() { PATH="$scratch/stubs2:$PATH" ARTIFACTS_DIR="$scratch/lp2-art" INPUTS_PLANS_REF=plans INPUTS_PLANS_DIR=plans INPUTS_MAIN_BRANCH=main "$@" bun "$loader2"; }`
           called as `lp2 env USER_MESSAGE="..." [INPUTS_X=...]`, with `mkdir -p "$scratch/lp2-art"` first.
         - Cases, each asserting with `grep -q` on stdout or on stderr captured to a file:
           1) `rm -rf "$scratch/lp2-art"/*` first; `USER_MESSAGE="refine serial: split p2 into two"` → '"slug":"serial"',
              '"branch":"feat/serial"', '"started":false', and both "$scratch/lp2-art/original/plan.md" and
              "$scratch/lp2-art/original/after.md" exist.
           2) `USER_MESSAGE="please refine https://github.com/test/repo/blob/plans/plans/three-wide/plan.md: add a phase"` → '"slug":"three-wide"'.
           3) `USER_MESSAGE="refine plans/serial: add a phase"` → '"slug":"serial"'.
           4) `USER_MESSAGE="merge serial and three-wide plans"` → exits non-zero, stderr has "names more than one plan (serial, three-wide)".
           5) `USER_MESSAGE="refine the plan please"` → non-zero, stderr has "no plan named".
           6) `USER_MESSAGE="refine serial"` → non-zero, stderr has "say what to change in the plan serial".
           7) `INPUTS_PLAN=three-wide USER_MESSAGE="refine serial: add a phase"` → '"slug":"three-wide"'.
           8) `INPUTS_PLAN=nope USER_MESSAGE="x"` → non-zero, stderr has "no plan 'nope' on plans".
           9) Push a branch: `git push -q origin HEAD:refs/heads/feat/serial`; case 1's message → '"started":true',
              '"reason":"branch"', and the refusal text "is already being implemented". With `INPUTS_CHECK_ONLY=true` → non-zero,
              stderr has "Not refined: the plan serial is already being implemented". Then `git push -q origin :refs/heads/feat/serial`.
           10) `"${git_c[@]}" commit -q --allow-empty -m "Phase one" -m "Plan-Phase: serial/p1" && git push -q origin HEAD:main`;
               case 1's message → '"reason":"merged"'.
           11) For three-wide (nothing pushed): `GH_MERGED=1` with `INPUTS_PLAN=three-wide USER_MESSAGE="add a phase"` → '"reason":"merged"';
               `lp2 env GH_MERGED=0 INPUTS_CHECK_ONLY=true INPUTS_PLAN=three-wide USER_MESSAGE="add a phase"` → stdout is '{"ok":true}'.
         - End the section with `echo "load-published: ok"`.
         Never use a message that has a standalone token "s" (the slug s exists), for example no "it's".
      3. Run scripts/test-render-run.sh and scripts/test-devflow-pack.sh.
      Stop condition: if `git ls-tree --name-only FETCH_HEAD:plans/` lists something other than the slugs and `workflows`, or
      `USER_MESSAGE` handling needs anything beyond `process.env.USER_MESSAGE`, stop with status=blocked and say what you saw.
    acceptance:
      - "`scripts/test-render-run.sh` prints `load-published: ok` and `test-render-run: all ok`"
      - "`grep -c 'Not refined: ' packs/devflow/devflow-refine/scripts/load-published.ts` is at least 5"
      - "`grep -c 'process.env.USER_MESSAGE' packs/devflow/devflow-refine/scripts/load-published.ts` is at least 1"
      - "`scripts/test-devflow-pack.sh` exits 0"
  - id: p3-refine-workflow
    title: The devflow-refine workflow, its commands, thin entries, fixtures and plugin entry
    depends_on: [p2-load-published]
    complexity: M
    touches:
      - packs/devflow/devflow-refine/devflow-refine.yaml
      - packs/devflow/devflow-refine/commands/**
      - packs/devflow/devflow-refine/scripts/preflight.ts
      - packs/devflow/devflow-refine/scripts/setup-env.ts
      - packs/devflow/devflow-refine/scripts/next-question.ts
      - packs/devflow/devflow-refine/scripts/render-run.ts
      - packs/devflow/devflow-refine/scripts/publish-plan.ts
      - packs/devflow/devflow-refine/fixtures/**
      - packs/devflow/archon-plugin.json
    brief: |
      Read the plan's Design "Workflow devflow-refine/devflow-refine.yaml", "Commands" and "Docs" (the archon-plugin.json
      bullet) first.
      1. Thin entries in packs/devflow/devflow-refine/scripts/: copy devflow-plan/scripts/preflight.ts, setup-env.ts,
         next-question.ts, render-run.ts and publish-plan.ts verbatim (they are two-line thin entries since p1).
      2. Write packs/devflow/devflow-refine/devflow-refine.yaml. Copy devflow-plan.yaml and apply exactly the Design
         changes: name, description, the `plan` input, the nodes load, refuse-started, interview `when` + ask label
         `workflow: devflow-refine`, the stop-at-interview text, render's slug/branch from `$load.output`, still-unstarted,
         and publish with `slug: "$load.output.slug"`, `commit_verb: Refine`, `depends_on: [still-unstarted]`.
      3. Commands: copy devflow-plan/commands/draft.md, challenge.md and finalize.md to packs/devflow/devflow-refine/commands/
         and apply the Design "Commands" edits word for word.
      4. archon-plugin.json: add `"devflow-refine": "devflow-refine/devflow-refine.yaml"` right after the devflow-plan
         entrypoint, and apply the description change from Design "Docs".
      5. Fixtures in packs/devflow/devflow-refine/fixtures/. Model them on devflow-plan/fixtures/*.stubs.yaml, with the same
         preflight/setup/draft/challenge/next/ask/finalize/render/publish stubs plus:
         - happy-path.stubs.yaml: `fixture: {expect: completed}`; `load: {slug: x, branch: feat/x, title: X, plan_commit: abc,
           started: false, reason: "", refusal: "", work: "split p2"}`; `still-unstarted: {ok: true}`; finalize slug x, branch feat/x.
         - refuse-started.stubs.yaml: `fixture: {expect: cancelled}`; load as above but `started: true, reason: branch,
           refusal: "Not refined: the plan x is already being implemented (its branch feat/x exists on origin). devflow-refine only changes plans whose implementation has not started."`.
         - interview-user-stops.stubs.yaml: `fixture: {expect: cancelled}`; load as in happy-path; draft status stop and
           next `{done: true, stop: true, question: ""}` as in devflow-plan's interview-user-stops.
         Each file starts with a one-line `#` comment saying the path it covers (GREEN/RED), like devflow-plan's.
      6. Run scripts/test-devflow-pack.sh (archon validate workflows plus every fixture) and scripts/test-render-run.sh.
      Stop condition: if `archon validate` rejects `cancel: "$load.output.refusal"`, a `when` on the loop_group node, or a
      `with:` key on a script node, or if a fixture needs a stub shape not in this brief, stop with status=blocked and quote
      the error. Do not restructure the node graph.
    acceptance:
      - "`scripts/test-devflow-pack.sh` exits 0"
      - "`ls packs/devflow/devflow-refine/fixtures/*.stubs.yaml | wc -l` prints 3"
      - "`grep -c 'ARGUMENTS' packs/devflow/devflow-refine/commands/*.md` is 0 for each file"
      - "`grep -c '\"devflow-refine\": \"devflow-refine/devflow-refine.yaml\"' packs/devflow/archon-plugin.json` is 1"
      - "`grep -c 'load.output' packs/devflow/devflow-refine/commands/draft.md packs/devflow/devflow-refine/commands/challenge.md packs/devflow/devflow-refine/commands/finalize.md` is non-zero for each file"
      - "`grep -c 'INPUTS.work' packs/devflow/devflow-refine/commands/*.md` is 0 for each file"
      - "`grep -c 'commit_verb: Refine' packs/devflow/devflow-refine/devflow-refine.yaml` is 1"
  - id: p4-docs-retire
    title: Document devflow-refine
    depends_on: [p3-refine-workflow]
    complexity: S
    touches:
      - packs/devflow/README.md
      - README.md
    brief: |
      Retirement phase. The profile has no ADR dir and no changelog, and the plan lives on the plans branch, so there are
      no ADRs, no changelog line and no plan document to delete. Only the reference docs are updated.
      1. packs/devflow/README.md: apply Design "Docs" (the "Seven workflows" count, the table row after devflow-plan's,
         and the "## devflow-refine, step by step" section with its run example, placed before
         "## Enable plan workflows in a project"). Use the refusal wording from Design "Strings" when quoting it.
      2. README.md: line 20 and line 169 as in Design "Docs".
      3. Run scripts/test-devflow-pack.sh and scripts/test-render-run.sh.
    acceptance:
      - "`grep -c '## devflow-refine, step by step' packs/devflow/README.md` is 1"
      - "`grep -c 'Seven workflows' packs/devflow/README.md` is 1"
      - "``grep -c '`-refine`, `-quick`' README.md`` is 1 and `grep -c 'devflow-refine' README.md` is at least 1"
      - "`scripts/test-devflow-pack.sh` exits 0"
```
