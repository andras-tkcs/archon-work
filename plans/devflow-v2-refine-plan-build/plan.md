# devflow v2: refine → plan → build

> [!WARNING]
> This plan was published with 15 unresolved validation findings. Read "Unresolved validation
> findings" under "Risks and open questions" before you run it.

## Goal

Replace `devflow-plan` and `devflow-refine` (interview with up to 14 one-question pauses, LLM-chosen slugs) in `packs/devflow/` by a three-step issue-to-PR path with deterministic names and one traceable folder per issue:

1. `devflow-refine <issue>` asks at most two rounds of questions and writes `design.md`.
2. `devflow-plan <issue | plan/design URL | file name>` asks nothing and writes `plan.md`, `before.md`, `after.md` and the build workflow `build-issue-<n>`.
3. `build-issue-<n>` (generated) implements the phases, reviews, opens one PR, watches it, never merges.

Everything is traceable (issue → design → plan → workflow → run → branch → PR) through front matter, commit trailers and one marked issue comment. Maintainer addition: every workflow input named `pack` (devflow-refine, devflow-plan, mod-devflow-refine-block, mod-devflow-plan-block) has `default: "tkcs-lab/devflow"` instead of `""`. Pack-directory: `packs/devflow/`. Delivered as one PR from one feature branch; never merged. The accepted spec of 2026-11-06 is reproduced below as the Design; all of it is decided.

## Current state

- Pack `packs/devflow/` (read, observed): `devflow-plan/devflow-plan.yaml` (265 lines: interview loop `draft`/`challenge`/`next-question`, then `plan-loop` with `finalize`, `render`, `plan-test`, `plan-review`, `plan-check`, then `plan-result`, `publish`); `devflow-refine/devflow-refine.yaml` (309 lines, refines a published plan); `.shared/` holds the real script logic (`util.ts`, `preflight.ts`, `setup-env.ts`, `gh.ts` (`repoSlug`, `api`), `render-run.ts` (331 lines; renders `devflow-run-<slug>`), `publish-plan.ts` (250 lines, temporary-worktree push), `load-plan.ts`, `check-plan.ts`, `test-plan.ts`, `next-question.ts`, `pick-one.ts`, ...). Workflow `scripts/*.ts` files are one-line wrappers `import "../../.shared/<file>.ts";`.
- Tests: `scripts/test-devflow-pack.sh` (copies the pack into a scratch repo, `archon validate workflows`, `archon workflow test`), `scripts/test-render-run.sh` (fixtures in `scripts/fixtures/render-run/*.md`). `scripts/test-devflow-shared.sh` does not exist yet.
- Entrypoints are in `packs/devflow/archon-plugin.json`; existing `mod-*` blocks listed there are only `mod-devflow-phase` and `mod-devflow-deliver`, so only include-only blocks (`mod-devflow-tail`, `mod-devflow-audit-fix`) are known to work unlisted; a `mod-*` block used as a `workflow:` child is shown to resolve only when listed (p10 checks this before relying on it).
- The input named `pack` exists today only in `devflow-plan.yaml:31` and `devflow-refine.yaml:28`, default `""`.

## Design

The Design is the spec below. A worker has only this file: everything it needs is here. "Verify" points have a stated fallback.

### D0. Conventions (apply to every phase)

- Workflow `packs/devflow/<name>/<name>.yaml` + `commands/*.md` (prompts) + `scripts/*.ts` (thin wrappers) + `fixtures/*.stubs.yaml`. Logic in `packs/devflow/.shared/`. Included blocks (`mod-*`) have their own `scripts/` wrappers for the scripts their nodes use. Never start a `mod-*` block directly.
- Scripts run on Bun, read inputs from env `INPUTS_<NAME>` via `input(name, required)` in `.shared/util.ts`, print **one JSON line** to stdout, diagnostics to stderr, failures end with `fail(msg)` (prints `devflow: <msg>`, exit 1). Use `run`, `must`, `tail`, `artifactsDir`, `profile` from `util.ts`, `api`/`repoSlug` from `gh.ts`; do not reinvent them. YAML via `Bun.YAML`.
- Fixtures: `*.stubs.yaml` with header `fixture: { expect: completed|failed|cancelled }` and one stubbed output per node id (pattern: the existing `devflow-plan/fixtures/happy-path.stubs.yaml`; copy it before deleting). A fixture named for a red path must stay red. Do not add a fixture per graph route.
- `$` in text Archon substitutes (bash bodies, attention text) is replaced by `＄` (see `safe`/`msgSafe` in `render-run.ts`).
- Generated workflows are YAML only; they can use `bash:` nodes and `workflow:` child nodes of installed packs only (Archon does not read scripts/commands from the plans ref).
- Every new workflow: `worktree: { enabled: true }`, `returns` and `outcome_field` set, a `description:` in the existing "Use when / NOT for" form.
- Models: tier names `small|medium|large`; aliases are added only in phase p11.
- The shared test runner `scripts/test-devflow-shared.sh` (created in p1) is hermetic (unsets `INPUTS_*`, scratch git repos, no network) and runs every `scripts/shared-tests/part-*.sh` in order; a part is owned by one phase, so phases never edit the same test file. `scripts/shared-tests/lib.sh` (p1) provides `mk_scratch`, `use_stub_gh` and assertion helpers `ok`/`eq`/`contains`.
- Stub `gh` (in `lib.sh`, p1): a script placed first on `PATH`. State dir `$GH_STUB_DIR`. It logs each call (`$*`) to `calls.log`. `gh issue view <n> --json …` prints `$GH_STUB_DIR/issue-<n>.json` (exit 1 with `no issue` when absent). `gh pr list …` prints `$GH_STUB_DIR/prs.json` (default `[]`). `gh repo view …` prints `o/r`. `gh api …/issues/<n>/comments` GET prints `$GH_STUB_DIR/comments-<n>.json` (default `[]`); the endpoint matches with `{owner}/{repo}` or the resolved `o/r`; the method is accepted as `-X <M>` or `--method <M>`; `-H <value>` and `--paginate` are ignored; POST with `--input -` reads JSON `{"body":…}` from stdin, appends `{id, html_url, body, user:{login:"bot"}}`; PATCH on `…/issues/comments/<id>` replaces that comment's body (so the stub works with `api()` in `.shared/gh.ts`, which sends `-X <METHOD>` and `-H Accept: …`). A file `$GH_STUB_DIR/fail-<verb>` makes that verb exit 1.

### D1. Decisions

| # | Decision |
|---|---|
| D1 | Files live on the `plans` branch (input `plans_ref`, default `plans`), not on `main`. |
| D2 | Branch layout: top-level `plans/` (input `plans_dir`, default `plans`) holding `plans/issue-<n>/` (inner `plans` is the constant `ISSUES_SUBDIR`) and `workflows/`. Project config `extraWorkflowSources: [{ ref: plans, path: plans }]` unchanged; no migration. |
| D3 | Build workflow file/name: `workflows/build-issue-<n>.yaml`, `name: build-issue-<n>`. |
| D4 | Each issue folder holds exactly four files: `design.md`, `plan.md`, `before.md`, `after.md`. `before.md`/`after.md` always written; with no manual steps the body is the single line `No manual steps.` |
| D5 | `devflow-plan` refuses without a `design.md`; never starts refine itself. |
| D6 | Refine and plan allowed until the build has started (started check, §D5 step 6). |
| D7 | Refine asks at most 2 rounds (≤5 questions round 1, ≤3 round 2), each one pause; cap enforced by the graph, not by a prompt. |
| D8 | `rulings.md` is edited only by people; workflows read it and propose entries, never write it. |
| D9 | The attention pause is core: refine ends with one pause (`plan` / `revise` / `finish`). `devflow-plan` has no end pause; a gap it cannot decide ends the run as `needs_refine` (typed outcome + issue comment). |
| D10 | No agent decides whether to pause: a script builds the pause from the stage's typed outcome. |
| D11 | Model aliases `@devflow-planner`, `@devflow-reviewer`, each with today's tier as fallback. The generated build workflow keeps per-phase tiers from the plan manifest. |
| D12 | The `challenge` command and `next-question` script are deleted. No reviewer agent for the design. |
| D13 | `devflow-refine` does not run `setup-env`; `devflow-plan` does. |
| D14 | Old workflows `devflow-plan`/`devflow-refine` replaced in place (same names, new behaviour). Old `devflow-run-<slug>` workflows and `plans/<slug>/` folders stay on the plans branch untouched. |

### D2. Names, paths, formats: `packs/devflow/.shared/layout.ts` (only file that concatenates these strings)

```ts
export const ISSUES_SUBDIR = "plans";
export const slugOf = (n: number) => `issue-${n}`;
export const folderOf = (plansDir: string, n: number) => `${plansDir}/${ISSUES_SUBDIR}/${slugOf(n)}`;
export const KINDS = ["design", "plan", "before", "after"] as const;
export const fileOf = (plansDir: string, n: number, kind: (typeof KINDS)[number]) => `${folderOf(plansDir, n)}/${kind}.md`;
export const workflowName = (n: number) => `build-issue-${n}`;
export const workflowFile = (plansDir: string, n: number) => `${plansDir}/workflows/${workflowName(n)}.yaml`;
export const SLUG_RE = /^issue-([0-9]+)$/;
export const commentMarker = (n: number) => `<!-- devflow:${slugOf(n)} -->`;
```

Tree on the `plans` branch: `plans/plans/issue-42/{design,plan,before,after}.md` and `plans/workflows/build-issue-42.yaml`.

**Front matter** (`.shared/frontmatter.ts`: `parse(text)`, `serialize(fm, body)`, `validate(fm, kind)`), at the very top between `---` lines, exactly these keys in this order:

```yaml
---
issue: 42
kind: design           # design | plan | before | after
title: Short title of the change
revision: 2            # integer >= 1; before/after carry the plan's revision
design_revision: 2     # only kind plan|before|after
run: <WORKFLOW_ID>
updated: 2026-11-06    # UTC date
---
```

`validate` fails when a key is missing, `kind` does not match the file name argument, `revision`/`design_revision`/`issue` are not positive integers, or `design_revision` is present on a design. No `status` key.

**design.md**: H1 is the title, then H2 headings in this order, all required: `## Problem`; `## Goal and non-goals`; `## Decisions` (one `### D<n>. <title>` each with exactly four bullets `Choice:`, `Rejected:`, `Why:`, `Source:` where Source is one of `answer Q<id> round <1|2>`, `ADR <id>`, `code <path>`, `rulings.md`, `issue comment <url>`); `## Design`; `## Impact`; `## Acceptance`; `## Assumptions` (each `- **<decision>**: <choice>. Why: <reason>. Change it by running devflow-refine with: "<example change>".`, or the single line `None.`); `## Risks` (or `None.`); `## Related work` (one line each with the relation, or `None.`); `## Revision log` (one line per revision, newest last: `- r<N> (<date>, run <id>): <what changed and which answers drove it>`; the current revision's line must exist). Optional last section `## Proposed rulings` (after Revision log) with entries in the rulings format (D11).

**plan.md** = front matter + the plan structure from `draft-plan.md` (same sections and implementation-manifest fenced yaml as today; `validate_manifest.py` stays the authority) + manifest `plan_slug: issue-<n>` + the line `Design: design.md r<design_revision>` directly under the H1 + final `## Revision log` as above. **before.md**: front matter + `# Before implementing <title>` + today's `prerequisites.md` per-item layout (`## <n>. <title>`, why, numbered steps with direct links, where a secret goes never the value, `**Done when:** …`), or `No manual steps.`. **after.md**: front matter + `# After implementing <title>` + today's `after.md` layout (each item ends `**Report:** …`), or `No manual steps.`. Manifest `manual_before`/`manual_after` are non-empty exactly when the file has items; the generated workflow renders its `before` gate only when `manual_before` is non-empty.

**Issue comment** (`.shared/issue-comment.ts`: `upsertComment(issue, patch)`, `renderComment`, `nextLine`). One comment per issue found by `commentMarker(n)`, edited in place. Body:

```
<!-- devflow:issue-42 -->
<!-- devflow-state: {"design":{"revision":2,"commit":"<sha>","title":"…"},"plan":{"revision":1,"design_revision":1,"commit":"<sha>"},"build":{"state":"building","run":"<id>","branch":"feat/…","pr":null},"proposed_rulings":[],"needs_refine":null} -->
### devflow · issue #42

| Step | State | Revision | Files |
|---|---|---|---|
| Design | ready | r2 | [design.md](<blob url>) |
| Plan | ready · **stale: built from design r1** | r1 | [plan.md](…) · [before.md](…) · [after.md](…) |
| Build | not started / building (run <id>) / PR #57 open / merged / closed without merge | — | `build-issue-42` · [PR #57](…) |

**Next:** <exactly one line>

**Proposed rulings** (copy the ones you agree with into `.archon/devflow/policy/rulings.md`): …   (omitted when empty)

**Open question for refine:** …   (omitted when needs_refine is null)

_Updated <UTC timestamp> by run <id>._
```

`Next` is computed: no design → "Run `devflow-refine #42`"; design but no plan or plan stale → "Review `design.md`, then run `devflow-plan #42`"; plan current and build not started → "Review the plan, then run `workflow sync` and `archon workflow run build-issue-42 --detach`"; building → "Build running (run <id>)"; PR open → "Review and merge PR #57"; merged/closed → "Done."; `needs_refine` set → "Answer the open question with `devflow-refine #42: <answer>`" (needs_refine wins over the others). Blob URLs: `https://github.com/<owner>/<repo>/blob/<plans_ref>/<path>`. Plan is stale when `plan.design_revision < design.revision`.

`upsertComment`: (1) `gh api repos/{owner}/{repo}/issues/<n>/comments --paginate`, find the comment whose body starts with the marker (author-independent); (2) parse its `devflow-state` JSON (empty state when none), deep-merge `patch` (null value deletes a key), render, `PATCH` (`gh api … --method PATCH --input -` with stdin `{"body":…}`) or `POST` when absent; (3) read it back, verify marker and state parse, else `fail("the issue comment was not written: …")`; (4) never create a second comment; if two marked comments exist update the first and `fail` naming the duplicate URL. Comment writes happen after the git push; a comment failure fails the node and its message names the pushed commit.

**`plans-branch.ts`**: `fetchPlans(ref): commit` (fails clearly when the branch does not exist and the caller needs it); `readAt(commit, path): string | null`; `commitFiles({ref, dir, files:{path:content}, remove:string[], message, trailers}): commit`: extracted from the temporary-worktree logic in today's `.shared/publish-plan.ts` (orphan branch when `plans_ref` is absent on origin, `git worktree add --detach`, `git push origin HEAD:refs/heads/<ref>` never forced, worktree removed in `finally`). A rejected push fails with the tail of git's output.

### D3. Shared modules (all in `packs/devflow/.shared/`)

`layout.ts`, `frontmatter.ts`, `issue-comment.ts`, `plans-branch.ts`, `model-rules.md`, `resolve-input.ts` (D5), `publish-design.ts` (D6.1.1), `publish-plan.ts` (rewrite: uses `plans-branch.ts`+`layout.ts`; keeps the unresolved-findings warning block and `published.md`), `check-design.ts`, `record-answers.ts`, `format-round.ts`, `settle.ts` (D8), `trace.ts` (D7.3), `load-design.ts`, `render-run.ts` (D7.1), `load-plan.ts` (also writes `issue` = number parsed from `plan_slug` with `SLUG_RE`, `""` when it does not match, into `context.json`, plus `design_url`, `plan_url`, `design_revision`, `plan_revision` read from the plan's front matter and `plans_ref`). `util.ts`, `preflight.ts` (except p1's copy step), `setup-env.ts`, `gh.ts`, `verify.ts`, `gate-*.ts`, `prepare-branch.ts`, `test-plan.ts`, `check-plan.ts`, `render-plan.ts`, `pick-one.ts` stay, except `render-plan.ts` and `check-plan.ts`, which are adapted in p6a-render. `next-question.ts` is deleted (p12).

### D5. `resolve-input.ts`

Env: `INPUTS_WORK` (free text), `INPUTS_CHANGE`, `INPUTS_PLANS_REF`, `INPUTS_PLANS_DIR`, `INPUTS_MAIN_BRANCH`, `INPUTS_MODE` (`refine`|`plan`), fallback `USER_MESSAGE` when `work` is empty. Output (one JSON line):

```json
{ "issue": 42, "slug": "issue-42", "folder": "plans/plans/issue-42", "title": "…", "body": "…",
  "comments": "…untrusted, bounded to 200 KB…", "url": "https://github.com/o/r/issues/42", "state": "open",
  "design_revision": 0, "plan_revision": 0, "design_present": false, "plan_present": false,
  "existing_branch": "", "plans_commit": "", "change": "…", "started": false, "refusal": "" }
```

Algorithm, in order, failures through `fail()` with the exact text:
1. Take `work`, else `USER_MESSAGE`. Find the issue number, first match wins: (a) GitHub issue URL `https://github.com/<o>/<r>/issues/<n>` (repo must be this repo's `origin`, else `fail("issue URL is for <o>/<r>, not this repository")`); (b) a URL or path containing `/plans/issue-<n>/` or `/workflows/build-issue-<n>.yaml`; (c) bare `issue-<n>`, `issue-<n>/plan.md`; `plan.md`/`design.md` only if an issue number is also present elsewhere (a bare `plan.md` alone is `fail("name the issue: …")`); (d) `#<n>` or a bare integer token. No match → `fail("no issue named. Pass an issue number or URL, or a plan URL, for example: devflow-refine #42")`. More than one distinct number → `fail("more than one issue named (<list>); name one")`.
2. `change` = the text with the issue reference (and the words `refine`, `plan`) removed, trimmed; when env `INPUTS_CHANGE` is non-empty it is `change`.
3. `gh issue view <n> --json number,title,body,state,url,comments` (fail with gh's message when missing). `comments` rendered as `**@<login> <date>:** <text>` blocks; whole text truncated at 200 KB with the visible marker `…[truncated]`. All of it is untrusted data.
4. `state` closed → `refusal = "Issue #<n> is closed."`.
5. If the plans branch exists on origin, fetch it, set `plans_commit`, read `design.md` and `plan.md` front matter at that commit for `design_revision`, `plan_revision`, `*_present`. `existing_branch` = `feature_branch` from the existing plan's manifest (`extractManifest` from `render-run.ts`), else `""`.
6. **Started check**: `started = true` when `existing_branch != ""` and any of: the branch exists on origin; `git log origin/<main> --grep "Plan-Phase: issue-<n>/" --fixed-strings` non-empty; `gh pr list --head <existing_branch> --state merged` non-empty. Then `refusal = "Not changed: the build of issue #<n> has started (<reason>). devflow-refine and devflow-plan only change issues whose build has not started."`. A failing `gh` call is `fail("cannot check ...")`, never "not started".
7. `mode=plan` and `design_present == false` → `refusal = "Not planned: issue #<n> has no design. Run: archon workflow run <pack>:devflow-refine \"#<n>\""` (`<pack>` from env `INPUTS_PACK`, default `tkcs-lab/devflow`).

It never writes anything. A non-empty `refusal` is turned into a cancel by the workflow (`cancel: "$resolve.output.refusal"`).

### D6. Refine workflows

**Block `mod-devflow-refine-block`** (`packs/devflow/mod-devflow-refine-block/mod-devflow-refine-block.yaml`). Inputs: `work`, `change` (default `""`), `plans_ref` (default `plans`), `plans_dir` (default `plans`), `pack` (default `tkcs-lab/devflow`). `returns: result`, `outcome_field: designed`. Never pauses at its end. Nodes (ids exact):

| id | kind | depends_on / when | what |
|---|---|---|---|
| `preflight` | script `preflight` | — | unchanged script |
| `resolve` | script `resolve-input` | `preflight` | `with`: `work: "$INPUTS.work"`, `change: "$INPUTS.change"`, `plans_ref`, `plans_dir`, `main_branch: "$preflight.output.main_branch"`, `pack`, `mode: refine`. `output_format.required` lists every field of D5's JSON. |
| `refuse` | cancel | `resolve`; `when: "$resolve.output.refusal != ''"` | `cancel: "$resolve.output.refusal"` |
| `research` | command `research` | `resolve`; `when: "$resolve.output.refusal == ''"` | model `large`, `context: fresh`; must not modify the checkout (writes only under `$ARTIFACTS_DIR`). Output `{ questions: Question[0..5], assumptions: Assumption[], related: Related[], summary: string, question_count: integer }`. |
| `format-1` | script `format-round` | `research`; `when: "$research.output.question_count > 0"` | round message |
| `ask-1` | wait | `format-1` | `wait: { attention: "$format-1.output.message", form: message, labels: { workflow: devflow-refine, stage: round-1 } }` |
| `record-1` | script `record-answers` | `ask-1` | appends Q/A to `$ARTIFACTS_DIR/interview.md`; output `{ stop: boolean }` (true when the answer matches `^\s*(stop|cancel|not now)\b` case-insensitively) |
| `stop-1` | cancel | `record-1`; `when: "$record-1.output.stop == true"` | stop message |
| `research-2` | command `research-2` | `record-1`; `when: "$record-1.output.stop == false"` | same model/tools. Output `{ followups: Question[0..3], assumptions: Assumption[], followup_count: integer }`. |
| `format-2` | script `format-round` | `research-2`; `when: "$research-2.output.followup_count > 0"` | round-2 message |
| `ask-2` | wait | `format-2` | `stage: round-2` |
| `record-2` | script `record-answers` | `ask-2` | as record-1 |
| `stop-2` | cancel | `record-2`; `when: stop == true` | |
| `write-design` | command `write-design` | `depends_on: [research, record-1, research-2, record-2]`, `trigger_rule: none_failed_min_one_success`, plus the `when` that neither stop fired | model `medium`. Writes `$ARTIFACTS_DIR/design.md` (body only). Output `{ title: string, scope_note: string }`. |
| `check` | script `check-design` | `write-design` | adds front matter (issue, kind, title, revision = `resolve.design_revision + 1`, run, updated) → `$ARTIFACTS_DIR/design.final.md`; validates D2; on failure `fail()` lists every violation. Output `{ ok: true, revision: number }`. The only structure check. |
| `still-unstarted` | script `resolve-input` with `INPUTS_MODE=refine` | `check` | same `with:` as `resolve`; `output_format.required` lists every D5 field; re-runs the started check right before publish |
| `refuse-2` | cancel | `still-unstarted`; `when: "$still-unstarted.output.refusal != ''"` | `cancel: "$still-unstarted.output.refusal"` |
| `publish` | script `publish-design` | `still-unstarted`; `when: "$still-unstarted.output.refusal == ''"` | D6.1.1 |
| `result` | script `result` (`.shared/refine-block-result.ts`) | after `publish` | prints `{ designed, issue, revision, design_url, questions_asked, assumptions (integer count), assumption_titles (string[]) }`; `designed` true after `publish` |

`when` compares scalars; never index arrays in `when`. Verify that `when` supports `>`; if not, use `!= 0`.

Round message built by `format-round` (exact):

```
Refine issue #<n> "<title>" — round <1|2> of max 2

**Q1. <title>**
<context: 2 sentences>
Options: a) <text>  b) <text>  c) <text>
Recommended: <key> — <why>

**Q2. …**

Reply `ok` to accept every recommendation, or answer by number (`1: b, 2: ok, 3: <your text>`). Reply `stop` to cancel.
```

Stop message: `Stopped while refining issue #<n>: the answer said to stop. Nothing was published. The questions and answers are interview.md in the run artifacts.`

Question schema (both agents' `output_format`): `{ id: "Q1".., title, context, options: [{key:"a", text}] (2..4), recommendation: {key, why}, why_a_person: enum [no_doc_settles_it, docs_disagree, changes_shipped_contract, plan_would_deliver_less] }`. Assumption: `{ title, choice, why }`. Related: `{ url, relation }`.

**D6.1.1 `publish-design.ts`** inputs `issue`, `title`, `revision`, `plans_ref`, `plans_dir`, `main_branch`, `proposed_rulings` (JSON array, may be `[]`): (1) copy `$ARTIFACTS_DIR/design.final.md` to `fileOf(plansDir, n, "design")`; (2) `commitFiles` with message `Design issue-<n> r<revision>: <title>`, trailers `Issue: #<n>`, `Run: <WORKFLOW_ID>`; (3) `upsertComment(n, { design: {revision, commit, title}, proposed_rulings, needs_refine: null })`; (4) print `{ commit, revision, design_url, comment_url }`.

**Entry `devflow-refine`** (`packs/devflow/devflow-refine/devflow-refine.yaml`). Inputs `work`, `plans_ref`, `plans_dir`, `pack` (default `tkcs-lab/devflow`). `returns: result`, `outcome_field: designed`.

```yaml
nodes:
  - id: cycle
    loop_group:
      max_iterations: 1          # copied from Archon's archon-plan; VERIFY
      fresh_context: true
      until_bash: 'done=$attend.output.done; test "$done" = true'
      nodes:
        - id: go
          bash: "true"
          when: "$LOOP_PREV.attend__ask.output.decision == '' || $LOOP_PREV.attend__ask.output.decision == 'revise'"
        - id: stage
          include: mod-devflow-refine-block
          depends_on: [go]
          with:
            work: "$INPUTS.work"
            change: "$LOOP_PREV.attend__settle.output.brief"
            plans_ref: "$INPUTS.plans_ref"
            plans_dir: "$INPUTS.plans_dir"
            pack: "$INPUTS.pack"
        - id: attend
          include: mod-devflow-attention
          depends_on: [stage]
          trigger_rule: all_done
          with: { stage: devflow-refine, outcome: "$stage.output" }
  - id: plan
    include: mod-devflow-plan-block
    depends_on: [cycle]
    when: "$cycle.output.choice == 'plan'"
    with: { work: "#$cycle.output.outcome.issue", plans_ref: "$INPUTS.plans_ref", plans_dir: "$INPUTS.plans_dir", pack: "$INPUTS.pack" }
  - id: result
    depends_on: [cycle, plan]
    trigger_rule: all_done
    script: result
    output_format: { designed: boolean, issue: integer, revision: integer, design_url: string, planned: boolean, needs_refine: boolean }
```

**Verify (required):** Archon's `archon-plan` uses `max_iterations: 1` with the pause ("each answer permits one more pass"). Confirm with stub fixture `revise-then-finish` that a `revise` answer yields a second refine pass in the same run. If the engine needs a larger cap, use `max_iterations: 6` and add "max 5 revisions per run" to the entry description. Do not change the loop shape otherwise. `result` prints the refine outcome plus `planned`/`needs_refine` from `$plan.output` when the plan ran (both false otherwise). A `finish` answer returns `designed: true`.

**Block `mod-devflow-attention`** (`packs/devflow/mod-devflow-attention/mod-devflow-attention.yaml`). Inputs `stage` (required), `outcome` (required, may be empty). `returns: settle`. Nodes: `settle` = script `settle`, `with`: `stage`, `outcome`, `previous: "$LOOP_PREV.settle.output"`, `answer: "$LOOP_PREV.ask.output"`, `trigger_rule: all_done`; `ask` = `depends_on: [settle]`, `when: "$settle.output.message != ''"`, `wait: { attention: "$settle.output.message", form: select, options: "$settle.output.options", labels: { stage: "$INPUTS.stage" } }`. Block output = `settle`'s output `{ done: boolean, choice: string, outcome: object|null, message: string, options: [{id,label}], brief: string }`.

### D7. Plan workflows

**Block `mod-devflow-plan-block`** (`packs/devflow/mod-devflow-plan-block/mod-devflow-plan-block.yaml`). Inputs `work`, `plans_ref`, `plans_dir`, `pack` (default `tkcs-lab/devflow`). `returns: result`, `outcome_field: planned`. Based on today's `devflow-plan.yaml` minus the interview. Nodes: (1) `preflight`, `setup` (`setup-env`, `timeout: 1800000`) unchanged; (2) `resolve` (`resolve-input` with `mode: plan`), `refuse` cancel on `refusal != ''`; (3) `load-design` script (reads `design.md` at `plans_commit` into `$ARTIFACTS_DIR/design.md`; also `$ARTIFACTS_DIR/existing-plan.md` when a plan exists, so a re-plan starts from it and keeps `feature_branch`), after `resolve`; (4) `plan-loop` (`loop_group`, `max_iterations: 3`, `until_bash: 'd=$plan-check.output.done; [ "$d" = true ]'`) with nodes: `draft-plan` (command `draft-plan`, model `medium`, `context: fresh`; reads `$ARTIFACTS_DIR/design.md`, the issue, the profile; writes `$ARTIFACTS_DIR/plan.md`, `before.md`, `after.md`; output `{ scope: small|large, title, branch, before: boolean, after: boolean, needs_refine_present: boolean, needs_refine: { question: string, why: string } | null }`; the slug is **not** an output: it is `issue-<n>`), then `render`, `plan-test`, `plan-review` (model `large`, read-only `denied_tools: [Write, Edit, NotebookEdit]`), `plan-check` as today (`render-run`, `test-plan`, `review-plan`, `check-plan`); `render`, `plan-test`, `plan-review` have `when: "$draft-plan.output.needs_refine_present == false"`, and `plan-check` returns `done: true, findings: 0` when `needs_refine_present` is true; (5) `needs-refine` (script `publish-needs-refine`, `when: draft-plan.needs_refine_present == true`): `upsertComment(n, { needs_refine: {question, why, run} })`, commits nothing; output `{ planned: false }`; (6) `plan-result` (as today) → `publish` (script `publish-plan`) when `needs_refine_present == false`; (7) `result` prints `{ planned, issue, plan_revision, design_revision, workflow, needs_refine, unresolved_findings }`.

`publish-plan.ts`: (1) files `plan.md`, `before.md`, `after.md` with front matter added (`revision` = existing `plan_revision` + 1, `design_revision` = the design.md revision), plus `workflows/build-issue-<n>.yaml` from `$ARTIFACTS_DIR/build-issue-<n>.yaml`; one commit `Plan issue-<n> r<revision>: <title>`, trailers `Issue: #<n>`, `Design: r<design_revision>`, `Run: <id>`; (2) `upsertComment(n, { plan: {revision, design_revision, commit}, needs_refine: null, build: {state: "not_started"} })`; (3) writes `$ARTIFACTS_DIR/published.md` as today (adapted names; still tells the person to run `archon workflow sync` and `archon workflow run build-issue-<n> --detach`, prints the `extraWorkflowSources` snippet when the project lacks it); (4) prints `{ commit, workflow, revision, unresolved, message }`. Keeps the unresolved-findings warning block.

**Entry `devflow-plan`**: inputs `work`, `plans_ref`, `plans_dir`, `pack` (default `tkcs-lab/devflow`). Single node `stage: include mod-devflow-plan-block` plus a `result` node. No loop, no attention. `returns: result`, `outcome_field: planned`. Description: accepts an issue number or URL, a plan or design URL, or a file name; refuses without a design; ends `planned: false, needs_refine: true` when the design leaves a gap it cannot decide.

### D7.1 Generated workflow `build-issue-<n>`: changes to `render-run.ts` (waves, `max_parallel`, model validation, merge trailers unchanged)

`RenderOpts`: drop free-form `slug`/`branch` naming; add `issue: number`, `designRevision: number`, `planRevision: number`, `repo: string` (`owner/name`). CLI flags: `--issue`, `--design-revision`, `--plan-revision`, `--repo` (replace `--slug`). Requirements: (1) `name: build-issue-<n>` (`workflowName`); `slug` validated by `SLUG_RE`, `KEBAB` kept for phase ids; (2) `planPath = fileOf(plansDir, n, "plan")`; the prerequisites wait text references `before.md` (via `fileOf`); the after-steps node writes `after.md`; (3) `description:` lists issue `#<n>` with URL, design `r<designRevision>`, plan `r<planRevision>`, the plan path on the plans branch, "phases run up to 3 at a time, then <pack>:mod-devflow-deliver reviews, opens the PR and watches it"; (4) new node `trace-start`: `workflow: <pack>:mod-devflow-trace`, `with: { issue: "<n>", event: building, branch: "<branch>" }`; runs after the `before` approval (when that gate exists) and after the worktree checks; `start` depends on it; (5) `deliver` gets `issue: "<n>"` as a `with:` key; (6) replace inline bash of `worktree-check`, `confirm-worktree-removal`, `stop-at-worktrees`, `remove-worktrees`, `start` and each `merge-<k>` by child workflows (D7.2) — fallback below; (7) update `scripts/test-render-run.sh` assertions and `scripts/fixtures/render-run/*.md`; `archon validate workflows` must accept every rendered file.

**D7.2 Blocks `mod-devflow-start` and `mod-devflow-merge`** port the current inline bash 1:1: `mod-devflow-start` inputs `branch`, `main_branch`, `plans_ref`; contains the logic of `worktree-check`, `confirm-worktree-removal` (wait, approval), `stop-at-worktrees`, `remove-worktrees`, `start`; output `{ head, plan_commit }`. `mod-devflow-merge` inputs `slug`, `heads` (comma-separated SHAs), `phases` (comma-separated `id=title`, titles through `msgSafe`); merges each head `--no-ff`, message `Merge <slug> <id>: <title>`, trailer `Plan-Phase: <slug>/<id>`; skips heads already ancestors; aborts and fails on conflict with today's message `devflow: merging <id> conflicts; its touches overlap another phase`; output `{ head }`. Both invoked **without** `isolation:` so they run in the parent's worktree. **Verify (required):** with a real `archon workflow run` in a scratch repository, a two-phase plan ends with the feature branch containing both `Plan-Phase:` merge commits (`archon workflow test` cannot prove this). **Fallback:** if that fails, keep today's inline bash for those nodes, delete the two blocks, and record it; every other change stays.

**D7.3 Block `mod-devflow-trace`**: inputs `issue` (string), `event` (`building`|`pr_open`|`finished`), `branch`, `pr_number`, `pr_url`, `state` (`merged`|`closed`). `trace.ts` calls `upsertComment`: `building` → `build: {state: "building", run: <WORKFLOW_ID>, branch, pr: null}`; `pr_open` → `build: {state: "pr_open", pr: {number, url}}`; `finished` → `build: {state: <state>, pr: {number, url}}`. Empty `issue` → no-op `{ skipped: true }`. A comment failure must not fail the build: catch, write `trace-error.md` into artifacts, print `{ ok: false }`, exit 0.

**D7.4 `mod-devflow-tail` / `mod-devflow-deliver`**: `mod-devflow-deliver` gets input `issue` (default `""`) passed to the `tail` include. `mod-devflow-tail` gets input `issue` (default `""`); after `open-pr` a node `trace-pr` (`include: mod-devflow-trace`, `with: {issue: "$INPUTS.issue", event: pr_open, `pr_number: "$open-pr.output.number"`, `pr_url: "$open-pr.output.url"}`); after `finish` a node `trace-finish` (`include: mod-devflow-trace`, `depends_on: [finish]`, `with: {issue: "$INPUTS.issue", event: finished, pr_number: "$open-pr.output.number", pr_url: "$finish.output.url", state: "$finish.output.state"}`). Every `mod-devflow-trace` input except `issue` and `event` has `default: ""`; `trace.ts` maps state `MERGED` (case-insensitive) to `merged` and anything else to `closed`. Includes (not `workflow:`) because tail and deliver have no `pack` input; the generated workflow's `trace-start` stays `workflow: <pack>:mod-devflow-trace`. Other includers pass nothing, so the nodes no-op. `commands/open-pr.md`: when `$ARTIFACTS_DIR/context.json` has a non-empty `issue`, the PR body contains `Closes #<issue>` and a "Traceability" section linking design and plan on the plans branch (revisions included) and the run id, read from `context.json` keys `design_url`, `plan_url`, `design_revision`, `plan_revision`.

### D8. `settle.ts`

Env `INPUTS_STAGE`, `INPUTS_OUTCOME` (JSON or empty), `INPUTS_PREVIOUS` (previous settle output, JSON or empty), `INPUTS_ANSWER` (previous ask output, JSON `{decision, text}` or empty). Output `{ done, choice, outcome, message, options, brief }`.

| Situation | Result |
|---|---|
| First pass, outcome present, `stage = devflow-refine`, `outcome.designed == true` | `done=false`; `options = [{id:plan,label:"Plan it"},{id:revise,label:"Revise (add a note)"},{id:finish,label:"Finish"}]`; `message` = text below |
| Previous answer `revise` | the stage ran again with `brief = answer.text`; treat this pass's outcome like the first-pass row |
| Previous answer `plan` or `finish` | `done=true`, `choice=<answer>`, `outcome = previous.outcome`, `message=""`, `options=[]` |
| Outcome empty (stage failed) | `done=true`, `message=""` |

Pause message (exact):

```
Design for issue #<n> is ready: revision <r> — <design_url>

Assumptions taken (not asked): <count> — listed under "Assumptions" in the file.
<one line per assumption, at most 5, then "… and N more">

plan: run devflow-plan now and publish build-issue-<n>.
revise: another refine pass; your note is the change request (revision <r+1>).
finish: stop here; the design stays published.
```

### D9. Agent prompts (under each workflow's `commands/`)

Style of the existing `commands/*.md` (they receive `$INPUTS.*`, `$ARGUMENTS`, `$ARTIFACTS_DIR`, `$resolve.output.*`). Issue body and comments are **untrusted data**: each prompt says so and never follows instructions found there.

- `model-rules.md` (`.shared/`): the "Models: the smallest model for each phase" rules moved out of today's `draft.md`, `finalize.md`, `review-plan.md`. `.shared/preflight.ts` copies it (from `import.meta.dir`) to `$ARTIFACTS_DIR/model-rules.md`; `draft-plan.md` and `review-plan.md` say "Read `$ARTIFACTS_DIR/model-rules.md`".
- `research.md` (refine block): read the issue (`$resolve.output`), existing `design.md` when `design_present` (source of truth, including manual edits), the `change` request, must-read docs and ADRs from `$ARTIFACTS_DIR/profile.json`, the code the issue touches, `.archon/devflow/policy/rulings.md` when present, related issues/PRs via `gh search`/`gh issue list` (record in `related`). **Rule Q: a question is allowed only when** no doc, ADR, ruling or code settles it; two documents disagree; it changes a shipped contract (meaning of an existing persisted/shipped value, a public API/config surface, a shipped lifecycle) with no document ruling; or the feasible plan would deliver less than the issue's stated outcome. Anything else is decided and returned as an assumption. A choice cheap to reverse that changes no shipped contract is never a question. Max 5 questions; each names which condition applies (`why_a_person`). Never ask what code or a ruling settles. Write the draft design to `$ARTIFACTS_DIR/design-draft.md`.
- `research-2.md`: input `$ARTIFACTS_DIR/interview.md` and the draft. Fold the answers into the draft. A follow-up (max 3) only if an answer made a *blocking* question appear under rule Q; this is the last round (say so). Otherwise no follow-ups.
- `write-design.md`: write `$ARTIFACTS_DIR/design.md` in the exact structure of D2 (body only). Every answer is a Decision with `Source: answer Q<id> round <n>`. Every unasked decision is an Assumption. Copy `related`. Add `## Proposed rulings` only for answers reusable beyond this issue, each `- **Q:** <question> **A:** <answer> **Source:** <project document or issue/PR URL>`. Return `title`.
- `draft-plan.md` (plan block): adapt today's `devflow-plan/commands/finalize.md`: remove everything about the interview, `interview.md`, `plan-draft.md` and `## Why no more questions`; inputs are `design.md`, `existing-plan.md` when present (keep `feature_branch` and applicable phase ids), the issue, the profile. Every Decision in the design is binding. A gap the design leaves: decide it and record it under the plan's `## Assumptions`, unless it cannot be decided safely (a product/contract choice no document settles), then return `needs_refine` (one precise question) and write no files. Branch rule: `feature_branch` follows `git.branch_pattern`, a type from `git.branch_types`, slug `issue-<n>` followed by a short kebab title (≤ 30 chars), identical on re-plans. Manifest `plan_slug: issue-<n>`. Files `plan.md`, `before.md`, `after.md` per D2 (`before.md`/`after.md` always written). All other rules of `finalize.md` stay verbatim.
- `review-plan.md`: today's text, the model-rules block replaced by a reference to `$ARTIFACTS_DIR/model-rules.md`, plus one check: every Decision and Acceptance item of `design.md` is covered by some phase's brief or acceptance (a design requirement with no phase is a `mechanical` finding).

### D10. Model aliases (phase p11 only)

List form: `model: ['@devflow-planner', large]` (first alias the user's config defines wins; otherwise the tier). `research`, `research-2` → `['@devflow-planner', large]`; `write-design`, `draft-plan` → `['@devflow-planner', medium]`; `plan-review` → `['@devflow-reviewer', large]`. Everything else keeps its tier. README "Models" documents both aliases with `archon ai alias set @devflow-planner <provider> <model>` and `archon ai alias set @devflow-reviewer <provider> <model>`.

### D11. `rulings.md`

Location in a project: `.archon/devflow/policy/rulings.md` on the default branch; edited only by people through a normal PR; the pack ships no default; absence means no rulings. Entry: `- **Q:** <the question it settles> **A:** <the answer> **Source:** <project document or issue/PR URL>`. `research.md` reads it; a ruling that answers a question settles it (cite `rulings.md` in Decisions). Workflows only propose (`write-design` fills `## Proposed rulings`; `publish-design` copies the entries into the comment's `proposed_rulings`).

### D12. Tests

`scripts/test-devflow-shared.sh` covers tool-boundary behaviour in parts (files `scripts/shared-tests/part-NN-*.sh`): 1 resolve-input (each input form of D5 step 1: issue number, `#n`, issue URL, plan URL, design path, `workflows/build-issue-<n>.yaml`, `issue-<n>/plan.md`; no issue named; two issues; closed issue; started via branch on origin / `Plan-Phase` trailer on main / merged PR; missing design in plan mode); 2 frontmatter (round trip, every validation failure); 3 check-design (valid passes; each missing/misordered heading, empty section, missing revision-log line fails with all violations listed); 4 issue-comment (render deterministic; merge keeps unrelated state; `nextLine` for each state; upsert creates once and edits afterwards; two marked comments fail); 5 plans-branch.commitFiles (creates orphan branch when absent, adds on top of existing, rejected push fails and never forces, worktree removed); 6 publish-design and publish-plan end to end against a local bare origin and the stub `gh` (paths, commit message, trailers, revision increments, `before.md`/`after.md` always present); 7 render-run in `test-render-run.sh` (new names/flags, `trace-start` position, child-workflow nodes, `archon validate` of rendered files).

Fixtures: `devflow-refine`: `no-questions` (completed, finish), `one-round` (round 1 answered, finish), `two-rounds` (round 2 asked, then plan → plan block runs), `revise-then-finish` (second pass), `user-stops` (cancelled), `refuse-started` (cancelled). `devflow-plan`: `happy-path` (completed), `no-design` (cancelled), `needs-refine` (completed, `needs_refine`), `plan-test-never-clears` (stays red). Other workflows' fixtures unchanged except those referencing renamed nodes, plus the trace stubs p6b adds.

### D13. Do not

Do not write `rulings.md` or any file on `main` from a workflow. Do not force-push, merge, or delete branches. Do not add a design-review agent, a third question round, a `decide` agent, or a fixture per graph route. Do not change `mod-devflow-phase`, `devflow-docs`, `devflow-audit`, `devflow-config`, `devflow-deps`, `mod-devflow-audit-fix` except where D7.4 and p12 say so (p12 edits only line 3 of the descriptions of `mod-devflow-phase` and `mod-devflow-deliver`: `devflow-run-<slug>` becomes `build-issue-<n>`).

## Phases and models

| Phase | Title | Complexity | Depends on | Model | Why this model |
|---|---|---|---|---|---|
| p1-core | layout, frontmatter, model-rules, test runner and stub gh | M | — | medium | Front-matter parsing and validation is new logic whose exact code the plan cannot spell out (rule 3). |
| p2-comment-branch | issue-comment and plans-branch with tests | M | p1-core | medium | New state-merge, rendering and git worktree logic whose exact code the plan cannot spell out (rule 3). |
| p3-resolve | resolve-input with tests | M | p1-core, p2-comment-branch | large | Rule 4: input parsing at a trust boundary (user text and untrusted issue content driving gh and git calls). |
| p4-attention | mod-devflow-attention and settle | S | p1-core | medium | New state-handling logic for the pause, with exact decisions in a table but code the plan cannot spell out (rule 3). |
| p5-design-scripts | check-design, record-answers, format-round, publish-design with tests | M | p2-comment-branch | medium | New validation, parsing and publishing logic whose exact code the plan cannot spell out (rule 3). |
| p6a-render | render-run, render-plan and check-plan changes, render tests | M | p1-core, p2-comment-branch | medium | Adapts non-trivial existing render logic across several files (rule 3). |
| p6b-trace | trace block, tail/deliver/load-plan/open-pr changes | M | p1-core, p2-comment-branch | medium | Adapts existing workflow and script logic across several files and writes a new tolerant-failure script (rule 3). |
| p7a-plan-scripts | publish-plan, load-design, publish-needs-refine, plan-block-result with tests | M | p3-resolve, p6a-render | medium | New publishing logic whose exact code the plan cannot spell out (rule 3). |
| p7b-plan-block | plan block, devflow-plan entry, prompts, fixtures | M | p7a-plan-scripts, p6a-render, p6b-trace | medium | Writes prompt prose and adapts workflow wiring the plan only outlines (rule 3). |
| p8-refine-block | refine block and its prompts | M | p3-resolve, p5-design-scripts | medium | Writes prompt prose and graph wiring whose exact wording the plan only outlines (rule 3). |
| p9-refine-entry | devflow-refine entry, result script, fixtures, loop verification | M | p4-attention, p7b-plan-block, p8-refine-block | medium | Verifies engine loop semantics and authors fixtures whose stubs depend on observed node ids (rule 3). |
| p10-blocks | mod-devflow-start and mod-devflow-merge, render-run switch | M | p6a-render | medium | Ports non-trivial bash across several nodes and needs a real-run check (rule 3). |
| p11-aliases | model aliases in the new workflows, README Models | S | p7b-plan-block, p8-refine-block, p9-refine-entry | small | default |
| p12-retire | delete old files, README rewrite, plugin entrypoints, quick refusal text, changelog line | M | p9-refine-entry, p10-blocks, p11-aliases | medium | Writes README prose whose wording the plan does not give (rule 3). |

Final build review: **large**. Phase p3-resolve has model large (input parsing at a trust boundary with gh calls) and the plan has 14 phases.

## Manual steps

- Before implementing: none.
- After implementing: (1) run `devflow-refine` on a real issue in a scratch project and confirm the folder, comment and pause behave as in D2–D8; (2) run `devflow-plan`, `archon workflow sync`, then `build-issue-<n>` on a two-phase plan and confirm the comment moves through building → PR open. Full steps in `after.md` of the run artifacts; both go in the PR as unchecked items.

## Risks and open questions

- The interview ended with no open questions; the spec declares every decision made and `pack` default is unambiguous (`tkcs-lab/devflow`). Checked: scope, behaviour, names/strings, data/schema, security (untrusted issue text, never-force push, 200 KB bound), prerequisites (none), after-merge steps.
- `loop_group.max_iterations: 1` may not allow a `revise` second pass. p9 verifies with the `revise-then-finish` fixture; if the pass does not happen, use `max_iterations: 6` and add "max 5 revisions per run" to the description. A worker that cannot make the fixture show a second `stage` pass either way stops with `status=blocked`.
- Child workflows `mod-devflow-start`/`mod-devflow-merge` may not share the parent's worktree. p10 must prove it with a real `archon workflow run`; a failure means apply the fallback and say so, never ship unverified.
- `when: "$x > 0"` may be unsupported: use `!= 0`. If `archon validate` rejects `trigger_rule: none_failed_min_one_success`, stop with `status=blocked`.
- Between p7b and p9 the old `devflow-refine` is still present; until then old and new coexist, so p7b must delete only files inside `devflow-plan/`, and p9 must delete everything inside `devflow-refine/` except its new files.
- The stub `gh` is a hand-written model of the real one: p12's `manual_after` checks catch drift.
- Nobody may add `status` to front matter or write files on `main` from a workflow.


### Unresolved validation findings

The large-tier review still reported these after its last round. The plan was published anyway.
The full findings are `test-findings.md` in the planning run's artifacts.

- F1 [review, mechanical] p6a-render: `packs/devflow/.shared/render-plan.ts:84-85` passes `prerequisites: read("prerequisites.md")` and `after: read("after.md")`, and `render-run.ts:112,132,147,206,213,277` renders the prerequisites gate and the after-steps node whenever these are non-null. Under D2, draft-plan writes `before.md` (never `prerequisites.md`) and always writes `before.md` and `after.md`. If p6a leaves this alone, the before gate is never rendered. If a worker just renames the file, the gate is always rendered, even though D2 says only when `manual_before` is non-empty. The p6a brief says neither.
- F2 [review, mechanical] p6a-render: p6a step 2 makes render-plan.ts call `repoSlug()` (`gh.ts:11`, which runs `gh repo view` and throws on failure). The `# d3` section of `scripts/test-render-run.sh:76-131` runs render-plan in `$repo`, a local git repo with no GitHub remote, and stubs only `archon` (`$scratch/rstub/archon`). There `gh repo view` fails, render-plan fails, and `scripts/test-render-run.sh` (p6a's acceptance) cannot pass. The brief does not say to stub gh.
- F3 [review, mechanical] p6a-render: p6a step 4 prescribes `--issue 7 ...` for every render in `scripts/test-render-run.sh`. Sections a/b (`test-render-run.sh:20-37`) render three-wide.md and serial.md into the same scratch repo and validate each by name. With one issue number, both files get `name: build-issue-7`, and validating by name cannot tell them apart. The fixtures' `plan_slug: three-wide` / `serial` must also become `issue-<n>` for render-plan's `plan_slug === slugOf(issue)` check, and the brief only says "new names". The structure assertion `Merge three-wide p1: it’s ＄x` (line 52) changes too.
- F4 [review, mechanical] p6a-render: The render-run entry check p6a step 4 says to change (`scripts/test-render-run.sh:418-420`, `input 'slug' is empty`) sits inside section `# f. publish-plan` (line 318) and before `# g.` (line 421). Step 4 also says "Delete sections `# f. publish-plan …`". Read literally, the worker deletes the lines it was told to change.
- F5 [review, mechanical] p6a-render: D7.1 says "RenderOpts: drop free-form `slug`/`branch` naming" and lists only `--issue`, `--design-revision`, `--plan-revision`, `--repo` (replacing `--slug`). p6a step 1 lists what RenderOpts keeps (`plansRef, plansDir, pack, mainBranch, branchRegex`) without `branch`, `title`, `prerequisites`, `after` or `sourceRun`. `render-run.ts:143,217,287` still needs `o.branch`, and `trace-start` needs it as well. A worker cannot tell whether `branch`/`--branch` stay or come from `manifest.feature_branch`.
- F6 [review, mechanical] p6b-trace: p6b step 2 builds the design URL with `fileOf(plansDir, issue, "design")`, but `load-plan.ts` has no plans_dir input: it reads only `plan_ref`, `plan_path`, `plan_commit` (`load-plan.ts:10-12`; `mod-devflow-deliver.yaml:12-18` and mod-devflow-phase pass only these). The brief also takes `issue` from front matter, while D3 says it is parsed from `plan_slug` with `SLUG_RE`. It omits the `plans_ref` key that D3 requires in context.json.
- F7 [review, mechanical] p6b-trace: Acceptance "grep -c 'Closes #' packs/devflow/mod-devflow-tail/commands/open-pr.md prints at least 1" already holds before the change (`open-pr.md:23`: "the issue it closes (`Closes #<n>`)"), so it proves nothing about the D7.4 edit.
- F8 [review, mechanical] p2-comment-branch: `renderComment(n, state, ctx)` needs `ctx.plansRef`/`plansDir` for the blob URLs (D2), but `upsertComment(n, patch)` has no such argument. The trace block (D7.3: inputs issue, event, branch, pr_number, pr_url, state) and its includers tail/deliver have no plans_ref/plans_dir, so a trace update cannot re-render the Design/Plan rows' links correctly. p2 step 2 also leaves a choice ("using `api` from gh.ts or `Bun.spawnSync`"), and `api()` (`gh.ts:18-22`) cannot pass `--paginate`.
- F9 [review, mechanical] p7b-plan-block: Plan-block wiring that D7 and the brief leave open. (a) `needs-refine` and `publish` sit outside `plan-loop` but are keyed on `draft-plan.needs_refine_present`, an inner node. The code shows a loop's output is that of its `until` node: `devflow-plan.yaml:121,125` reads `$interview.output.stop` from inner node `next`. So outside nodes must read `$plan-loop.output.*`, and check-plan's short-circuit output (p6a step 3: `{done, round, findings}`) does not carry the flag, question or why. (b) When needs_refine is set, `render`/`plan-test` are skipped, but the current plan-check passes `test: "$plan-test.output"` and `render: "$render.output"` (`devflow-plan.yaml:224-228`) without `if_skipped`. (c) `plan-result` reads `tested.json` (`plan-result.ts:7`), which does not exist on the needs_refine path, and the brief gives it no `when`.
- F10 [review, mechanical] p7b-plan-block: p7b step 2 says every line of `finalize.md` outside the removed interview sections stays verbatim. That contradicts D2/D7/D9 in sections that are not removed. `finalize.md:98-108` "Files for the person" writes `prerequisites.md` only when `manual_before` is non-empty and "Otherwise write no file", but D2 requires `before.md`/`after.md` always (`No manual steps.`). `finalize.md:143-146` "## Output" returns `slug` and `prerequisites`, but D7 says the output is `{scope, title, branch, before, after, needs_refine_present, needs_refine}` with no slug. `finalize.md:59` "Keep `slug`, `branch` and `title` unchanged" names the removed output. The opening lines `finalize.md:1-3` ("The interview is over…open-questions.md") are not a section, so the removal rule misses them.
- F11 [review, mechanical] p7b-plan-block: The new `devflow-plan` entry has a `result` script node (D7 "Entry devflow-plan"), but p7b step 3 creates wrappers only in `mod-devflow-plan-block/scripts/`. Step 4 deletes everything in `devflow-plan/scripts/` and names no `devflow-plan/scripts/result.ts` and no `.shared` module for it. The entry's result node has no script to run.
- F12 [review, mechanical] p7a-plan-scripts: p7a creates scripts that p7b must wire, but names only some of their env inputs. load-design lists `INPUTS_PLANS_COMMIT` and `INPUTS_PLAN_PRESENT`, but `fileOf` also needs the issue and plans_dir. The rewritten publish-plan's inputs (issue, title, plan revision, design revision, plans_ref, plans_dir, main_branch, workflow) are not listed: today's `publish-plan.ts:13` reads `slug`, `workflow`, etc. plan-block-result's inputs are "from env inputs" with no names. Every brief step must name its symbols.
- F13 [review, mechanical] p10-blocks: Current state (plan.md:17) says a `mod-*` block used as a `workflow:` child resolves only when listed in `archon-plugin.json`. Only p12 edits that file (Assumption "archon-plugin.json touched only by p12"). p10 step 4 requires `<prefix>:mod-devflow-start`, `mod-devflow-merge` and `mod-devflow-trace` in `archon workflow list --json` and otherwise stops blocked. Since those blocks are unlisted in `packs/devflow/archon-plugin.json`, the likely outcome is a blocked p10, which stops the run.
- F14 [review, mechanical] p11-aliases: p11 is `model: small`, but step 3 asks it to write README prose ("what each is for", the fallback sentence) without the wording. Rule 2 requires every string a small phase writes to be spelled out, and prose without given wording is rule 3 (medium).
- F15 [review, mechanical] plan: Several acceptance items are not a command with an expected result: p4 #2 ("archon validate workflows accepts mod-devflow-attention (…may still fail…)"), p5 #2 ("…covered by part-03"), p6b #4 ("archon workflow test in a scratch copy … passes every fixture of …"), p7b #1 ("archon workflow test runs the four devflow-plan fixtures …"), p8 #1 ("archon validate workflows reports no error for mod-devflow-refine-block"), p10 #2 ("archon validate workflows accepts every rendered file in scripts/test-render-run.sh"). `scripts/test-render-run.sh:33` shows the form that works: `archon validate workflows <name> --json`.

## Assumptions

- **Test layout**: one runner `scripts/test-devflow-shared.sh` calling `scripts/shared-tests/part-*.sh`, one part file per phase. Why: the spec names one script, but phases in the same wave must not share a path in `touches`. Made by devflow-plan, not asked (round 0, finding none).
- **Phase split**: 14 phases instead of the spec's 8. Why: the spec's p4/p5/p6 exceed complexity M ("up to about 8 source files"); splitting keeps each brief mechanical (p6 became p6a-render and p6b-trace in fix round 1; p7 became p7a-plan-scripts and p7b-plan-block in fix round 2). Made by devflow-plan, not asked (round 0, finding none).
- **Aliases late**: phases p7b, p8 and p9 write tier-only `model:` values and p11 converts them to alias lists. Why: matches the spec's p7 phase. Made by devflow-plan, not asked (round 0, finding none).
- **`archon-plugin.json` touched only by p12**: it adds all entrypoints at once. Why: parallel phases in a wave must not share the file, and existing `mod-*` blocks that are unlisted already work. Made by devflow-plan, not asked (round 0, finding none).
- **`pack` default**: `tkcs-lab/devflow` replaces `""` on all four `pack` inputs; `resolve-input` reads `INPUTS_PACK` (same default) for the no-design refusal text. Why: the maintainer's addition. Made by devflow-plan, not asked (round 0, finding none).
- **Comment write transport**: `gh api … --method POST|PATCH --input -` with a JSON body. Why: the spec says `PATCH`/`POST` without a transport; stdin avoids quoting problems with `＄`-free bodies. Made by devflow-plan, not asked (round 0, finding none).
- **Fix-round-2 decisions**: `render-plan.ts` computes `planRevision = Number(plan_revision) + 1` and calls `repoSlug()` itself; `plan-check` short-circuits on `needs_refine_present`; `trace.ts` maps `MERGED` to `merged`; `refuse-2` node cancels in the refine block. Why: `with:` values cannot compute, and the briefs must leave no choice. Made by devflow-plan, not asked (round 2, findings F3-F5, F10).

## Implementation manifest

```yaml
plan_slug: devflow-v2-refine-plan-build
feature_branch: feat/devflow-v2-refine-plan-build
max_parallel: 3
manual_before: []
manual_after:
  - id: ma1-refine-real-issue
    title: "Run devflow-refine on a real issue in a scratch project"
    why: "Confirms the folder, issue comment and pause behave as designed; fixtures cannot prove the live engine and GitHub."
  - id: ma2-plan-and-build
    title: "Run devflow-plan, archon workflow sync, then build-issue-N on a two-phase plan"
    why: "Confirms the issue comment moves through building then PR open and the PR has Closes and Traceability."
verify_after_merge:
  - scripts/test-devflow-pack.sh
  - scripts/test-render-run.sh
  - scripts/test-devflow-shared.sh
review_model: large
review_model_reason: Phase p3-resolve has model large (input parsing at a trust boundary with gh calls) and the plan has 14 phases.
final_checks:
  - "scripts/test-devflow-pack.sh, scripts/test-render-run.sh and scripts/test-devflow-shared.sh all pass"
  - "grep -rn 'devflow-run-\\|next-question\\|challenge' packs/devflow shows only the migration note in packs/devflow/README.md"
  - "packs/devflow/README.md describes refine -> plan -> build and the four-file issue folder"
  - "every input named pack in packs/devflow/**/*.yaml has default tkcs-lab/devflow"
phases:
  - id: p1-core
    title: "layout, frontmatter, model-rules, test runner and stub gh"
    depends_on: []
    complexity: M
    model: medium
    model_reason: "Front-matter parsing and validation is new logic whose exact code the plan cannot spell out (rule 3)."
    touches:
      - packs/devflow/.shared/layout.ts
      - packs/devflow/.shared/frontmatter.ts
      - packs/devflow/.shared/model-rules.md
      - packs/devflow/.shared/preflight.ts
      - scripts/test-devflow-shared.sh
      - scripts/shared-tests/lib.sh
      - scripts/shared-tests/part-02-frontmatter.sh
    brief: |
      Read Design D0, D2 (layout, front matter), D9 (model-rules.md), D12.
      1. Create `packs/devflow/.shared/layout.ts` with exactly the code block in Design D2.
      2. Create `packs/devflow/.shared/frontmatter.ts` exporting `parse(text): {fm, body}` (fm is an object with keys in file order; throws a plain Error naming the problem when the block is missing or malformed), `serialize(fm, body): string` (emits keys in the order issue, kind, title, revision, design_revision (only when present), run, updated, then `---`, a blank line, body) and `validate(fm, kind): string[]` (returns every violation, empty array when valid; rules in Design D2 "Front matter"). Use `Bun.YAML` for the block.
      3. Create `packs/devflow/.shared/model-rules.md`: move the "Models: the smallest model for each phase" section (rules 1-7) out of `packs/devflow/devflow-plan/commands/finalize.md` into this file verbatim, as a standalone document. Do NOT edit the old command files (they are deleted in p12).
      4. In `packs/devflow/.shared/preflight.ts`, after the profile is written, copy `model-rules.md` (path via `import.meta.dir`) to `$ARTIFACTS_DIR/model-rules.md` (use `artifactsDir()`).
      5. Create `scripts/shared-tests/lib.sh` providing `mk_scratch` (temp dir + `git init -b main`, cleaned by trap), `use_stub_gh` (writes the stub `gh` described in Design D0, including its `-X`/`--method`, `-H`, `--paginate` and `o/r` handling, into `$GH_STUB_DIR/bin` and prepends it to PATH), assertion helpers `ok`, `eq`, `contains` (print FAIL line and set a failure flag), and `finish` (exit 1 when any failure).
      6. Create `scripts/test-devflow-shared.sh` (`set -euo pipefail`, `unset` every `INPUTS_*` variable, run every `scripts/shared-tests/part-*.sh` with `bash`, for each part print `PASS <basename without .sh>` when it exits 0, else `FAIL <basename>` and remember the failure; exit 1 at the end if any part failed). Create `scripts/shared-tests/part-02-frontmatter.sh` covering: round trip of a valid file, and one failing case per validation rule (missing key, wrong kind, non-integer revision, design_revision on a design, wrong key order is NOT a failure for parse but serialize always emits canonical order).
      7. Run `bash -n` on both new shell scripts and `scripts/test-devflow-shared.sh`.
      Stop with status=blocked if `Bun.YAML` is not available in the installed bun.
    acceptance:
      - "scripts/test-devflow-shared.sh exits 0 and prints a PASS line for part-02-frontmatter"
      - "grep -c ISSUES_SUBDIR packs/devflow/.shared/layout.ts prints at least 2"
      - "test -s packs/devflow/.shared/model-rules.md"
  - id: p2-comment-branch
    title: "issue-comment and plans-branch with tests"
    depends_on: [p1-core]
    complexity: M
    model: medium
    model_reason: "New state-merge, rendering and git worktree logic whose exact code the plan cannot spell out (rule 3)."
    touches:
      - packs/devflow/.shared/issue-comment.ts
      - packs/devflow/.shared/plans-branch.ts
      - scripts/shared-tests/part-04-issue-comment.sh
      - scripts/shared-tests/part-05-plans-branch.sh
    brief: |
      Read Design D2 (issue comment, plans-branch.ts), D0 (stub gh), D12 parts 4 and 5. Read the existing `packs/devflow/.shared/publish-plan.ts` (temporary-worktree push logic) and `packs/devflow/.shared/gh.ts`; do NOT edit those two files in this phase.
      1. Create `packs/devflow/.shared/plans-branch.ts` exporting `fetchPlans(ref)`, `readAt(commit, path)`, `commitFiles({ref, dir, files, remove, message, trailers})` exactly as in Design D2. Copy the worktree mechanics from publish-plan.ts: orphan branch when `ref` is absent on origin, `git worktree add --detach`, `git push origin HEAD:refs/heads/<ref>` never forced, worktree removal in `finally`. Trailers are appended to the commit message as `Key: value` lines after a blank line. A rejected push calls `fail()` with `tail(output, 20)`.
      2. Create `packs/devflow/.shared/issue-comment.ts` exporting `renderComment(n, state, ctx)` (pure, deterministic; ctx = {repo, plansRef, plansDir, runId, now}), `nextLine(n, state)` (rules in Design D2), `upsertComment(n, patch)` (algorithm in Design D2 using `api` from `gh.ts` or `Bun.spawnSync` with `--input -`; `repoSlug()` for owner/name). Deep merge: objects merge recursively, arrays and scalars are replaced, a `null` patch value deletes the key. The Plan row shows `ready · **stale: built from design r<k>**` when plan.design_revision < design.revision. Build row texts: `not started`, `building (run <id>)`, `PR #<n> open`, `merged`, `closed without merge`.
      3. Create `scripts/shared-tests/part-04-issue-comment.sh` and `part-05-plans-branch.sh` implementing Design D12 parts 4 and 5 (use `bun -e` importing the modules, the stub gh from lib.sh, and a local bare repository as origin for part 5, including a push rejected by a non-fast-forward race).
      4. Run `scripts/test-devflow-shared.sh`.
      Stop with status=blocked if the stub gh in lib.sh cannot express a call you need; do not edit lib.sh (p1 owns it): record the missing capability in your final message.
    acceptance:
      - "scripts/test-devflow-shared.sh exits 0 and prints PASS for part-04-issue-comment and part-05-plans-branch"
      - "grep -n -- '--force\\|+HEAD' packs/devflow/.shared/plans-branch.ts prints nothing"
  - id: p3-resolve
    title: "resolve-input with tests"
    depends_on: [p1-core, p2-comment-branch]
    complexity: M
    model: large
    model_reason: "Rule 4: input parsing at a trust boundary (user text and untrusted issue content driving gh and git calls)."
    touches:
      - packs/devflow/.shared/resolve-input.ts
      - scripts/shared-tests/part-01-resolve-input.sh
    brief: |
      Read Design D5 completely, D2 (layout, front matter), D0 (stub gh). Read `packs/devflow/.shared/render-run.ts` for `extractManifest` (import it; do not edit render-run.ts here).
      1. Create `packs/devflow/.shared/resolve-input.ts` implementing Design D5 step by step, in that order, with the exact `fail()` texts and refusal texts. Use `layout.ts` for every path and `plans-branch.ts` (`fetchPlans`, `readAt`) and `frontmatter.ts` for plan state. Never interpolate user or issue text into a shell string: call `run([...])` with argument arrays. Validate the issue number is a positive integer before using it. The issue-reference extraction is a pure function `findIssue(text, repo): number` exported for tests. Cap `comments` at 200 KB (200*1024 bytes) with the marker `…[truncated]`. `INPUTS_MODE` must be `refine` or `plan`, else `fail("mode must be refine or plan")`. The script writes nothing.
      2. Create `scripts/shared-tests/part-01-resolve-input.sh` covering exactly the cases listed in Design D12 part 1, using scratch repos with a local bare origin and the stub gh (issue JSON in `$GH_STUB_DIR/issue-<n>.json`, merged PRs in `prs.json`).
      3. Run `scripts/test-devflow-shared.sh`.
      Stop with status=blocked if the stub gh cannot serve a call; do not edit lib.sh.
    acceptance:
      - "scripts/test-devflow-shared.sh exits 0 and prints PASS for part-01-resolve-input"
      - "grep -n 'sh -c\\|bash -c\\|eval' packs/devflow/.shared/resolve-input.ts prints nothing"
      - "grep -c 'no issue named\\|more than one issue named\\|is closed\\|has started\\|has no design' scripts/shared-tests/part-01-resolve-input.sh prints at least 5"
  - id: p4-attention
    title: "mod-devflow-attention and settle"
    depends_on: [p1-core]
    complexity: S
    model: medium
    model_reason: "New state-handling logic for the pause, with exact decisions in a table but code the plan cannot spell out (rule 3)."
    touches:
      - packs/devflow/.shared/settle.ts
      - packs/devflow/mod-devflow-attention/**
      - scripts/shared-tests/part-08-settle.sh
    brief: |
      Read Design D6 "Block mod-devflow-attention" and D8.
      1. Create `packs/devflow/.shared/settle.ts` implementing the Design D8 table and the exact pause message (replace `<n>`, `<r>`, `<design_url>`, assumptions from `outcome`; the outcome object carries `issue`, `revision`, `design_url`, `assumption_titles` (array of strings) and `assumptions` (integer count): the refine block's `result` node (p8, `.shared/refine-block-result.ts`) supplies them). Empty-string env values mean "absent". Output one JSON line `{done, choice, outcome, message, options, brief}`. The message must contain no `$` (replace by `＄`).
      2. Create `packs/devflow/mod-devflow-attention/mod-devflow-attention.yaml` (nodes `settle`, `ask` exactly as in Design D6, `returns: settle`, a Use-when/NOT-for description saying it is a building block) and `packs/devflow/mod-devflow-attention/scripts/settle.ts` containing one line `import "../../.shared/settle.ts";` plus a comment.
      3. Create `scripts/shared-tests/part-08-settle.sh`: one case per row of the Design D8 table plus: `revise` answer carries its text in `brief`; message has at most 5 assumption lines and the `… and N more` line.
      4. Run `scripts/test-devflow-shared.sh`, and (if `archon` is on PATH) copy the pack into a scratch repo as `scripts/test-devflow-pack.sh` does and run `archon validate workflows`.
      Stop with status=blocked if `archon validate` rejects `wait: form: select` with `options` from a node output.
    acceptance:
      - "scripts/test-devflow-shared.sh exits 0 and prints PASS for part-08-settle"
      - "archon validate workflows accepts mod-devflow-attention (scripts/test-devflow-pack.sh may still fail on other workflows until p12; the attention block must raise no error)"
  - id: p5-design-scripts
    title: "check-design, record-answers, format-round, publish-design with tests"
    depends_on: [p2-comment-branch]
    complexity: M
    model: medium
    model_reason: "New validation, parsing and publishing logic whose exact code the plan cannot spell out (rule 3)."
    touches:
      - packs/devflow/.shared/check-design.ts
      - packs/devflow/.shared/record-answers.ts
      - packs/devflow/.shared/format-round.ts
      - packs/devflow/.shared/publish-design.ts
      - scripts/shared-tests/part-03-check-design.sh
      - scripts/shared-tests/part-06-publish-design.sh
    brief: |
      Read Design D2 (design.md structure, front matter), D6 (round message, record-answers, check, D6.1.1 publish-design), D12 parts 3 and 6.
      1. `check-design.ts`: reads `$ARTIFACTS_DIR/design.md` and env `INPUTS_ISSUE`, `INPUTS_REVISION_BASE` (the resolve `design_revision`), `INPUTS_TITLE`, `INPUTS_RUN`; adds front matter (kind design, revision base+1, `updated` = UTC date), validates the 10 required H2 headings in order, non-empty sections, every Decision (`### D<n>.`) having exactly the four bullets with a valid `Source:`, the Revision log line for the current revision (`- r<N> (`), and `## Proposed rulings` (if present) only last. On any failure `fail()` lists every violation, one per line. Writes `$ARTIFACTS_DIR/design.final.md`; prints `{ok:true, revision}`. Export `checkBody(body, revision): string[]` for tests.
      2. `record-answers.ts`: env `INPUTS_ROUND` (1|2), `INPUTS_QUESTIONS` (JSON array of questions or the text message), `INPUTS_ANSWER` (the wait output). Appends a block `## Round <n>` with `Q<id>: <title>` / `A: <answer>` to `$ARTIFACTS_DIR/interview.md`; output `{stop: boolean}` using the regex in Design D6.
      3. `format-round.ts`: env `INPUTS_ROUND`, `INPUTS_ISSUE`, `INPUTS_TITLE`, `INPUTS_QUESTIONS` (JSON); prints `{message}` using the exact template in Design D6; all `$` replaced by `＄`.
      4. `publish-design.ts` per Design D6.1.1 using `layout.ts`, `plans-branch.ts`, `issue-comment.ts`. `proposed_rulings` is parsed from the `## Proposed rulings` section of `design.final.md` when the env value is empty.
      5. Tests: `part-03-check-design.sh` (D12 part 3), `part-06-publish-design.sh` (D12 part 6, design half: expected path, commit message, trailers, revision increments from 1 to 2, one comment only). Both use the bare-origin + stub gh pattern from p2's part-05.
      6. Run `scripts/test-devflow-shared.sh`.
    acceptance:
      - "scripts/test-devflow-shared.sh exits 0 and prints PASS for part-03-check-design and part-06-publish-design"
      - "a design.md missing two headings makes check-design print both violations (covered by part-03)"
  - id: p6a-render
    title: "render-run, render-plan and check-plan changes, render tests"
    depends_on: [p1-core, p2-comment-branch]
    complexity: M
    model: medium
    model_reason: "Adapts non-trivial existing render logic across several files (rule 3)."
    touches:
      - packs/devflow/.shared/render-run.ts
      - packs/devflow/.shared/render-plan.ts
      - packs/devflow/.shared/check-plan.ts
      - scripts/test-render-run.sh
      - scripts/fixtures/render-run/**
    brief: |
      Read Design D7.1 and D2 (layout). Read the whole of `packs/devflow/.shared/render-run.ts`, `render-plan.ts`, `check-plan.ts`, `scripts/test-render-run.sh` and `scripts/fixtures/render-run/*.md` first.
      1. `render-run.ts`: apply every item of Design D7.1 EXCEPT item 6 (child workflows; p10 does that). Names via `layout.ts` (`workflowName`, `fileOf`, `slugOf`); validate `slug` with `SLUG_RE`. `trace-start` is added as the node `start` depends on, after the `before` approval gate and after `worktree-check`/`remove-worktrees`. CLI flags per D7.1. `RenderOpts` keeps `plansRef`, `plansDir`, `pack`, `mainBranch`, `branchRegex`.
      2. `render-plan.ts` (the script behind the `render-run` wrapper): inputs `issue`, `design_revision`, `plan_revision`, `branch`, `title`, `main_branch`, `branch_regex`, `plans_ref`, `plans_dir`, `pack`, `soft_errors`. It checks `manifest.plan_slug === slugOf(issue)` and the feature_branch as today, calls `renderRunWorkflow` with the new `RenderOpts`, and writes `$ARTIFACTS_DIR/${workflowName(issue)}.yaml`. No `INPUTS_SLUG` and no `devflow-run-` remain. `plan_revision` is the existing revision (0 for a new plan) and render-plan.ts renders `planRevision = Number(plan_revision) + 1`. `repo` is not an input: render-plan.ts calls `repoSlug()` from `gh.ts` and fails with its message.
      3. `check-plan.ts`: new input `issue`; use `slugOf(issue)` and `workflowName(issue)` in place of `finalize.slug` and `devflow-run-${finalize.slug}`; the draft-plan output has no `slug`. New input `needs_refine_present`: when it equals "true", print `{"done":true,"round":<round>,"findings":0}` and exit 0 before reading `test`, `review`, `render`; otherwise `test` and `render` stay required.
      4. Update `scripts/test-render-run.sh` and every fixture in `scripts/fixtures/render-run/` to the new names and flags (`--issue 7 --design-revision 1 --plan-revision 1 --repo o/r`). Point its `rr` variable at `packs/devflow/.shared/render-plan.ts` and its `tp` variable at `packs/devflow/.shared/test-plan.ts`, so the test no longer depends on workflow wrappers (p7b deletes `devflow-plan/scripts/`). Assert: workflow `name: build-issue-7`, description contents, `trace-start` position in the rendered YAML (depends on the approval gate when `prereq.md` is used; `start` depends on `trace-start`), `deliver` has `issue: "7"`, three-wide/serial wave flags unchanged, the title-replacement check still passes. Do not touch the `# d7. next-question.ts` section (p12 deletes it). Delete sections `# f. publish-plan …` and `# g. load-published …` of the script (publish-plan is covered by part-07 in p7a; load-published is deleted in p9). Change the render-run entry check (the one using `devflow-plan/scripts/render-run.ts` and grepping `input 'slug' is empty`) to run `packs/devflow/.shared/render-plan.ts` and grep `input 'issue' is empty`.
      5. Run `scripts/test-render-run.sh`. Run `bash -n` on every shell script touched.
      Stop with status=blocked if a rendered file is rejected by `archon validate workflows` for a reason other than the missing `mod-devflow-trace` of the pack copy; report it.
    acceptance:
      - "scripts/test-render-run.sh exits 0"
      - "grep -rc 'devflow-run-' packs/devflow/.shared/render-run.ts packs/devflow/.shared/render-plan.ts packs/devflow/.shared/check-plan.ts prints 0 for each file"
      - "grep -n 'trace-start' scripts/test-render-run.sh prints at least one assertion"
      - "grep -n 'load-published\\|devflow-plan/scripts\\|devflow-refine/scripts' scripts/test-render-run.sh prints nothing"
  - id: p6b-trace
    title: "trace block, tail/deliver/load-plan/open-pr changes"
    depends_on: [p1-core, p2-comment-branch]
    complexity: M
    model: medium
    model_reason: "Adapts existing workflow and script logic across several files and writes a new tolerant-failure script (rule 3)."
    touches:
      - packs/devflow/.shared/trace.ts
      - packs/devflow/.shared/load-plan.ts
      - packs/devflow/mod-devflow-trace/**
      - packs/devflow/mod-devflow-tail/mod-devflow-tail.yaml
      - packs/devflow/mod-devflow-tail/commands/open-pr.md
      - packs/devflow/mod-devflow-deliver/mod-devflow-deliver.yaml
      - packs/devflow/devflow-quick/fixtures/*.stubs.yaml
      - packs/devflow/devflow-deps/fixtures/*.stubs.yaml
      - packs/devflow/devflow-config/fixtures/*.stubs.yaml
      - packs/devflow/devflow-docs/fixtures/*.stubs.yaml
      - packs/devflow/devflow-audit/fixtures/*.stubs.yaml
      - packs/devflow/mod-devflow-audit-fix/fixtures/*.stubs.yaml
      - packs/devflow/mod-devflow-deliver/fixtures/*.stubs.yaml
      - scripts/shared-tests/part-09-trace.sh
    brief: |
      Read Design D7.3, D7.4, D3 (load-plan) and D2 (layout, front matter). Read `packs/devflow/.shared/load-plan.ts`, `mod-devflow-tail/mod-devflow-tail.yaml`, `mod-devflow-deliver/mod-devflow-deliver.yaml`, `mod-devflow-tail/commands/open-pr.md` first.
      1. Create `packs/devflow/.shared/trace.ts` per Design D7.3 (import `upsertComment` from `issue-comment.ts`) and `packs/devflow/mod-devflow-trace/mod-devflow-trace.yaml` (inputs per D7.3; every input except `issue` and `event` has `default: ""`; script node `trace`, `returns: trace`, building-block description). `trace.ts` maps state `MERGED` (case-insensitive) to `merged` and anything else to `closed` with wrapper `scripts/trace.ts` (one-line import).
      2. `load-plan.ts`: also write `issue`, `design_url`, `plan_url`, `design_revision`, `plan_revision` into `context.json` (Design D3). Parse front matter with `frontmatter.ts`; if the plan file has no front matter (an old plan), write `issue: ""` and empty strings, never fail. Build the URLs as `https://github.com/${repoSlug()}/blob/${plan_ref}/${path}` (`repoSlug` from `gh.ts`), with `fileOf(plansDir, issue, "design")` and `plan_path`; when `repoSlug` throws, write empty strings and do not fail.
      3. `mod-devflow-tail.yaml`: add input `issue` (default `""`) and nodes as `include: mod-devflow-trace`: `trace-pr` with `{issue: "$INPUTS.issue", event: pr_open, pr_number: "$open-pr.output.number", pr_url: "$open-pr.output.url"}`, and `trace-finish` with `depends_on: [finish]`, `{issue: "$INPUTS.issue", event: finished, pr_number: "$open-pr.output.number", pr_url: "$finish.output.url", state: "$finish.output.state"}`. `mod-devflow-deliver.yaml`: add input `issue` (default `""`) and pass it to the `tail` include. Edit `mod-devflow-tail/commands/open-pr.md` per D7.4 (`Closes #<issue>` plus a "Traceability" section only when `issue` is non-empty).
      3a. In every fixture of the touched fixture directories that stubs `tail__finish` (devflow-quick, devflow-deps, devflow-config, devflow-docs, devflow-audit, mod-devflow-audit-fix, mod-devflow-deliver), add stubs for the new nested trace nodes with value `{"skipped":true}`. Read the exact stub ids (expected `tail__trace-pr__trace` and `tail__trace-finish__trace`) from one `archon workflow test` run.
      4. Create `scripts/shared-tests/part-09-trace.sh` (stub gh from lib.sh): empty `issue` prints `{"skipped":true}`; `building`, `pr_open`, `finished` write the states of D7.3 to the comment; a failing comment write exits 0, prints `{"ok":false}` and leaves `trace-error.md`.
      5. Run `scripts/test-devflow-shared.sh` and `bash -n` on every shell script touched; if `archon` is on PATH, copy the pack into a scratch repo as `scripts/test-devflow-pack.sh` does and run `archon validate workflows`, reporting errors that come from other workflows separately.
      Stop with status=blocked if `archon validate` rejects `include:` of `mod-devflow-trace` from `mod-devflow-tail`.
    acceptance:
      - "scripts/test-devflow-shared.sh exits 0 and prints PASS for part-09-trace"
      - "grep -c 'Closes #' packs/devflow/mod-devflow-tail/commands/open-pr.md prints at least 1"
      - "grep -c 'include: mod-devflow-trace' packs/devflow/mod-devflow-tail/mod-devflow-tail.yaml prints 2"
      - "archon workflow test in a scratch copy of the pack passes every fixture of devflow-quick, devflow-deps, devflow-config, devflow-docs, devflow-audit, mod-devflow-audit-fix and mod-devflow-deliver"
  - id: p7a-plan-scripts
    title: "publish-plan, load-design, publish-needs-refine, plan-block-result with tests"
    depends_on: [p3-resolve, p6a-render]
    complexity: M
    model: medium
    model_reason: "New publishing logic whose exact code the plan cannot spell out (rule 3)."
    touches:
      - packs/devflow/.shared/publish-plan.ts
      - packs/devflow/.shared/load-design.ts
      - packs/devflow/.shared/publish-needs-refine.ts
      - packs/devflow/.shared/plan-block-result.ts
      - scripts/shared-tests/part-07-publish-plan.sh
    brief: |
      Read Design D7 (plan block items 3, 5, 6, 7 and `publish-plan.ts`), D12 part 6, D2. Read all of the current `packs/devflow/.shared/publish-plan.ts` and `.shared/plan-result.ts`.
      1. Create `.shared/load-design.ts`: reads `design.md` at env `INPUTS_PLANS_COMMIT` (path via `fileOf`) with `readAt` into `$ARTIFACTS_DIR/design.md`; when `INPUTS_PLAN_PRESENT` is `true` also writes the existing plan to `$ARTIFACTS_DIR/existing-plan.md`; prints `{design_revision, plan_present}`.
      2. Create `.shared/publish-needs-refine.ts`: env `INPUTS_ISSUE`, `INPUTS_QUESTION`, `INPUTS_WHY`; calls `upsertComment(n, { needs_refine: {question, why, run} })`, commits nothing, prints `{planned:false}`.
      3. Create `.shared/plan-block-result.ts` printing the Design D7 item 7 JSON `{ planned, issue, plan_revision, design_revision, workflow, needs_refine, unresolved_findings }` from env inputs (`planned` false when `needs_refine` is true).
      4. Rewrite `.shared/publish-plan.ts` per Design D7 `publish-plan.ts` using `plans-branch.ts`, `layout.ts`, `frontmatter.ts`, `issue-comment.ts`; the rewritten file mentions neither next-question nor devflow-run-. Keep the unresolved-findings warning block and `published.md` behaviour.
      5. Add `scripts/shared-tests/part-07-publish-plan.sh` (D12 part 6, plan half: one commit with the four paths, trailers, revision 1 then 2, `before.md`/`after.md` present with `No manual steps.` when the plan has none, `design_revision` equal to the design's), using the bare-origin + stub gh pattern of part-05.
      6. Run `scripts/test-devflow-shared.sh`. The old `devflow-plan/devflow-plan.yaml` still wires the old publish-plan inputs until p7b replaces it; do not run `archon workflow test` on it in this phase.
    acceptance:
      - "scripts/test-devflow-shared.sh exits 0 and prints PASS for part-07-publish-plan"
      - "grep -n 'next-question\\|devflow-run-' packs/devflow/.shared/publish-plan.ts packs/devflow/.shared/load-design.ts packs/devflow/.shared/publish-needs-refine.ts packs/devflow/.shared/plan-block-result.ts prints nothing"
  - id: p7b-plan-block
    title: "plan block, devflow-plan entry, prompts, fixtures"
    depends_on: [p7a-plan-scripts, p6a-render, p6b-trace]
    complexity: M
    model: medium
    model_reason: "Writes prompt prose and adapts workflow wiring the plan only outlines (rule 3)."
    touches:
      - packs/devflow/mod-devflow-plan-block/**
      - packs/devflow/devflow-plan/**
    brief: |
      Read Design D7 (plan block, entry), D9 (draft-plan.md, review-plan.md), D12. Read the current `packs/devflow/devflow-plan/devflow-plan.yaml`, `commands/finalize.md`, `commands/review-plan.md`, `.shared/plan-result.ts`, `.shared/check-plan.ts`, `.shared/test-plan.ts`.
      1. Create `packs/devflow/mod-devflow-plan-block/mod-devflow-plan-block.yaml` with nodes in the order and ids of Design D7; inputs with defaults (`plans_ref: plans`, `plans_dir: plans`, `pack: "tkcs-lab/devflow"`); tier-only models (`medium` for `draft-plan`, `large` for `plan-review`); `returns: result`, `outcome_field: planned`. The `render` node's `render-run` wrapper imports `../../.shared/render-plan.ts` and passes `issue: "$resolve.output.issue"`, `design_revision: "$resolve.output.design_revision"`, `plan_revision: "$resolve.output.plan_revision"` (render-plan.ts adds the 1), `branch`, `title`, `main_branch`, `branch_regex`, `plans_ref`, `plans_dir`, `pack`, `soft_errors`; no `slug`, no `repo`; it writes `$ARTIFACTS_DIR/build-issue-<n>.yaml`. `plan-check` receives `issue: "$resolve.output.issue"`, `needs_refine_present: "$draft-plan.output.needs_refine_present"` and `finalize: "$draft-plan.output"`.
      2. Create `commands/draft-plan.md` and `commands/review-plan.md` in that block per Design D9: copy the current `finalize.md` and `review-plan.md` first, then edit. In draft-plan.md apply these replacements: the phrase 'the ADRs and the interview support best' becomes 'the ADRs and design.md support best'; 'every decision made after the interview' becomes 'every decision devflow-plan made'; the Assumptions line format becomes `- **<the decision>**: <the choice>. Why: <reason>. Made by devflow-plan, not asked (round <n>, finding <F-id>).`. Remove the sections about the interview, `interview.md`, `plan-draft.md` and `## Why no more questions`. Every other line outside the removed sections stays verbatim. Both files reference `$ARTIFACTS_DIR/model-rules.md` in place of the inline model rules.
      3. Create wrappers in `mod-devflow-plan-block/scripts/` (one-line imports) for `preflight`, `setup-env`, `resolve-input`, `load-design`, `render-run` (to `render-plan.ts`), `test-plan`, `check-plan`, `plan-result`, `publish-needs-refine`, `publish-plan`, `result` (to `plan-block-result.ts`).
      4. Replace `packs/devflow/devflow-plan/devflow-plan.yaml` by the entry of Design D7 (`stage` include + `result` node, `pack` default `tkcs-lab/devflow`); delete everything else inside `packs/devflow/devflow-plan/` (old `commands/*`, `scripts/*`, `fixtures/*`) except the new files. Do not delete `.shared/next-question.ts` (p12).
      5. Fixtures in `devflow-plan/fixtures/`: `happy-path`, `no-design` (cancelled), `needs-refine` (completed), `plan-test-never-clears` (failed/red like today's); copy node-id stubs from the old fixtures before deleting them.
      6. Run `scripts/test-devflow-shared.sh`, `scripts/test-render-run.sh`, and (archon on PATH) copy the pack into a scratch repo as `scripts/test-devflow-pack.sh` does, then run `archon validate workflows` and `archon workflow test .archon/workflows/devflow/devflow-plan`; other workflows may still fail for reasons owned by later phases (devflow-refine), list them.
      Stop with status=blocked if `trigger_rule: none_failed_min_one_success` or the `when` booleans are rejected by archon validate.
    acceptance:
      - "archon workflow test runs the four devflow-plan fixtures with the stated expect results"
      - "grep -rn 'interview\\|next-question\\|challenge' packs/devflow/devflow-plan packs/devflow/mod-devflow-plan-block prints nothing"
      - "grep -n 'default: \"tkcs-lab/devflow\"' packs/devflow/devflow-plan/devflow-plan.yaml packs/devflow/mod-devflow-plan-block/mod-devflow-plan-block.yaml prints two lines"
      - "scripts/test-devflow-shared.sh and scripts/test-render-run.sh exit 0"
  - id: p8-refine-block
    title: "refine block and its prompts"
    depends_on: [p3-resolve, p5-design-scripts]
    complexity: M
    model: medium
    model_reason: "Writes prompt prose and graph wiring whose exact wording the plan only outlines (rule 3)."
    touches:
      - packs/devflow/mod-devflow-refine-block/**
      - packs/devflow/.shared/refine-block-result.ts
    brief: |
      Read Design D6 (refine block table, messages, schemas), D9 (research, research-2, write-design prompts), D11.
      1. Create `packs/devflow/mod-devflow-refine-block/mod-devflow-refine-block.yaml` with the nodes and ids of the Design D6 table; inputs with defaults (`plans_ref: plans`, `plans_dir: plans`, `change: ""`, `pack: "tkcs-lab/devflow"`); tier-only models (`large` for research and research-2, `medium` for write-design); `returns: result`, `outcome_field: designed`; `worktree: { enabled: true }`; Use-when/NOT-for description (building block). `output_format` for `research`, `research-2`, `write-design`, `resolve`, `still-unstarted`, `check` per Design; node `refuse-2` (cancel on `$still-unstarted.output.refusal != ''`) and `when: "$still-unstarted.output.refusal == ''"` on `publish`, exactly as in the Design D6 table; the `result` node (`.shared/refine-block-result.ts`) prints `{designed, issue, revision, design_url, questions_asked, assumptions (integer count), assumption_titles (string[])}` so settle can list the titles.
      2. Create `commands/research.md`, `commands/research-2.md`, `commands/write-design.md` per Design D9 (rule Q verbatim, the untrusted-data statement, output notes). Write them in the style of the existing `packs/devflow/devflow-plan/commands/*.md` (open one before it is deleted by p7b; if it is already gone use `git show HEAD:packs/devflow/devflow-plan/commands/draft.md`).
      3. Create wrappers in `mod-devflow-refine-block/scripts/` (one-line imports) for `preflight`, `resolve-input`, `format-round`, `record-answers`, `check-design`, `publish-design`, `result` (place the result script logic in `.shared/refine-block-result.ts`).
      4. Do not create fixtures here (the block is only runnable through the entry, p9). Run `archon validate workflows` in a scratch copy of the pack (see `scripts/test-devflow-pack.sh`); report errors that come from other workflows separately.
      Stop with status=blocked if `when: "$x > 0"` is rejected and `!= 0` is also rejected.
    acceptance:
      - "archon validate workflows reports no error for mod-devflow-refine-block"
      - "grep -c 'max_iterations\\|loop_group' packs/devflow/mod-devflow-refine-block/mod-devflow-refine-block.yaml prints 0 (the cap is the graph)"
      - "grep -c '^ *wait:' packs/devflow/mod-devflow-refine-block/mod-devflow-refine-block.yaml prints 2, and grep -c 'id: ask-[12]$' on the same file prints 2"
  - id: p9-refine-entry
    title: "devflow-refine entry, result script, fixtures, loop verification"
    depends_on: [p4-attention, p7b-plan-block, p8-refine-block]
    complexity: M
    model: medium
    model_reason: "Verifies engine loop semantics and authors fixtures whose stubs depend on observed node ids (rule 3)."
    touches:
      - packs/devflow/devflow-refine/**
      - packs/devflow/.shared/refine-result.ts
    brief: |
      Read Design D6 "Entry devflow-refine" and D12 fixtures.
      1. Replace `packs/devflow/devflow-refine/devflow-refine.yaml` by the entry in Design D6 (inputs `work`, `plans_ref`, `plans_dir`, `pack` default `tkcs-lab/devflow`; `returns: result`, `outcome_field: designed`; description in the Use-when/NOT-for form that says: issue number or URL; up to two rounds of questions; ends with one pause plan/revise/finish; refine never starts a build). Delete every other old file inside `packs/devflow/devflow-refine/` (commands, scripts, fixtures).
      2. Create `devflow-refine/scripts/result.ts` (one-line import of `../../.shared/refine-result.ts`), and `.shared/refine-result.ts` printing the entry's `result` JSON per Design D6.
      3. Fixtures in `devflow-refine/fixtures/`: `no-questions`, `one-round`, `two-rounds`, `revise-then-finish`, `user-stops`, `refuse-started` per Design D12. Stub output of `stage__*` nodes follows the ids of the refine block and the attention block (run `archon workflow test` once to read the ids it expects).
      4. **Verify the loop cap**: run the `revise-then-finish` fixture. A second pass of `stage` must be visible. If it is not, set `max_iterations: 6`, add "max 5 revisions per run" to the description, rerun. Write the result (cap used and why) as the first comment in the entry YAML.
      5. Run the devflow-refine and devflow-plan fixtures via `scripts/test-devflow-pack.sh` (other workflows must pass unchanged).
      Stop with status=blocked if the attention block's `$LOOP_PREV.attend__ask.output.decision` form is rejected by archon validate; then report the exact error and the nearest accepted form.
      Stop with status=blocked if archon validate or archon workflow test rejects `$cycle.output.choice` or `$cycle.output.outcome.issue`. Report the exact error and the nearest form that is accepted.
    acceptance:
      - "archon workflow test runs the six devflow-refine fixtures with their stated expect results; user-stops and refuse-started are cancelled"
      - "scripts/test-devflow-pack.sh exits 0"
      - "grep -n 'default: \"tkcs-lab/devflow\"' packs/devflow/devflow-refine/devflow-refine.yaml prints a line"
  - id: p10-blocks
    title: "mod-devflow-start and mod-devflow-merge, render-run switch"
    depends_on: [p6a-render]
    complexity: M
    model: medium
    model_reason: "Ports non-trivial bash across several nodes and needs a real-run check (rule 3)."
    touches:
      - packs/devflow/mod-devflow-start/**
      - packs/devflow/mod-devflow-merge/**
      - packs/devflow/.shared/render-run.ts
      - scripts/test-render-run.sh
      - scripts/fixtures/render-run/**
    brief: |
      Read Design D7.1 item 6 and D7.2. Read the bash bodies of `worktree-check`, `confirm-worktree-removal`, `stop-at-worktrees`, `remove-worktrees`, `start` and `merge-<k>` in `packs/devflow/.shared/render-run.ts`.
      1. Create `packs/devflow/mod-devflow-start/mod-devflow-start.yaml` and `packs/devflow/mod-devflow-merge/mod-devflow-merge.yaml` containing the ported bash 1:1 (inputs per Design D7.2; bash nodes with `$INPUTS.<name>` instead of baked-in values; `$` inside text Archon substitutes written as `＄` per `safe`). No `isolation:`.
      2. In `render-run.ts` replace those nodes by `workflow: <pack>:mod-devflow-start` / `<pack>:mod-devflow-merge` nodes with `with:` values (heads as comma-separated `$phase.output.head` references, phases as `id=title` pairs through `msgSafe`). Keep node ids `start` and `merge-<k>`; `trace-start` still sits before `start`'s dependency chain as in p6a.
      3. Update `scripts/test-render-run.sh` and fixtures for the new node shapes; `scripts/test-render-run.sh` must pass.
      4. **Verify (required)**: in a scratch repository (temp dir, `git init`, the pack copied into `.archon/workflows/devflow`, a plan with two independent phases), render with `--pack` set to the prefix (before `:`) that `archon workflow list --json` shows for mod-devflow-phase in the scratch repo; before running, confirm that `<prefix>:mod-devflow-start`, `<prefix>:mod-devflow-merge` and `<prefix>:mod-devflow-trace` appear in that list, and if they do not, stop with status=blocked naming the missing entries (do not apply the fallback); then run a real `archon workflow run` of the rendered workflow and confirm the feature branch contains two commits whose message has a `Plan-Phase: issue-<n>/<id>` trailer. Capture the command and result into a file `docs/verify-blocks.md` is NOT allowed (the plan is not committed and docs are retired): instead put the command and its outcome in your final message under the heading `verify_after_merge note`.
      5. **Fallback**: if step 4 fails (child workflows do not share the parent worktree), revert step 2 to the inline bash, delete both new block directories, keep every other change, and say so in the final message under `verify_after_merge note`.
      Stop with status=blocked if no real `archon workflow run` can be made in this environment (no network or no auth): report it instead of applying the fallback.
    acceptance:
      - "scripts/test-render-run.sh exits 0"
      - "archon validate workflows accepts every rendered file in scripts/test-render-run.sh"
      - "final message contains a `verify_after_merge note` with the real-run result or the fallback decision"
  - id: p11-aliases
    title: "model aliases in the new workflows, README Models"
    depends_on: [p7b-plan-block, p8-refine-block, p9-refine-entry]
    complexity: S
    model: small
    touches:
      - packs/devflow/mod-devflow-plan-block/mod-devflow-plan-block.yaml
      - packs/devflow/mod-devflow-refine-block/mod-devflow-refine-block.yaml
      - packs/devflow/README.md
    brief: |
      Read Design D10.
      1. In `mod-devflow-refine-block.yaml` set `model: ['@devflow-planner', large]` on nodes `research` and `research-2`, and `model: ['@devflow-planner', medium]` on `write-design`.
      2. In `mod-devflow-plan-block.yaml` set `model: ['@devflow-planner', medium]` on `draft-plan` and `model: ['@devflow-reviewer', large]` on `plan-review`. Change nothing else.
      3. In `packs/devflow/README.md` add (or extend) a "Models" section: two bullets, one per alias, what each is for, and the examples `archon ai alias set @devflow-planner <provider> <model>` and `archon ai alias set @devflow-reviewer <provider> <model>`; say each falls back to the tier named in the workflow when the alias is not defined.
      4. Run `archon validate workflows` in a scratch copy (as scripts/test-devflow-pack.sh) and `archon workflow test` for devflow-refine and devflow-plan.
      Stop with status=blocked if archon validate rejects the list form of `model:`.
    acceptance:
      - "grep -rn \"@devflow-planner\" packs/devflow --include=*.yaml prints exactly four lines"
      - "grep -rn \"@devflow-reviewer\" packs/devflow --include=*.yaml prints exactly one line"
      - "scripts/test-devflow-pack.sh exits 0"
  - id: p12-retire
    title: "delete old files, README rewrite, plugin entrypoints, quick refusal text, changelog line"
    depends_on: [p9-refine-entry, p10-blocks, p11-aliases]
    complexity: M
    model: medium
    model_reason: "Writes README prose whose wording the plan does not give (rule 3)."
    touches:
      - packs/devflow/README.md
      - packs/devflow/archon-plugin.json
      - packs/devflow/devflow-quick/**
      - packs/devflow/.shared/next-question.ts
      - packs/devflow/mod-devflow-phase/mod-devflow-phase.yaml
      - packs/devflow/mod-devflow-deliver/mod-devflow-deliver.yaml
      - scripts/test-render-run.sh
      - README.md
    brief: |
      Read Design D1 (D14), and the whole of `packs/devflow/README.md` and `packs/devflow/devflow-quick/devflow-quick.yaml` first.
      1. Delete `packs/devflow/.shared/next-question.ts` and delete the `# d7. next-question.ts` section of `scripts/test-render-run.sh`. In line 3 of the descriptions of `packs/devflow/mod-devflow-phase/mod-devflow-phase.yaml` and `packs/devflow/mod-devflow-deliver/mod-devflow-deliver.yaml` replace `devflow-run-<slug>` by `build-issue-<n>`; change nothing else in them. Run `git ls-files packs/devflow | grep -E 'commands/(challenge|draft|finalize)\.md|next-question|load-published'` and delete whatever still exists (the old devflow-plan and devflow-refine files should already be gone from p7b and p9).
      2. `packs/devflow/archon-plugin.json`: `entrypoints` gets, in addition to the existing ones, `mod-devflow-refine-block`, `mod-devflow-plan-block`, `mod-devflow-attention`, `mod-devflow-start` (if its directory exists), `mod-devflow-merge` (if it exists), `mod-devflow-trace`, each pointing at `<name>/<name>.yaml`; update the `description` string to mention refine, plan, build.
      3. `packs/devflow/devflow-quick`: in the refusal text and the description replace `devflow-plan` by `devflow-refine` where it says where to go for larger work; change nothing else. Re-read its fixtures and update any assertion on that text.
      4. `packs/devflow/README.md`: update the workflow table (devflow-refine, devflow-plan, generated `build-issue-<n>`), rewrite "devflow-plan, step by step" as "refine → plan → build, step by step" (two question rounds, the one pause plan/revise/finish, the four-file issue folder `plans/plans/issue-<n>/`, the issue comment, `needs_refine`, the started check, `rulings.md`, front matter), the folder layout, the enable-plan-workflows section (`extraWorkflowSources` unchanged), and a "Migration" note: old `devflow-run-<slug>` workflows and `plans/<slug>/` folders stay on the plans branch and remain runnable. No other mention of `devflow-run-`, `challenge` or `next-question` may remain except that note.
      5. Root `README.md`: update any mention of `devflow-plan`/`devflow-refine` behaviour so it matches; if the repository has a changelog file add one line under its unreleased section; if it has none, add nothing.
      6. Run `scripts/test-devflow-pack.sh`, `scripts/test-render-run.sh`, `scripts/test-devflow-shared.sh`, `bash -n` on every script in `scripts/`, and `grep -rn "devflow-run-\|next-question\|challenge" packs/devflow`.
    acceptance:
      - "scripts/test-devflow-pack.sh, scripts/test-render-run.sh and scripts/test-devflow-shared.sh exit 0"
      - "grep -rn 'devflow-run-\\|next-question\\|challenge' packs/devflow prints only lines inside the README Migration note"
      - "python3 -c 'import json;json.load(open(\"packs/devflow/archon-plugin.json\"))' exits 0 and the entrypoints include mod-devflow-trace and mod-devflow-plan-block"
```
