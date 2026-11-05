# Cheaper planning models, a model per phase, and a sized final review in the devflow pack

## Goal

Today devflow-plan and devflow-refine run every planning step on the large tier, every phase of a
generated `devflow-run-<slug>` runs on medium, and the final build review always runs on large.
After this change:

- devflow-plan and devflow-refine interview and write the plan on **medium**. A **large** step
  validates the finished plan, and **medium** applies its fixes, for up to 3 rounds.
- The plan gives each implementation phase the **smallest model** that can do it: `small` by
  default, `medium` or `large` only with a written reason. The phase runs on that model.
- plan.md has a **Phases and models** overview table.
- The final build review in the generated run is **medium** or **large**: large for security-related
  changes, when any phase is on large, or when the plan has 7 or more phases.
- If the large validation still has blocking findings after its last round, the plan is published
  anyway. The findings go into "Risks and open questions", and a warning at the top of plan.md
  points to them.

The request (the run's message): "update the devflow-plan skill. it runs with medium model and at the
end validation runs with large (and plan fixes with sonnet again). the plan must make the
implementation plan well structured and use as small model as possible. consider small model by
default for all implementation phases and if considered too complex use medium and if needed further
escalate to large. plan.md should provide a phases - models overview. final build review medium or
large depending on the size and the nature (e.g. security related large)". There is no issue.

## Current state

All paths are relative to the repository root. `<pack>` is `packs/devflow`.

- `<pack>/devflow-plan/devflow-plan.yaml`: workflow `model: large` (l.14). The interview loop's
  `draft` (l.57-59) and `challenge` (l.69-73) nodes are `model: large`. `finalize` (l.115-130) is
  `model: large`. It writes plan.md and runs make-plan section 4 itself: a `Plan` subagent on Opus
  reviews the plan, then `validate_manifest.py`. `render` (l.132) depends on `finalize`, and
  `publish` (l.153) depends on `render`.
- `<pack>/devflow-plan/commands/draft.md` l.1, `challenge.md` l.1 and `finalize.md` l.1 call the
  session "Opus". `finalize.md` l.14-16 and l.43 ask for the section 4 `Plan` subagent review.
  l.72-74 say to stop when "the reviewer's findings are fixed or answered".
- `<pack>/devflow-refine/devflow-refine.yaml` mirrors this: workflow `model: large` (l.11), `draft`
  (l.86-88), `challenge` (l.98-102) and `finalize` (l.144-148) are large. `render` (l.161) depends on
  `finalize`. `<pack>/devflow-refine/commands/{draft,challenge,finalize}.md` have the same text as
  devflow-plan's plus refine-specific lines. In `finalize.md`, overrides 1-6 are l.41-60, override 7
  is l.61-64, and the section 4 text is l.19-20 and l.48.
- `<pack>/devflow-phase/devflow-phase.yaml`: workflow `model: medium` (l.9). The `build` loop
  (l.64-96) has `implement` (l.69-79, `command: implement-phase`, `model: medium`) and `check`.
  `until_bash` (l.95) reads `$implement.output.status`. `load-plan` (l.48-62) returns
  `{slug, branch, title, done}`. `commands/implement-phase.md` l.1 says "(Sonnet)" and l.15 reads
  `$LOOP_PREV.implement.output`.
- `<pack>/devflow-tail/devflow-tail.yaml`: no `inputs:`. The `review-loop` (l.18-41) holds
  `fix-blocking` (medium, `when: "$LOOP_PREV.review.output.blocking > 0"`) and `review`
  (l.26-39, `model: large`). `until_bash` reads `$review.output.blocking`, and `review-gate` (l.43)
  reads `$review-loop.output.blocking`. `commands/review.md` l.8 says "(Opus) for a plan that Sonnet
  workers implemented". devflow-tail is included by devflow-deliver (l.110), devflow-quick (l.132),
  devflow-docs (l.131), devflow-config (l.261), devflow-deps (l.239) and devflow-audit-fix (l.158).
  devflow-audit includes devflow-audit-fix.
- `<pack>/devflow-deliver/devflow-deliver.yaml`: workflow `model: large` (l.8). `load-plan`
  (l.54-68) returns `{slug, branch, title, done}`. The `tail` include (l.109-111) has no `with:`.
- `<pack>/.shared/render-run.ts`: the `Phase` (l.5-9) and `Manifest` (l.11-18) interfaces,
  `extractManifest` (l.35), `validate` (l.64-72, called first in `renderRunWorkflow`, l.75) and the
  CLI (l.282-310). It renders one `workflow: <pack>:devflow-phase` node per phase and one
  `devflow-deliver` node. `<pack>/.shared/load-plan.ts` imports `extractManifest` (l.5), reads the
  plan (l.15-23) and prints `{slug, branch, title, done}` (l.64).
  `<pack>/.shared/render-plan.ts` calls `renderRunWorkflow` in a try/fail (l.50-66).
- The toolkit's `validate_manifest.py` accepts `worker_model` only as `opus|sonnet` (l.174-178) and
  ignores unknown keys. So the new per-phase key is `model`, not `worker_model`.
- Archon 0.13.4 (checked in its source and with a prototype of this design in a scratch repository):
  - The tiers are `small|medium|large`, and a node's `model:` is static. `model` on a `workflow:`
    node is ignored, so a parent cannot choose a child's model, and run-time model choice needs
    alternative nodes gated by `when:`.
  - An `include:` substitutes its `with:` values into the included nodes at load time. In a `when:`,
    a substituted literal (for example `large == 'medium'`) makes the expression unparseable, and the
    load fails.
  - An included block's declared `inputs:` (with defaults applied) reach its `bash:` nodes as
    `INPUTS_<NAME>` environment variables. A `with:` value that is a node-output reference
    (`$load-plan.output.review_model`) is resolved at run time.
  - The prototype passed `archon validate` and the fixtures for the routing in D4, D5 and D7: a
    medium-routed devflow-deliver completed with only the `review-medium` stub, and a devflow-plan
    whose validation never clears still completed and published.
- Tests: `scripts/test-render-run.sh` (renderer, load-plan, publish-plan and load-published, with
  fixtures in `scripts/fixtures/render-run/`) and `scripts/test-devflow-pack.sh` (`archon validate
  workflows` and every `<pack>/*/fixtures/*.stubs.yaml`; 36 fixtures pass today).
- The profile (`.claude/toolkit.yaml`) has no `docs.adr_dir` and no `docs.changelog`. Its must-read
  docs are `README.md` and `<pack>/README.md`. `<pack>/README.md` l.72 says the interview runs on
  the "large tier", and l.27-29 list only four of devflow-tail's six includers.

## Design

### Decisions of the user (interview.md)

1. **Q2 = A:** each phase's model is picked once, at planning time. Nothing escalates at run time.
   A phase that ends blocked stops the run, as today.
2. **Q3/Q4 = A:** devflow-refine gets the same changes in this change: medium interview and writing,
   large validation, medium fixes, per-phase models and the table. The renderer stays strict: a
   missing `model` fails.
3. **Q6 = "a but >= 7":** the final review is large when the change is security-related, when any
   phase is on large, or when the plan has **7 or more** phases. Otherwise it is medium.
4. **Q7 = C:** nothing special is done for `devflow-run-<slug>` workflows rendered before this
   change: no fallback, no blocking path and no README note. See D9 for the effect.
5. **Q8 = "a but put to the plan page top the highlight":** if blocking findings remain after the
   last validation round, the plan is still published. The findings go into "Risks and open
   questions", and a warning callout at the very top of plan.md points to them (D7). The same applies
   to devflow-refine.
6. **The request:** planning runs on medium, the final validation on large, and plan fixes on medium
   ("sonnet"). Phases default to small and escalate to medium or large only with a reason. plan.md
   has a phases/models overview. The final build review is medium or large by size and nature.

### D1. Planning models (devflow-plan and devflow-refine)

In both `devflow-plan.yaml` and `devflow-refine.yaml`:

- workflow `model: large` → `model: medium`.
- `draft`: `model: medium`. `challenge`: `model: medium`. `finalize`: `model: medium`.
- After `finalize`, two new nodes: a loop `plan-check` and a node `settle-plan`. `render` now
  depends on `settle-plan` instead of `finalize`, and keeps reading `$finalize.output.*`. Insert
  exactly this before `render` (same indentation as the other top-level nodes):

```yaml
  # ---- 3. Large-tier validation of the plan, medium fixes, until no blocking finding is left --
  - id: plan-check
    depends_on: [finalize]
    loop_group:
      nodes:
        - id: fix-plan
          when: "$LOOP_PREV.validate-plan.output.blocking > 0"
          command: fix-plan
          model: medium
          context: fresh
        - id: validate-plan
          depends_on: [fix-plan]
          trigger_rule: all_done
          command: validate-plan
          model: large
          context: fresh
          output_format:
            type: object
            properties:
              blocking: { type: integer }
              non_blocking: { type: integer }
            required: [blocking, non_blocking]
      until_bash: 'b=$validate-plan.output.blocking; [ "$b" -eq 0 ]'
      max_iterations: 3

  # Fixes or declines the last review's non-blocking findings; records blocking ones that are left
  # in "Risks and open questions" with a warning at the top of plan.md. The plan is published anyway.
  - id: settle-plan
    depends_on: [plan-check]
    command: settle-plan
    model: medium
    context: fresh
    output_format:
      type: object
      properties:
        unresolved: { type: integer }
      required: [unresolved]
```

and change `render`'s `depends_on: [finalize]` to `depends_on: [settle-plan]`. No gate follows
`plan-check`. A plan with unresolved findings is published (decision 5).

### D2. The model rules (one canonical section)

This exact section, from the `## Models: the smallest model for each phase` line to the end of
rule 7, goes byte-identically into ten command files: devflow-plan's `draft.md`, `finalize.md`,
`validate-plan.md`, `fix-plan.md` and `settle-plan.md`, and devflow-refine's five files of the same
names. Put it directly before `## Output` in draft.md and finalize.md, and at the end of
validate-plan.md, fix-plan.md and settle-plan.md (D7 says where).

```markdown
## Models: the smallest model for each phase

These rules replace make-plan's model wording ("Sonnet worker sessions", "Sizing for Sonnet" as a
model choice, `worker_model: opus`). Every other "Sizing for Sonnet" rule still applies to every
phase: complexity S or M, no open decisions in a brief, numbered steps naming files and symbols,
mechanical acceptance, honest `touches` disjoint within a wave, a stop condition for each risky
step. Never write `worker_model` in the manifest.

1. Every phase has `model: small`, `model: medium` or `model: large`, the Archon tier its worker
   runs on. It is picked once, here: nothing escalates it at run time, and a phase that ends
   blocked stops the run.
2. `small` is the default. Make each brief mechanical enough for it: every file, symbol, name,
   string and test is spelled out in the brief or in a named Design subsection, or the brief names
   a commit to copy by SHA. Split a phase rather than raise its model.
3. `medium` only when the phase cannot be made mechanical for small even after splitting: it must
   adapt non-trivial existing logic across several files, write new logic whose exact code the plan
   cannot spell out (parsing, state handling, an algorithm), or write prompt or documentation prose
   whose wording the plan does not give.
4. `large` only where a mistake is costly and the acceptance cannot catch it: subtle concurrency,
   or security-sensitive code (authentication, authorization, secrets, cryptography, sandboxing,
   input parsing at a trust boundary).
5. `model_reason` (one sentence: which of rules 3 or 4 applies, and why) is required for `medium`
   and `large`. Leave it out for `small`.
6. The manifest's top-level `review_model` is the final build review's tier. It is `large` when
   the change is security-related (rule 4's areas, or the work is a security fix), or any phase has
   `model: large`, or `phases` has 7 or more entries (the retirement phase counts). Otherwise it is
   `medium`. `review_model_reason` (always required) says which applies, with the phase count.
7. plan.md has a `## Phases and models` section: in a large-scope plan directly after `## Design`,
   in a small-scope plan directly after `## Stop conditions`. It holds a table
   `| Phase | Title | Complexity | Depends on | Model | Why this model |` with one row per manifest
   phase in manifest order (`—` for no dependencies, `default` as the reason of a `small` row),
   then the line `Final build review: **<review_model>**. <review_model_reason>`.
```

Manifest shape (the new keys only):

```yaml
review_model: medium                       # medium | large, rule 6
review_model_reason: 5 phases, none on large, not security-related
phases:
  - id: p1-example
    model: small                           # small | medium | large
  - id: p2-example
    model: medium
    model_reason: adapts the review loop across three workflows; the fixture fixes need judgement
```

### D3. Manifest validation in the renderer and load-plan

In `<pack>/.shared/render-run.ts`:

- `Phase` gains `model?: string; model_reason?: string;`. `Manifest` gains
  `review_model?: string; review_model_reason?: string;`.
- A new export, placed directly after `waves`:

```ts
export const TIERS = ["small", "medium", "large"] as const;

// Every phase names the tier its worker runs on, and the plan names the final review's tier (devflow-plan's model rules).
export function validateModels(m: Manifest): void {
  for (const p of m.phases) {
    if (!(TIERS as readonly string[]).includes(p.model ?? "")) {
      throw new Error(`phase '${p.id}': model must be small, medium or large (got ${JSON.stringify(p.model) ?? "nothing"})`);
    }
    if (p.model !== "small" && !String(p.model_reason ?? "").trim()) throw new Error(`phase '${p.id}': model ${p.model} needs a model_reason`);
  }
  if (m.review_model !== "medium" && m.review_model !== "large") {
    throw new Error(`review_model must be medium or large (got ${JSON.stringify(m.review_model) ?? "nothing"})`);
  }
  if (!String(m.review_model_reason ?? "").trim()) throw new Error("review_model needs a review_model_reason");
}
```

- `validate(o)` calls `validateModels(o.manifest)` as its last statement, so the id and slug checks
  run first.
- The rendered workflow does not change. devflow-phase and devflow-deliver read the tiers from the
  plan through `load-plan` (D4, D5), so the plan at `plan_commit` is the only source.

In `<pack>/.shared/load-plan.ts`:

- Import `validateModels` with `extractManifest`.
- Right after the `extractManifest` try/catch, add
  `try { validateModels(manifest); } catch (e) { fail((e as Error).message); }`.
- Declare `let model = "";` next to `let done = false;`. In the `mode === "phase"` branch, after
  the phase-exists check, set `model = manifest.phases.find((p) => p.id === phase)!.model!;`.
- The final line prints
  `JSON.stringify({ slug, branch, title, done, model, review_model: manifest.review_model })`.
  `model` is `""` in deliver mode.

### D4. Phase model routing (devflow-phase)

In `<pack>/devflow-phase/devflow-phase.yaml`:

- `load-plan`'s `output_format` gains `model: { type: string }`, and `required` becomes
  `[slug, branch, title, done, model]`.
- In the `build` loop, the single `implement` node is replaced by three AI nodes and one picker
  script that keeps the id `implement`. So `until_bash`, `check`'s `depends_on`, `gate` and
  implement-phase.md's `$LOOP_PREV.implement.output` stay unchanged. Replace the old `implement`
  node with:

```yaml
        - id: implement-small
          when: "$load-plan.output.model == 'small'"
          command: implement-phase
          model: small
          context: fresh
          output_format: &implement_out
            type: object
            properties:
              status: { type: string, enum: [continue, complete, blocked] }
              phase: { type: string }
              summary: { type: string }
            required: [status, phase, summary]
        - id: implement-medium
          when: "$load-plan.output.model == 'medium'"
          command: implement-phase
          model: medium
          context: fresh
          output_format: *implement_out
        - id: implement-large
          when: "$load-plan.output.model == 'large'"
          command: implement-phase
          model: large
          context: fresh
          output_format: *implement_out
        - id: implement
          depends_on: [implement-small, implement-medium, implement-large]
          trigger_rule: one_success
          script: pick-one
          runtime: bun
          with:
            small: { from: "$implement-small.output", if_skipped: "" }
            medium: { from: "$implement-medium.output", if_skipped: "" }
            large: { from: "$implement-large.output", if_skipped: "" }
          output_format: *implement_out
```

  If `archon validate` rejects the YAML anchors, write the `output_format` block out in full at each
  of the four places instead. That is the only allowed deviation.
- The workflow-level `model: medium` stays (no node uses it).
- `commands/implement-phase.md` l.1: "(Sonnet)" → "(on the model tier the plan's manifest gives
  this phase)".

### D5. Review model routing (devflow-tail and devflow-deliver)

In `<pack>/devflow-tail/devflow-tail.yaml`:

- Add, after `returns: finish`:

```yaml
inputs:
  review_model:
    default: large
    description: The tier of the final review, medium or large. devflow-deliver passes the plan's review_model; the other includers keep the default.
```

- Add a first node, before `review-loop`, and give `review-loop` `depends_on: [review-tier]`. The
  tier goes through a bash node because a literal include value in a `when:` fails the load:

```yaml
  - id: review-tier
    bash: |
      m=$INPUTS.review_model
      case "$m" in
        medium|large) printf '{"model":"%s"}\n' "$m" ;;
        *) echo "devflow: review_model must be medium or large, not '$m'" >&2; exit 1 ;;
      esac
    output_format:
      type: object
      properties:
        model: { type: string }
      required: [model]
```

- In `review-loop`, replace the `review` node with two AI nodes and a picker that keeps the id
  `review`. So `until_bash`, `fix-blocking`'s `when`, `review-gate` and review.md's
  `$LOOP_PREV.review.output` stay unchanged:

```yaml
        - id: review-medium
          depends_on: [fix-blocking]
          trigger_rule: all_done
          when: "$review-tier.output.model == 'medium'"
          command: review
          model: medium
          context: fresh
          output_format: &review_out
            type: object
            properties:
              verdict: { type: string, enum: [approve, changes] }
              blocking: { type: integer }
              non_blocking: { type: integer }
              head: { type: string }
            required: [verdict, blocking, non_blocking, head]
        - id: review-large
          depends_on: [fix-blocking]
          trigger_rule: all_done
          when: "$review-tier.output.model == 'large'"
          command: review
          model: large
          context: fresh
          output_format: *review_out
        - id: review
          depends_on: [review-medium, review-large]
          trigger_rule: one_success
          script: pick-one
          runtime: bun
          with:
            medium: { from: "$review-medium.output", if_skipped: "" }
            large: { from: "$review-large.output", if_skipped: "" }
          output_format: *review_out
```

  The same anchor fallback as D4 applies.
- The description's "Opus review" → "a review (large tier unless the includer passes
  `review_model: medium`)". The l.15 comment "review (Opus, fresh)" → "review (fresh)".
- `commands/review.md` l.8: "You are the **final reviewer** (Opus) for a plan that Sonnet workers
  implemented." → "You are the **final reviewer** for a change that worker sessions implemented."

In `<pack>/devflow-deliver/devflow-deliver.yaml`:

- `load-plan`'s `output_format` gains `review_model: { type: string }`, and `required` becomes
  `[slug, branch, title, done, review_model]`.
- The `tail` include gains:

```yaml
    with:
      review_model: "$load-plan.output.review_model"
```

The other five includers (devflow-quick, devflow-docs, devflow-config, devflow-deps,
devflow-audit-fix) are not edited. They get the default `large`, so their behaviour does not change.
Their fixtures need the new stubs (p3).

### D6. The `pick-one` script

New `<pack>/.shared/pick-one.ts`:

```ts
// Prints the output of the one routed step that ran (small, medium or large); the others were skipped by their `when:`.
import { fail, input } from "./util.ts";

const ran = ["small", "medium", "large"].map((n) => [n, input(n, false)] as const).filter(([, v]) => v.trim() !== "");
if (ran.length !== 1) fail(`expected exactly one routed step to run, got ${ran.length} (${ran.map(([n]) => n).join(", ") || "none"})`);
console.log(ran[0][1].trim());
```

Thin entries, each holding exactly these two lines, in the pattern of
`<pack>/devflow-tail/scripts/verify.ts`:

```ts
// Thin entry point: the logic lives in the pack's .shared/pick-one.ts.
import "../../.shared/pick-one.ts";
```

at `<pack>/devflow-phase/scripts/pick-one.ts` (p2) and `<pack>/devflow-tail/scripts/pick-one.ts`
(p3).

### D7. The validation commands: validate-plan, fix-plan, settle-plan

Three new command files in `<pack>/devflow-plan/commands/` (p4). devflow-refine gets byte-identical
copies in `<pack>/devflow-refine/commands/` (p5). Neither text names the workflow, so the copies fit
both. Each file starts with the role line given below and holds the content below, in this order.

**validate-plan.md** (large):

1. Role: "You are the **plan validator** (a fresh session on the large tier). You change nothing
   except your report: no edits to plan.md, no commits, no pushes."
2. Read: `$ARTIFACTS_DIR/plan.md`, `prerequisites.md` and `after.md` when they exist,
   `$ARTIFACTS_DIR/interview.md`, the profile `$ARTIFACTS_DIR/profile.json` and its must-read docs,
   `$preflight.output.devflow_root/commands/make-plan.md` sections 2-4, and the code the plan
   names. Run `python3 $preflight.output.devflow_root/scripts/validate_manifest.py
   $ARTIFACTS_DIR/plan.md --profile .claude/toolkit.yaml`.
3. Earlier rounds: "The last round's result was $LOOP_PREV.validate-plan.output. If it is not empty,
   first confirm each earlier blocking finding is fixed or validly answered in
   `$ARTIFACTS_DIR/plan-review-responses.md`."
4. Check, and report as findings, everything make-plan section 4 lists: a phase that fails
   "Sizing for Sonnet" (as amended by the model rules below), a decision left open in a brief, two
   phases of one wave sharing a path in `touches`, a manual step in the middle or a dispatchable
   step called manual, a contradiction of a must-read doc or the code as it is, and every
   `validate_manifest.py` error. Also check:
   - each interview answer is recorded in the Design;
   - every model rule below. A `small` phase whose brief is not mechanical, a `medium` or `large`
     phase whose `model_reason` does not meet rule 3 or 4, and a `review_model` that breaks rule 6
     are all blocking;
   - the `## Phases and models` table and the final-review line match the manifest exactly (rule 7);
   - `feature_branch` matches `git.branch_pattern` with a type from `git.branch_types`, and
     `max_parallel` is at most 3 (1 for a single-phase plan).
5. A pointer: "The model rules are the last section of this file." (The D2 section itself goes
   at the very end of the file, after step 8's text.)
6. Severity: **blocking** is anything that would make a worker improvise, block or fail, would make
   `validate_manifest.py` or the renderer reject the plan, or breaks a model rule. Wording and
   clarity are **non-blocking**. Every finding cites the plan section or phase id and the evidence
   (`path:line`, command output). Drop anything that rests on "might".
7. Report: if `$ARTIFACTS_DIR/plan-review.md` exists, first move it to
   `$ARTIFACTS_DIR/plan-review-<n>.md` (n = 1 + the number of `plan-review-*.md` files). Write
   `plan-review.md`: the line `PLAN-REVIEW blocking=<b> non_blocking=<m>`, then the findings as
   `<n>. blocking|non-blocking · <section or phase id> · what is wrong · the fix`, then the status of
   each earlier finding.
8. Output: return `blocking` and `non_blocking`, the counts in the report.

**fix-plan.md** (medium):

1. Role: "You fix the **blocking** findings of the plan validation (a fresh session on the medium
   tier), and nothing else."
2. Scope: the blocking findings in `$ARTIFACTS_DIR/plan-review.md`. Leave the non-blocking ones
   (settle-plan handles them). Edit `$ARTIFACTS_DIR/plan.md`, and `prerequisites.md` or `after.md`
   only to keep them consistent with the manifest. Follow make-plan sections 2-3, the profile, and
   the model rules below (the D2 section, appended at the end of this file).
3. Never change the plan's `# ` title line, `plan_slug` or `feature_branch`. Never create or delete
   `prerequisites.md` or `after.md`. A finding that needs one of these is answered, not fixed.
4. When a finding is wrong, or needs a decision only the user can make, do not change the plan for
   it. Append the finding number and your evidence to `$ARTIFACTS_DIR/plan-review-responses.md`.
5. Run `validate_manifest.py` (the command in validate-plan.md step 2) after your last edit and
   fix every error it prints.
6. No commits, no pushes. Reply with one line per finding: fixed (which section) or answered.
7. Then the D2 section verbatim, as the file's last section.

**settle-plan.md** (medium):

1. Role: "You settle the plan validation's last report (a fresh session on the medium tier)."
2. Read `$ARTIFACTS_DIR/plan-review.md` (the last round's report), `plan-review-responses.md` if
   it exists, and `plan.md`.
3. Each **non-blocking** finding: fix it in plan.md when it is correct and inside the plan's scope.
   Otherwise decline it with one line under `## Risks and open questions` saying why. The step 3
   limits of fix-plan.md apply (never change the title line, `plan_slug` or `feature_branch`, and
   never create or delete `prerequisites.md` or `after.md`). Follow the model rules below.
4. Each **blocking** finding still open in the report (its count is in the report's first line): do
   not fix it. It was not confirmed fixed by the large validation. Under `## Risks and open
   questions`, add a subsection `### Unresolved validation findings` with one bullet per finding:
   its text from plan-review.md and, if any, the answer from plan-review-responses.md.
5. If that count N is above 0, insert this callout directly below plan.md's first line (the `# `
   title), followed by a blank line. `<slug>` is the manifest's `plan_slug`:

```markdown
> [!WARNING]
> **This plan has N unresolved validation findings.** The large-tier plan validation still found
> N blocking problems after its last round. They are listed under
> [Risks and open questions](#risks-and-open-questions). Read them before you start
> `devflow-run-<slug>`.
```

   Use the number in place of N. If N is 0, add no callout, and remove any such callout already in
   the file.
6. Run `validate_manifest.py` and fix every error it prints. No commits, no pushes.
7. Output: return `unresolved` = N.
8. Then the D2 section verbatim, as the file's last section.

### D8. Edits to the existing planning commands

Apply the same edits to devflow-plan's and devflow-refine's copies (p4 and p5):

- `draft.md` l.1: "You are the **planner** for this change (Opus)." → "You are the **planner** for
  this change." In "Your authority", after "...section 3 (manual steps only at the very beginning
  and the very end)", add ", and the model rules below". Insert the D2 section before `## Output`.
  devflow-refine's `draft.md` also gets one more bullet at the end of its step 3 list: "If
  `original/plan.md` has no `model` on a phase or no `review_model`, add them by the model rules
  below. That is part of the refinement, not a question."
- `challenge.md` l.1: "You are the **challenger** (Opus, a fresh session)." → "You are the
  **challenger** (a fresh session)."
- `finalize.md`:
  - l.1: "(Opus), writing the final plan" → ", writing the final plan".
  - In "Your authority", replace "section 3 (manual steps only at the very beginning and the very
    end) and section 4 (a fresh `Plan` subagent on Opus reviews the plan, then
    `validate_manifest.py`), with the overrides below." with "section 3 (manual steps only at the
    very beginning and the very end) and the model rules below, with the overrides below. Do not run
    section 4's `Plan` subagent: the next step validates the plan on the large tier and applies its
    findings."
  - In override 2, delete the sentence "Run the section 4 `Plan` subagent review too."
  - After override 6 (devflow-plan) or override 7 (devflow-refine), add the next-numbered override:
    "**Risks and open questions, and the table.** Both scopes have a `## Risks and open questions`
    section directly before `## Implementation manifest`, and the `## Phases and models` section of
    model rule 7."
  - Insert the D2 section before `## Output`.
  - In `## Output`, replace "Stop when `$ARTIFACTS_DIR/plan.md` exists, passes
    `validate_manifest.py`, and the reviewer's findings are fixed or answered in the plan's "Risks
    and open questions"." with "Stop when `$ARTIFACTS_DIR/plan.md` exists and passes
    `validate_manifest.py`."

### D9. Workflows rendered before this change (decision 4)

No compatibility code is added. A `devflow-run-<slug>` rendered before this change still passes
`phase`, `base` and the rest, and the new devflow-phase and devflow-deliver read the tiers from the
plan. For an old plan with no `model` keys, `load-plan` therefore fails with D3's message
(`phase '<id>': model must be small, medium or large (got nothing)`). Validation is shared with the
renderer, so the run stops and implements nothing. It never runs silently without an implement step.
This is a consequence of the strict shared validation, not an added path. The README gets no note
about it.

### D10. Docs

`<pack>/README.md`:

- l.27-29: devflow-tail's includers become "`devflow-quick`, `devflow-docs`, `devflow-config`,
  `devflow-deps`, `devflow-audit-fix` (which `devflow-audit` includes) and `devflow-deliver`".
- In "devflow-plan, step by step", replace step 1's "(large tier)" with "(medium tier)". Replace
  step 2 with "**Plan** (medium tier): researches and writes `plan.md` with an implementation
  manifest, validated by the toolkit's `validate_manifest.py`. Each phase gets the smallest model
  tier that can do it (`small` by default, `medium` or `large` with a reason), and the plan gets a
  final-review tier: `large` for security-related changes, for a plan with a `large` phase or with 7
  or more phases, else `medium`. A **Phases and models** table in plan.md shows them all.
  `manual_before` and `manual_after` steps become `prerequisites.md` and `after.md`." Insert a new
  step 3, and renumber Render and Publish to 4 and 5: "**Validate** (large tier): a fresh validator
  checks the plan against the toolkit's method and the model rules. A medium-tier session fixes its
  blocking findings, for up to 3 rounds. Then a medium-tier session fixes or declines the
  non-blocking ones. Blocking findings still left are recorded under the plan's \"Risks and open
  questions\", with a warning at the top of plan.md, and the plan is published anyway.
  `plan-review.md` in the run's artifacts holds the last report."
- In the paragraph after the steps, replace "each as a `devflow-phase` child run in its own
  worktree" with "each as a `devflow-phase` child run in its own worktree on the phase's model
  tier". Replace "and the shared tail (review, fixes, ..." with "and the shared tail (review on the
  plan's final-review tier, fixes, ...".
- In "devflow-refine, step by step", step 3, append: "It uses the same tiers and validation as
  `devflow-plan`, and adds phase and review tiers to an older plan that has none."

Root `README.md` is unchanged: it describes the pack only by link.

### Rejected alternatives

- **Run-time escalation** (retry a blocked small phase on medium, then large) was rejected by the
  user (Q2). It costs more on failure and hides bad briefs.
- **Passing `model` and `review_model` as workflow inputs from the renderer:** the plan already
  holds them, and `load-plan` reads the plan at `plan_commit`. A second source could drift, and the
  rendered workflow stays unchanged.
- **Reusing `worker_model`:** the toolkit validator allows only `opus|sonnet`.
- **`$INPUTS.review_model` directly in devflow-tail's `when:`:** an includer's literal value makes
  the expression unparseable at load time. The `review-tier` bash node avoids that.
- **Duplicating the whole review loop, or the whole build loop, per tier:** that would change every
  downstream reference (`until_bash`, `review-gate`, `$LOOP_PREV.*`). The picker keeps the ids
  `implement` and `review`.

## Phases and models

| Phase | Title | Complexity | Depends on | Model | Why this model |
|---|---|---|---|---|---|
| p1-manifest-models | Manifest model keys in the renderer and load-plan, and the pick-one script | S | — | small | default |
| p4-plan-validation | devflow-plan: medium planning, large validation loop, the model rules | M | — | medium | writes three new prompt files and edits three more from a spec whose exact wording it must compose |
| p2-phase-routing | devflow-phase runs each phase on its manifest model | S | p1-manifest-models | small | default |
| p3-review-routing | devflow-tail and devflow-deliver run the final review on the plan's review model | M | p1-manifest-models | small | default |
| p5-refine-validation | devflow-refine gets the same models, validation loop and rules | S | p4-plan-validation | small | default |
| p6-docs-retire | Document the model tiers and retire the plan | S | p1-manifest-models, p2-phase-routing, p3-review-routing, p4-plan-validation, p5-refine-validation | small | default |

Final build review: **medium**. 6 phases (fewer than 7), none on large, and not security-related (it changes model tiers only)

## Manual steps

None. Archon 0.13.4 already supports everything used here. The pack reaches runners through the
existing sync that the READMEs document (`bootstrap.sh` or `archon plugin update`), and that is
not a step of this plan.

## Risks and open questions

- **From the interview, "Why no more questions":** the scope is devflow-plan, devflow-refine,
  devflow-phase, devflow-tail and devflow-deliver with their includers' fixtures, the renderer and
  its tests, and the docs. Behaviour is settled by Q2 (picked once), Q6 (>= 7 phases), Q7 (C: no
  handling of old rendered workflows) and Q8 (publish anyway, with a top callout). Names follow the
  pack's conventions. No credentials, secrets or permissions change. There are no prerequisites
  and no after-merge steps. The profile has no ADR directory and no changelog, so there are no ADRs
  and no changelog line.
- **This plan's own run uses the pack as it is today.** Its `model` and `review_model` keys are
  ignored when this plan is implemented: every phase runs on medium and the final review on large.
  That is expected, not a failure.
- **Archon rejects the YAML anchors in D4/D5:** write each `output_format` out in full (the only
  allowed deviation). If `archon validate` rejects anything else in D1, D4 or D5 (`trigger_rule:
  one_success`, `when:` on `$load-plan.output.model` inside a loop, `with:` on the `tail` include,
  `inputs:` on devflow-tail), the brief is wrong: stop with `status=blocked` and paste the
  validator output. The prototype accepted all of them on Archon 0.13.4.
- **A routed fixture does not route:** if a fixture's `implement-<tier>` or `review-<tier>` stub is
  reported as an unused stub while another tier's node reports "Missing reachable stub", the `when:`
  routing is wrong. Stop with `status=blocked`. Do not change `when:` to make the fixture pass.
- **p3's fixture edits:** the 17 fixtures that have a `review:` stub get a `review-large:` copy of
  it and a `<prefix>review-tier` stub. Included top-level nodes are renamed `tail__<id>`
  (`ship__tail__<id>` in devflow-audit), and loop-body nodes keep their ids. This exact rule was
  applied to a prototype, and every tail fixture passed, the red-path ones staying red in the same
  node. If a fixture still fails after the rule, the brief is wrong: stop with `status=blocked`.
- **Old plans (D9):** a run rendered before this change stops at `load-plan` with the model error.
  The user accepted that no such unrun plans exist (Q7 = C). Refining an old plan with
  devflow-refine adds the keys (D8).
- **The D2 text drifts between the six files:** p4 and p5 acceptance compares them byte for byte.
- **Default taken:** "phases has 7 or more entries" counts every manifest phase, including the
  retirement phase. The user said "phases" without qualification, and a mechanical count is what
  the validator can check.
- **Default taken:** settle-plan records blocking findings left after the last round and does not
  try to fix them. A fix there would not be validated on the large tier, and the user asked for the
  open findings to be visible (Q8).

## Implementation manifest

```yaml
plan_slug: devflow-model-tiers
feature_branch: feat/devflow-model-tiers
max_parallel: 3
review_model: medium
review_model_reason: 6 phases (fewer than 7), none on large, and not security-related (it changes model tiers only)
manual_before: []
manual_after: []
verify_after_merge:
  - scripts/test-render-run.sh
  - scripts/test-devflow-pack.sh
final_checks:
  - 'grep -rn "Opus" packs/devflow/devflow-plan/commands packs/devflow/devflow-refine/commands packs/devflow/devflow-phase/commands/implement-phase.md packs/devflow/devflow-tail/commands/review.md prints nothing, and grep -n "Sonnet" packs/devflow/devflow-phase/commands/implement-phase.md packs/devflow/devflow-tail/commands/review.md prints nothing'
  - 'grep -c "model: large" packs/devflow/devflow-plan/devflow-plan.yaml packs/devflow/devflow-refine/devflow-refine.yaml prints 1 for each file (only validate-plan)'
  - 'scripts/test-render-run.sh ends with "test-render-run: all ok" and scripts/test-devflow-pack.sh ends with "0 failed"'
phases:
  - id: p1-manifest-models
    title: Manifest model keys in the renderer and load-plan, and the pick-one script
    depends_on: []
    complexity: S
    model: small
    touches:
      - packs/devflow/.shared/render-run.ts
      - packs/devflow/.shared/load-plan.ts
      - packs/devflow/.shared/pick-one.ts
      - scripts/test-render-run.sh
      - scripts/fixtures/render-run/**
    brief: |
      Read the plan's Design sections D3 and D6 first; they hold the exact code.
      1. packs/devflow/.shared/render-run.ts: add the Phase and Manifest fields, TIERS and
         validateModels exactly as in D3 (validateModels directly after `waves`), and call
         `validateModels(o.manifest);` as the last statement of `validate(o)`.
      2. packs/devflow/.shared/load-plan.ts: the four edits of D3 (import, validation after
         extractManifest, `let model = ""` and its assignment in the phase branch, the new output line).
      3. Create packs/devflow/.shared/pick-one.ts with the exact content of D6.
      4. Fixtures in scripts/fixtures/render-run/:
         - three-wide.md: add top-level `review_model: large` and
           `review_model_reason: p3 is on large` after `max_parallel: 3`; give p1, p2, p4, p5
           `model: small`, and p3 `model: large` with `model_reason: security-sensitive parser`.
         - serial.md and cycle.md: add `review_model: medium` and `review_model_reason: two phases`
           after `feature_branch:`; give each phase `model: small`.
         - bad-id.md: leave unchanged (the id check runs before validateModels).
         - New bad-model.md: a copy of serial.md with heading `# bad-model test plan`, plan_slug
           `bad-model`, feature_branch `feat/bad-model`, and p2's `model: small` replaced by `model: haiku`.
         - New no-reason.md: a copy of serial.md with heading `# no-reason test plan`, plan_slug
           `no-reason`, feature_branch `feat/no-reason`, and p2's `model: small` replaced by
           `model: medium` (no model_reason).
         - New no-review-model.md: a copy of serial.md with heading `# no-review-model test plan`,
           plan_slug `no-review-model`, feature_branch `feat/no-review-model`, and the two
           review_model lines removed.
      5. scripts/test-render-run.sh:
         - After the "d2" block (after `echo "bad-id: ok"`), add a block "# d3. model keys are
           required" that, in the same style as d2, renders each new fixture with
           `--slug <name> --branch feat/<name> --title M --main main --pack test/devflow` and asserts
           it fails with, respectively: `phase 'p2': model must be small, medium or large (got "haiku")`,
           `phase 'p2': model medium needs a model_reason`,
           `review_model must be medium or large (got nothing)` (use `grep -qF`). End with `echo "models: ok"`.
         - In section e, after `echo "$out" | grep -q '"done":false'`, add
           `echo "$out" | grep -q '"model":"small"'` and `echo "$out" | grep -q '"review_model":"medium"'`.
         - After the `INPUTS_MODE=deliver lp env >/dev/null` line, add
           `INPUTS_MODE=deliver lp env | grep -q '"model":""'`.
         - Right before the final `echo "test-render-run: all ok"`, add a block "# h. pick-one" that runs
           `bun "$repo_root/packs/devflow/.shared/pick-one.ts"` three times, passing variables inline
           as `lp` does (the script unsets ambient INPUTS_* at its top, and nothing exports one): with `INPUTS_MEDIUM='{"a":1}'` only (stdout must equal `{"a":1}`); with no
           INPUTS_* set (must exit non-zero, stderr contains `got 0 (none)`); with `INPUTS_SMALL=x INPUTS_LARGE=y`
           (must exit non-zero, stderr contains `got 2 (small, large)`). End with `echo "pick-one: ok"`.
      6. Run `scripts/test-render-run.sh` and `scripts/test-devflow-pack.sh`; both must pass (the pack
         fixtures do not change in this phase).
      Stop with status=blocked if the existing "dependency cycle" or "invalid phase id" checks start
      failing because validateModels runs before them: that means the call is not last in validate().
    acceptance:
      - 'scripts/test-render-run.sh prints "models: ok", "pick-one: ok" and ends with "test-render-run: all ok"'
      - 'scripts/test-devflow-pack.sh ends with "0 failed"'
      - 'grep -n "export function validateModels" packs/devflow/.shared/render-run.ts prints one line'
      - 'grep -n "validateModels(manifest)" packs/devflow/.shared/load-plan.ts prints one line'

  - id: p4-plan-validation
    title: "devflow-plan: medium planning, a large validation loop, and the model rules"
    depends_on: []
    complexity: M
    model: medium
    model_reason: writes three new prompt files and edits three more from a spec whose exact wording it must compose
    touches:
      - packs/devflow/devflow-plan/devflow-plan.yaml
      - packs/devflow/devflow-plan/commands/**
      - packs/devflow/devflow-plan/fixtures/**
    brief: |
      Read the plan's Design sections D1, D2, D7 and D8 first.
      1. packs/devflow/devflow-plan/devflow-plan.yaml: the D1 edits (workflow model, draft, challenge,
         finalize on medium; insert the plan-check loop and settle-plan node verbatim before render;
         render depends_on [settle-plan]).
      2. New packs/devflow/devflow-plan/commands/validate-plan.md, fix-plan.md and settle-plan.md with the
         content D7 lists, in that order, each ending with the D2 section verbatim as its last section.
         The commands must not name devflow-plan or devflow-refine (p5 copies them byte for byte). Use
         `$ARTIFACTS_DIR` and `$preflight.output.devflow_root` the way finalize.md does.
      3. Edit draft.md, challenge.md and finalize.md as D8 says (the devflow-plan items), including the D2
         section verbatim before `## Output` in draft.md and finalize.md. The new finalize override is
         number 7.
      4. Fixtures in packs/devflow/devflow-plan/fixtures/:
         - happy-path.stubs.yaml and interview-done.stubs.yaml: add stubs
           `validate-plan: {blocking: 0, non_blocking: 1}` (as block YAML like the others),
           `fix-plan: fixed` and `settle-plan: {unresolved: 0}`.
         - New validation-unresolved.stubs.yaml: a copy of happy-path.stubs.yaml whose first comment line
           is `# The large validation never clears: the plan is published anyway, with the findings recorded.`,
           with `validate-plan: {blocking: 2, non_blocking: 0}` and `settle-plan: {unresolved: 2}`; it
           keeps `expect: completed`.
         - interview-user-stops.stubs.yaml: unchanged.
      5. Run scripts/test-devflow-pack.sh and scripts/test-render-run.sh.
      Stop with status=blocked if archon validate rejects the D1 YAML, or if validation-unresolved does
      not complete: do not add a gate or change the loop to make it pass.
    acceptance:
      - 'scripts/test-devflow-pack.sh ends with "0 failed" and lists devflow-plan/fixtures/validation-unresolved.stubs.yaml with "Simulation outcome: completed"'
      - 'grep -n "model:" packs/devflow/devflow-plan/devflow-plan.yaml shows medium for the workflow, draft, challenge, finalize, fix-plan and settle-plan, and large only for validate-plan'
      - 'for f in draft finalize validate-plan fix-plan settle-plan; do sed -n ''/^## Models: the smallest model for each phase$/,/^   then the line/p'' packs/devflow/devflow-plan/commands/$f.md | md5sum; done prints the same hash five times, and the extracted text is non-empty'
      - 'grep -c "Plan. subagent" packs/devflow/devflow-plan/commands/finalize.md prints 1 (only the "Do not run section 4''s `Plan` subagent" sentence)'
      - 'grep -rn "Opus" packs/devflow/devflow-plan/commands prints nothing'
      - 'grep -n "depends_on: \[settle-plan\]" packs/devflow/devflow-plan/devflow-plan.yaml prints the render node''s line'

  - id: p2-phase-routing
    title: devflow-phase runs each phase on its manifest model
    depends_on: [p1-manifest-models]
    complexity: S
    model: small
    touches:
      - packs/devflow/devflow-phase/**
    brief: |
      Read the plan's Design sections D4 and D6 first.
      1. packs/devflow/devflow-phase/devflow-phase.yaml: load-plan's output_format gains `model`
         (D4), and the `implement` node in the build loop is replaced by the four nodes of D4,
         verbatim. Do not touch `check`, `until_bash` or `gate`.
      2. Create packs/devflow/devflow-phase/scripts/pick-one.ts, the thin entry of D6.
      3. commands/implement-phase.md line 1: the D4 wording change.
      4. Fixtures in packs/devflow/devflow-phase/fixtures/:
         - In all three existing files, add `model: medium` as the last key of the `load-plan:` stub.
         - happy-path.stubs.yaml: rename the `implement:` stub key to `implement-medium:` and add an
           `implement:` stub with the same three fields after it (the picker is stubbed in non-exec fixtures).
         - blocked.stubs.yaml (exec-code): rename `implement:` to `implement-medium:` (the picker runs for real).
         - New small-route.stubs.yaml: `exec-code: true`, `fixture: {expect: completed}`, the preflight
           and setup stubs of happy-path, `load-plan` with `done: false` and `model: small`, an
           `implement-small` stub (status complete, phase p1-x, summary stub), the green `check` stub of
           happy-path and its `gate` stub. No implement-medium or implement-large stub.
         - New large-route.stubs.yaml: the same with `model: large` and an `implement-large` stub.
      5. Run scripts/test-devflow-pack.sh.
      Stop with status=blocked if small-route or large-route fails with "Missing reachable stub" for
      another tier's node: the routing is wrong, and changing `when:` to make it pass is not allowed.
    acceptance:
      - 'scripts/test-devflow-pack.sh ends with "0 failed" and shows small-route.stubs.yaml and large-route.stubs.yaml with "Simulation outcome: completed"'
      - 'grep -c "command: implement-phase" packs/devflow/devflow-phase/devflow-phase.yaml prints 3'
      - 'grep -n "script: pick-one" packs/devflow/devflow-phase/devflow-phase.yaml prints one line'
      - 'grep -n "Sonnet" packs/devflow/devflow-phase/commands/implement-phase.md prints nothing'

  - id: p3-review-routing
    title: devflow-tail and devflow-deliver run the final review on the plan's review model
    depends_on: [p1-manifest-models]
    complexity: M
    model: small
    touches:
      - packs/devflow/devflow-tail/**
      - packs/devflow/devflow-deliver/**
      - packs/devflow/devflow-quick/fixtures/**
      - packs/devflow/devflow-docs/fixtures/**
      - packs/devflow/devflow-config/fixtures/**
      - packs/devflow/devflow-deps/fixtures/**
      - packs/devflow/devflow-audit/fixtures/**
      - packs/devflow/devflow-audit-fix/fixtures/**
    brief: |
      Read the plan's Design sections D5 and D6 first.
      1. packs/devflow/devflow-tail/devflow-tail.yaml: add `inputs:`, the `review-tier` node,
         `review-loop`'s `depends_on: [review-tier]`, and replace the `review` node with the three
         nodes of D5, verbatim. Update the description and the l.15 comment as D5 says.
      2. Create packs/devflow/devflow-tail/scripts/pick-one.ts, the thin entry of D6.
      3. packs/devflow/devflow-tail/commands/review.md line 8: the D5 wording change.
      4. packs/devflow/devflow-deliver/devflow-deliver.yaml: load-plan's output_format gains
         `review_model`, and the `tail` include gains the `with:` of D5.
      5. Fixtures. Do not edit any workflow YAML other than devflow-tail and devflow-deliver.
         - The 17 fixtures that have a top-level `review:` stub, listed by
           `grep -ln "^review:" packs/devflow/*/fixtures/*.yaml`, get two edits each:
           a. directly before the `review:` line, a `review-large:` stub whose body is a copy of
              the `review:` body (the same indented lines). Keep the `review:` stub: it now stubs
              the picker in non-exec fixtures.
           b. as the file's last line, `tail__review-tier: '{"model":"large"}'`, or
              `ship__tail__review-tier: '{"model":"large"}'` in the two packs/devflow/devflow-audit/fixtures/
              files. Included top-level nodes are renamed `<include id>__<id>`; loop-body nodes such
              as `review-large` keep their ids.
         - Both packs/devflow/devflow-deliver/fixtures files also get `review_model: large` as the
           last key of the `load-plan:` stub.
         - No other fixture changes. Exec-code fixtures get the same stubs (stubs win over real code).
         - New packs/devflow/devflow-deliver/fixtures/medium-review.stubs.yaml: start from the edited
           happy-path.stubs.yaml; put `exec-code: true` as its first key (before `fixture:`); make the
           first comment line `# The plan's review_model is medium: only the medium review runs.`;
           set `review_model: medium` in the load-plan stub; rename the `review:` stub key to
           `review-medium:`; delete the `review-large:` and `tail__review-tier:` stubs (review-tier
           and the picker run for real, and review-large must not run).
      6. Run scripts/test-devflow-pack.sh; it must end with "0 failed". A red-path fixture
         (review-never-clears, dod-stays-red, fast-stays-red, ...) must still fail in the node it names
         today. Only stubs may change; never change a fixture's `expect` or `fail-node`.
      Stop with status=blocked if medium-review fails with "Missing reachable stub for node
      'review-large'" (the routing is wrong), or if any fixture still fails after these exact edits:
      do not invent other stub changes and never edit an includer's workflow YAML.
    acceptance:
      - 'scripts/test-devflow-pack.sh ends with "0 failed" and shows devflow-deliver/fixtures/medium-review.stubs.yaml with "Simulation outcome: completed"'
      - 'grep -n "default: large" packs/devflow/devflow-tail/devflow-tail.yaml prints the review_model input'
      - 'grep -n ''review_model: "$load-plan.output.review_model"'' packs/devflow/devflow-deliver/devflow-deliver.yaml prints one line'
      - 'git diff --name-only <this phase''s base commit> HEAD -- ''packs/devflow/*/*.yaml'' lists only packs/devflow/devflow-tail/devflow-tail.yaml and packs/devflow/devflow-deliver/devflow-deliver.yaml'
      - 'grep -n "Opus" packs/devflow/devflow-tail/commands/review.md prints nothing'

  - id: p5-refine-validation
    title: devflow-refine gets the same models, validation loop and rules
    depends_on: [p4-plan-validation]
    complexity: S
    model: small
    touches:
      - packs/devflow/devflow-refine/devflow-refine.yaml
      - packs/devflow/devflow-refine/commands/**
      - packs/devflow/devflow-refine/fixtures/**
    brief: |
      Read the plan's Design sections D1, D2, D7 and D8 first, and look at what p4 did to
      packs/devflow/devflow-plan/ (git log -- packs/devflow/devflow-plan).
      1. packs/devflow/devflow-refine/devflow-refine.yaml: the D1 edits, the same as p4 made in
         devflow-plan.yaml (workflow model, draft, challenge, finalize on medium; the plan-check loop
         and settle-plan node verbatim, inserted before `render`; render depends_on [settle-plan]).
         `still-unstarted` and `publish` stay as they are.
      2. Copy packs/devflow/devflow-plan/commands/validate-plan.md, fix-plan.md and settle-plan.md to
         packs/devflow/devflow-refine/commands/ unchanged (cp).
      3. Edit devflow-refine's draft.md, challenge.md and finalize.md as D8 says, including the refine-only
         bullet in draft.md step 3. The new finalize override is number 8. Copy the D2 section from
         packs/devflow/devflow-plan/commands/draft.md so it is byte-identical.
      4. Fixtures in packs/devflow/devflow-refine/fixtures/: happy-path.stubs.yaml gets the three stubs
         p4 added to devflow-plan's happy-path. interview-user-stops and refuse-started are unchanged.
      5. Run scripts/test-devflow-pack.sh.
      Stop with status=blocked if a copied command file does not fit devflow-refine (it names
      devflow-plan, or reads a node devflow-refine does not have).
    acceptance:
      - 'for f in validate-plan fix-plan settle-plan; do cmp packs/devflow/devflow-plan/commands/$f.md packs/devflow/devflow-refine/commands/$f.md; done prints nothing and exits 0'
      - 'for f in devflow-plan/commands/draft devflow-refine/commands/draft devflow-refine/commands/finalize devflow-refine/commands/validate-plan devflow-refine/commands/fix-plan devflow-refine/commands/settle-plan; do sed -n ''/^## Models: the smallest model for each phase$/,/^   then the line/p'' packs/devflow/$f.md | md5sum; done prints the same hash six times, and the extracted text is non-empty'
      - 'grep -n "model:" packs/devflow/devflow-refine/devflow-refine.yaml shows large only for validate-plan'
      - 'grep -rn "Opus" packs/devflow/devflow-refine/commands prints nothing'
      - 'scripts/test-devflow-pack.sh ends with "0 failed"'

  - id: p6-docs-retire
    title: Document the model tiers and retire the plan
    depends_on: [p1-manifest-models, p2-phase-routing, p3-review-routing, p4-plan-validation, p5-refine-validation]
    complexity: S
    model: small
    touches:
      - packs/devflow/README.md
    brief: |
      Retirement phase. The profile has no ADR directory and no changelog, and the plan is not on this
      branch, so the only work is the reference doc.
      1. packs/devflow/README.md: make exactly the D10 edits (the includer list, devflow-plan steps 1-5
         with the new Validate step 3, the paragraph after the steps, devflow-refine step 3).
      2. Check every statement the edits make against the merged code: tiers in
         devflow-plan.yaml/devflow-refine.yaml, the 3-round loop, devflow-tail's default, and the
         includer list (grep -rn "include: devflow-tail" packs/devflow).
      3. Run scripts/test-render-run.sh and scripts/test-devflow-pack.sh.
      Stop with status=blocked if the code contradicts a D10 sentence: report the difference and do
      not reword around it.
    acceptance:
      - 'grep -n "large tier" packs/devflow/README.md shows only the Validate step'
      - 'grep -n "Phases and models" packs/devflow/README.md prints one line'
      - 'grep -n "devflow-config" packs/devflow/README.md includes the devflow-tail includer sentence'
      - 'scripts/test-render-run.sh and scripts/test-devflow-pack.sh both pass'
```
