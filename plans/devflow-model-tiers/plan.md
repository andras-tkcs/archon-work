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
- If the large-tier review still has findings after its last round, the plan is published
  anyway. The findings go into "Risks and open questions", and a warning at the top of plan.md
  points to them. If the renderer or `validate_manifest.py` still rejects the plan, the run fails
  and publishes nothing, as main does today.

The request (the run's message): "update the devflow-plan skill. it runs with medium model and at the
end validation runs with large (and plan fixes with sonnet again). the plan must make the
implementation plan well structured and use as small model as possible. consider small model by
default for all implementation phases and if considered too complex use medium and if needed further
escalate to large. plan.md should provide a phases - models overview. final build review medium or
large depending on the size and the nature (e.g. security related large)". There is no issue.

## Current state

All paths are relative to the repository root. `<pack>` is `packs/devflow`. Checked against main
at `e987eb9` (after PR #22 mod-workflows-plan-test, #23 gh-admin-baseline and #24
pack-default-from-own-run were merged).

### What moved on main since this plan was written (refinement, 2026-11-05)

- **PR #22 gave devflow-plan a large-tier plan test loop.** `<pack>/devflow-plan/devflow-plan.yaml`
  now has, after the interview, a `plan-loop` loop (l.117-221, `max_iterations: 3`,
  `until_bash` on `$plan-check.output.done`) holding `finalize` (`model: large`, l.124-137, it is
  also the fixer: in rounds 2-3 it reads `test-findings.md` and fixes the plan in place),
  `render` (`render-run`, `soft_errors: "true"`, plan errors become `{ok:false,error}` output),
  `plan-test` (`test-plan` script: `validate_manifest.py` and a dry run of the rendered workflow),
  `plan-review` (`command: review-plan`, `model: large`, `denied_tools: [Write, Edit,
  NotebookEdit]`, the "executability reviewer") and `plan-check` (`check-plan` script, which
  writes `tested.json` when there are no findings, else `test-findings.md`). After the loop,
  `plan-result` (l.223-234) fails unless `tested.json` exists, and `publish` (l.236) depends on it.
  **When findings remain after round 3, `check-plan.ts` fails the node and nothing is published**
  (the red fixture `devflow-plan/fixtures/plan-test-never-clears.stubs.yaml`, `fail-node:
  plan-result`). That was decision D4 of the mod-workflows-plan-test plan: "If findings remain
  after that, the run fails with them and publishes nothing."
- So the original D1 (a new `plan-check` loop with `validate-plan`/`fix-plan` after `finalize`,
  and `render` depending on `settle-plan`) no longer fits: the id `plan-check` is taken, `render`
  is inside `plan-loop`, and main already has a large validator (`review-plan`) and a fixer
  (`finalize` in a fix round). D1, D7 and D8 below are rewritten to build on the existing loop.
- `finalize.md` (devflow-plan) now has `## Fix rounds` (l.34-49) and `## Assumptions` (l.51-58,
  the section right before the Implementation manifest heading). Its l.1 still says "(Opus)", l.13-16
  still name the section 4 `Plan` subagent, override 2 (l.69) still says "Run the section 4 `Plan`
  subagent review too.", and `## Output` (l.97-101) still has the "reviewer's findings" sentence.
- `review-plan.md` l.1-2: "You are the **executability reviewer** (Opus, a fresh session) for a plan
  that a Sonnet worker will implement phase by phase." It checks seven points per phase and returns
  `{clean, summary, findings[{id, source: review, kind: mechanical|open-decision, phase, problem,
  fix}]}`. It does not check models.
- **devflow-refine did not get the test loop.** `devflow-refine.yaml` still has a single
  `finalize` (l.144-159, `model: large`), `render` (l.161-180, no `soft_errors`, output
  `{workflow, file, waves}`), `still-unstarted` (l.182) and `publish` (l.199). Its scripts are thin
  entries into `.shared/`; `test-plan.ts`, `check-plan.ts` and `plan-result.ts` live only in
  `<pack>/devflow-plan/scripts/` with their logic inline.
- PR #24 only changed the `pack` input default of devflow-plan and devflow-refine
  (`render-plan.ts`); nothing here depends on it. PR #23 moved devflow-config's
  `include: mod-devflow-tail` from l.261 to l.181.
- `grep -ln "^review:" <pack>/*/fixtures/*.yaml` now lists **18** fixtures (was 17), and the pack has
  35 `*.stubs.yaml` fixtures.
- `scripts/test-render-run.sh` already uses the section names `d3` (render-run node), `d4`
  (test-plan) and `d5` (check-plan). The new model-key block is `d6`.
- `<pack>/README.md`: the mod-devflow-tail includer sentence is now l.30 and still lists four
  includers; "devflow-plan, step by step" is l.72 and step 1 (l.74) says "(large tier)".

### As it was when the plan was written (line numbers may be stale; the section above wins)

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
- `<pack>/mod-devflow-phase/mod-devflow-phase.yaml`: workflow `model: medium` (l.9). The `build` loop
  (l.64-96) has `implement` (l.69-79, `command: implement-phase`, `model: medium`) and `check`.
  `until_bash` (l.95) reads `$implement.output.status`. `load-plan` (l.48-62) returns
  `{slug, branch, title, done}`. `commands/implement-phase.md` l.1 says "(Sonnet)" and l.15 reads
  `$LOOP_PREV.implement.output`.
- `<pack>/mod-devflow-tail/mod-devflow-tail.yaml`: no `inputs:`. The `review-loop` (l.18-41) holds
  `fix-blocking` (medium, `when: "$LOOP_PREV.review.output.blocking > 0"`) and `review`
  (l.26-39, `model: large`). `until_bash` reads `$review.output.blocking`, and `review-gate` (l.43)
  reads `$review-loop.output.blocking`. `commands/review.md` l.8 says "(Opus) for a plan that Sonnet
  workers implemented". mod-devflow-tail is included by mod-devflow-deliver (l.110), devflow-quick (l.132),
  devflow-docs (l.131), devflow-config (l.261), devflow-deps (l.239) and mod-devflow-audit-fix (l.158).
  devflow-audit includes mod-devflow-audit-fix.
- `<pack>/mod-devflow-deliver/mod-devflow-deliver.yaml`: workflow `model: large` (l.8). `load-plan`
  (l.54-68) returns `{slug, branch, title, done}`. The `tail` include (l.109-111) has no `with:`.
- `<pack>/.shared/render-run.ts`: the `Phase` (l.5-9) and `Manifest` (l.11-18) interfaces,
  `extractManifest` (l.35), `validate` (l.64-72, called first in `renderRunWorkflow`, l.75) and the
  CLI (l.282-310). It renders one `workflow: <pack>:mod-devflow-phase` node per phase and one
  `mod-devflow-deliver` node. `<pack>/.shared/load-plan.ts` imports `extractManifest` (l.5), reads the
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
    medium-routed mod-devflow-deliver completed with only the `review-medium` stub, and a devflow-plan
    whose validation never clears still completed and published.
- Tests: `scripts/test-render-run.sh` (renderer, load-plan, publish-plan and load-published, with
  fixtures in `scripts/fixtures/render-run/`) and `scripts/test-devflow-pack.sh` (`archon validate
  workflows` and every `<pack>/*/fixtures/*.stubs.yaml`; 35 fixtures today).
- The profile (`.claude/toolkit.yaml`) has no `docs.adr_dir` and no `docs.changelog`. Its must-read
  docs are `README.md` and `<pack>/README.md`. `<pack>/README.md` l.72 says the interview runs on
  the "large tier", and l.27-29 list only four of mod-devflow-tail's six includers.

## Design

### Refinement

The requested change: "main moved since the plan. review and update if needed". Main moved from
the plan's base to `e987eb9` (PRs #22-#24). Every file this plan touches was re-read against
`e987eb9`; "What moved on main" under Current state lists what changed. The result: D1, D7, D7a
and D8 now build on main's existing `plan-loop` (PR #22) instead of adding a loop, devflow-refine
gets that loop (p5), and the one conflict with main (Q8 against PR #22's fail-and-publish-nothing)
is settled by refinement Q2 = C (decision 5). Phase ids, the slug `devflow-model-tiers` and the
branch `feat/devflow-model-tiers` are unchanged.

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
5. **Q8 = "a but put to the plan page top the highlight", narrowed by refinement Q2 = C:** main
   (PR #22) fails and publishes nothing when findings remain after round 3. Now: if only
   `plan-review` findings remain after the last round, the plan is still published. They go into
   `### Unresolved validation findings` under "Risks and open questions", and a `> [!WARNING]`
   callout right under the plan's title points to them (D7a). If any `render` or
   `validate_manifest` finding remains, the run fails and publishes nothing, as on main: such a plan
   would fail at its first phase. The same applies to devflow-refine.
6. **The request:** planning runs on medium, the final validation on large, and plan fixes on medium
   ("sonnet"). Phases default to small and escalate to medium or large only with a reason. plan.md
   has a phases/models overview. The final build review is medium or large by size and nature.

### D1. Planning models (devflow-plan and devflow-refine), on top of main's plan test loop

Main already validates the plan on the large tier (`plan-review`, `review-plan.md`) and lets
`finalize` fix it in up to two more rounds (see Current state). That is exactly the request's
shape ("validation runs with large, and plan fixes with sonnet again") once `finalize` runs on
medium. So no new validation loop is added: the existing one is reused.

In `<pack>/devflow-plan/devflow-plan.yaml`:

- workflow `model: large` → `model: medium`.
- `draft`, `challenge` and `finalize`: `model: large` → `model: medium`. `finalize` writes the plan
  (round 1) and applies the validation's fixes (rounds 2-3) on medium.
- `plan-review` stays `model: large`. It is the large-tier validation, and gets the model rules
  (D7).
- `render`, `plan-test`, `plan-check`, `plan-result` and `publish` are not restructured, and no
  node is added. Only the last-round behaviour of `check-plan.ts` and the plan.md copy step of
  `publish-plan.ts` change (D7a, decision 5).

In `<pack>/devflow-refine/devflow-refine.yaml` (decision 2: refine gets the same validation):

- workflow, `draft`, `challenge`, `finalize`: `model: medium`.
- `finalize` and `render` move into a `plan-loop` identical to devflow-plan's (`finalize`,
  `render` with `soft_errors: "true"`, `plan-test`, `plan-review` on large, `plan-check`), followed by
  `plan-result`; `still-unstarted` depends on `plan-result` and `publish` reads
  `$plan-result.output.*` for `title` and `workflow`. `render` keeps reading `$load.output.slug`
  and `$load.output.branch`.
- `test-plan.ts`, `check-plan.ts` and `plan-result.ts` move from `<pack>/devflow-plan/scripts/` to
  `<pack>/.shared/` (their `../../.shared/util.ts` imports become `./util.ts`), and both workflows
  get two-line thin entries for them, as PR #21 did for `publish-plan` and `render-run`. p4 does
  the move and devflow-plan's thin entries (before its check-plan change); p5 adds devflow-refine's.
  devflow-refine gets a byte-identical copy of `review-plan.md`, and devflow-refine's `finalize.md`
  gets devflow-plan's `## Fix rounds` and `## Assumptions` sections.

### D2. The model rules (one canonical section)

This exact section, from the `## Models: the smallest model for each phase` line to the end of
rule 7, goes byte-identically into six command files: devflow-plan's and devflow-refine's
`draft.md`, `finalize.md` and `review-plan.md`. Put it directly before `## Output` in draft.md and
finalize.md, and as the last section of review-plan.md (D7).

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
- The rendered workflow does not change. mod-devflow-phase and mod-devflow-deliver read the tiers from the
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

### D4. Phase model routing (mod-devflow-phase)

In `<pack>/mod-devflow-phase/mod-devflow-phase.yaml`:

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

### D5. Review model routing (mod-devflow-tail and mod-devflow-deliver)

In `<pack>/mod-devflow-tail/mod-devflow-tail.yaml`:

- Add, after `returns: finish`:

```yaml
inputs:
  review_model:
    default: large
    description: The tier of the final review, medium or large. mod-devflow-deliver passes the plan's review_model; the other includers keep the default.
```

- Add a first node, before `review-loop`, and give `review-loop` `depends_on: [review-tier]`. The
  tier goes through a bash node because a literal include value in a `when:` fails the load. If
  p3's `default-review-tier` fixture shows that `$INPUTS.review_model` is not substituted when the
  includer passes no `with:` (review-tier fails with `not ''` or `not '$INPUTS.review_model'`),
  replace the line `m=$INPUTS.review_model` with `m="${INPUTS_REVIEW_MODEL-}"` (the environment
  variable that Current state says included inputs reach bash nodes as). That is the only allowed
  change to this node:

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

In `<pack>/mod-devflow-deliver/mod-devflow-deliver.yaml`:

- `load-plan`'s `output_format` gains `review_model: { type: string }`, and `required` becomes
  `[slug, branch, title, done, review_model]`.
- The `tail` include gains:

```yaml
    with:
      review_model: "$load-plan.output.review_model"
```

The other five includers (devflow-quick, devflow-docs, devflow-config, devflow-deps,
mod-devflow-audit-fix) are not edited. They get the default `large`, so their behaviour does not change.
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
`<pack>/mod-devflow-tail/scripts/verify.ts`:

```ts
// Thin entry point: the logic lives in the pack's .shared/pick-one.ts.
import "../../.shared/pick-one.ts";
```

at `<pack>/mod-devflow-phase/scripts/pick-one.ts` (p2) and `<pack>/mod-devflow-tail/scripts/pick-one.ts`
(p3).

### D7. The large validation: review-plan.md checks the model rules

`<pack>/devflow-plan/commands/review-plan.md` (and its devflow-refine copy, byte-identical):

- l.1-2: "You are the **executability reviewer** (Opus, a fresh session) for a plan that a Sonnet
  worker will implement phase by phase." → "You are the **executability reviewer** (a fresh
  session on the large tier) for a plan whose phases worker sessions implement on the model tier
  the manifest gives each."
- New check 8 after check 7: "Every model rule below holds. A `small` phase whose brief is not
  mechanical enough for small (rule 2), a `medium` or `large` phase whose `model_reason` does not
  meet rule 3 or 4, a `small` phase that would need rule 3 or 4, a `review_model` that breaks rule
  6, and a `## Phases and models` table or final-review line that does not match the manifest
  (rule 7) are each a `mechanical` finding."
- The D2 section verbatim as the file's last section.

The findings flow through main's existing `check-plan` → `test-findings.md` → `finalize` (medium)
fix round. No `validate-plan`, `fix-plan` or `settle-plan` command is created.

### D7a. Findings left after the last round (decision 5)

No AI step is added: two scripts change.

`<pack>/devflow-plan/scripts/check-plan.ts` (p4 moves it to `<pack>/.shared/check-plan.ts` first), the `round >= MAX_ROUNDS`
branch only (rounds 1-2 and the clean path are unchanged, except that the clean path also removes
a stale `unresolved.md` the way it removes `test-findings.md`):

- If any finding has `source` other than `review` (that is `render` or `validate_manifest`), fail
  as today. Keep the message's "after 2 fix rounds" and "nothing was published" wording; it lists
  all findings.
- Otherwise (only `review` findings): write `tested.json` exactly as the clean path does, plus an
  `unresolved` key holding the number of findings. Keep `test-findings.md`. Write
  `$ARTIFACTS_DIR/unresolved.md` with this content (one bullet per finding, the problem's first
  line, the same as today's failure message lines):

  ```markdown
  ### Unresolved validation findings

  The large-tier review still reported these after its last round. The plan was published anyway.
  The full findings are `test-findings.md` in the planning run's artifacts.

  - F1 [review, mechanical] p1-x: <problem's first line>
  ```

  Print `{"done":true,"round":<round>,"findings":<n>}` and exit 0.

`<pack>/.shared/publish-plan.ts`: before step 2 copies plan.md, if `$ARTIFACTS_DIR/unresolved.md`
exists, rewrite `$ARTIFACTS_DIR/plan.md` in place (so the published copy and the artifact agree):

- Directly after the first line that starts with `# ` (the title), insert a blank line and
  ```markdown
  > [!WARNING]
  > This plan was published with <n> unresolved validation findings. Read "Unresolved validation
  > findings" under "Risks and open questions" before you run it.
  ```
  where `<n>` is the number of `- F` bullets in unresolved.md.
- Insert unresolved.md's content, preceded and followed by a blank line, at the end of the last
  non-fenced `## Risks and open questions` section (right before the next `## ` heading). If the
  plan has no such section, insert `## Risks and open questions`, a blank line and the content
  directly before the last non-fenced `## Assumptions`, else before `## Implementation manifest`.
- Do nothing if plan.md already contains the line `### Unresolved validation findings` (a re-run of
  publish must not add it twice).
- The output JSON gains `unresolved: <n>` (0 when the file does not exist).

The manifest (`## Implementation manifest`) is never touched, so `load-plan` and the renderer read
the same manifest that was validated.

### D8. Edits to the existing planning commands

> Refinement: on main, devflow-plan's `finalize.md` already says to skip the section 4 review in a
> fix round, and has `## Fix rounds` and `## Assumptions`. The `finalize.md` edits below still apply
> to the first-pass text (l.1, l.13-16, override 2 at l.69, `## Output` l.97-101); "the next step
> validates the plan on the large tier" refers to `plan-review`. The new override "Risks and open
> questions, and the table" must keep `## Assumptions` right before `## Implementation manifest`:
> the order is `## Risks and open questions`, `## Assumptions`, `## Implementation manifest`.
> devflow-refine's `finalize.md` additionally gets devflow-plan's `## Fix rounds` and
> `## Assumptions` sections (D1).

Apply the same edits to devflow-plan's and devflow-refine's copies (p4 and p5):

- `draft.md` l.1: "You are the **planner** for this change (Opus)." → "You are the **planner** for
  this change." In "Your authority", after "...section 3 (manual steps only at the very beginning
  and the very end)", add ", and the model rules below". Insert the D2 section before `## Output`.
  devflow-refine's `draft.md` step 3 (l.48-50) is prose with no list: add two `-` sub-bullets
  indented three spaces directly after its last line ("...End the file with an `## Open questions`
  list."). The first: "If
  `original/plan.md` has no `model` on a phase or no `review_model`, add them by the model rules
  below. That is part of the refinement, not a question." The second: "If
  `original/plan.md` has a `> [!WARNING]` callout about unresolved validation findings under its
  title, or a `### Unresolved validation findings` subsection, drop both from the draft: this
  run's validation decides again. Treat the listed findings as review input for the refinement."
- `challenge.md` l.1: "You are the **challenger** (Opus, a fresh session)." → "You are the
  **challenger** (a fresh session)."
- `finalize.md`:
  - l.1: "(Opus), writing the final plan" → ", writing the final plan".
  - In "Your authority", replace "section 3 (manual steps only at the very beginning and the very
    end) and section 4 (a fresh `Plan` subagent on Opus reviews the plan, then
    `validate_manifest.py`), with the overrides below." with "section 3 (manual steps only at the
    very beginning and the very end) and the model rules below, with the overrides below. Do not run
    section 4's `Plan` subagent: the next step validates the plan on the large tier and applies its
    findings." Wrap the paragraph so that the phrase "the next step validates the plan on the
    large tier" stays on one line (p4's acceptance greps it).
  - In override 2, delete the sentence "Run the section 4 `Plan` subagent review too."
  - In `## Fix rounds` (devflow-plan l.47-48), delete the sentence "Skip the section 4 `Plan`
    subagent review in a fix round: the plan test's reviewer replaces it." (no pass runs it now);
    the bullet keeps "Keep `slug`, `branch` and `title` unchanged. Rerun `validate_manifest.py`."
  - After override 6 (devflow-plan) or override 7 (devflow-refine), add the next-numbered override:
    "**Risks and open questions, and the table.** Both scopes have a `## Risks and open questions`
    section directly before `## Assumptions` (which stays right before `## Implementation
    manifest`), and the `## Phases and models` section of model rule 7."
  - Insert the D2 section before `## Output`.
  - In `## Output`, replace "Stop when `$ARTIFACTS_DIR/plan.md` exists, passes
    `validate_manifest.py`, and the reviewer's findings are fixed or answered in the plan's "Risks
    and open questions"." with "Stop when `$ARTIFACTS_DIR/plan.md` exists and passes
    `validate_manifest.py`."

### D9. Workflows rendered before this change (decision 4)

No compatibility code is added. A `devflow-run-<slug>` rendered before this change still passes
`phase`, `base` and the rest, and the new mod-devflow-phase and mod-devflow-deliver read the tiers from the
plan. For an old plan with no `model` keys, `load-plan` therefore fails with D3's message
(`phase '<id>': model must be small, medium or large (got nothing)`). Validation is shared with the
renderer, so the run stops and implements nothing. It never runs silently without an implement step.
This is a consequence of the strict shared validation, not an added path. The README gets no note
about it.

### D10. Docs

`<pack>/README.md`:

- l.30: mod-devflow-tail's includers become "`devflow-quick`, `devflow-docs`, `devflow-config`,
  `devflow-deps`, `mod-devflow-audit-fix` (which `devflow-audit` includes) and `mod-devflow-deliver`".
- In "devflow-plan, step by step" (l.72-95; the steps are Interview, Plan, Render, Test,
  Publish on main):
  - Step 1: "(large tier)" → "(medium tier)".
  - Step 2: "**Plan**:" → "**Plan** (medium tier):", and after "validated by the toolkit's
    `validate_manifest.py`." insert "Each phase gets the smallest model tier that can do it
    (`small` by default, `medium` or `large` with a reason), and the plan gets a final-review
    tier: `large` for security-related changes, for a plan with a `large` phase or with 7 or more
    phases, else `medium`. A **Phases and models** table in plan.md shows them all."
  - Step 4, second bullet: "A fresh reviewer then walks" → "A fresh reviewer on the large tier then
    walks", and append "It also checks each phase's model tier and the final-review tier against
    the model rules."
  - Step 4, third bullet: replace "Findings go back to the planner for up to two fix rounds. If
    findings remain, the run fails and nothing is published (`test-findings.md` in the run's
    artifacts)." with "Findings go back to the planner (medium tier) for up to two fix rounds. If
    the renderer or the manifest validator still rejects the plan, the run fails and nothing is
    published (`test-findings.md` in the run's artifacts). If only reviewer findings remain, the
    plan is published anyway: they are listed under "Unresolved validation findings" in its
    "Risks and open questions", with a warning under its title."
- In the paragraph after the steps, replace "each as a `mod-devflow-phase` child run in its own
  worktree" with "each as a `mod-devflow-phase` child run in its own worktree on the phase's model
  tier". Replace "and the shared tail (review, fixes, ..." with "and the shared tail (review on the
  plan's final-review tier, fixes, ...".
- In "devflow-refine, step by step", step 3, append: "It uses the same tiers and validation as
  `devflow-plan`, and adds phase and review tiers to an older plan that has none."

Keep the README's wrapping at about 100 characters, but wrap so that "**Phases and models**" and
"A fresh reviewer on the large tier" each stay on one line (p6's acceptance greps them).

Root `README.md` is unchanged: it describes the pack only by link.

### Rejected alternatives

- **Run-time escalation** (retry a blocked small phase on medium, then large) was rejected by the
  user (Q2). It costs more on failure and hides bad briefs.
- **Passing `model` and `review_model` as workflow inputs from the renderer:** the plan already
  holds them, and `load-plan` reads the plan at `plan_commit`. A second source could drift, and the
  rendered workflow stays unchanged.
- **Reusing `worker_model`:** the toolkit validator allows only `opus|sonnet`.
- **`$INPUTS.review_model` directly in mod-devflow-tail's `when:`:** an includer's literal value makes
  the expression unparseable at load time. The `review-tier` bash node avoids that.
- **Duplicating the whole review loop, or the whole build loop, per tier:** that would change every
  downstream reference (`until_bash`, `review-gate`, `$LOOP_PREV.*`). The picker keeps the ids
  `implement` and `review`.

### Refinement notes for the phases (folded into the briefs)

- p1 (renderer): the new test block is `# d6. model keys are required`, after the `d5` block
  (check-plan). A plan with a bad model key reaches `render-run` with `soft_errors`, so the error
  becomes an `ok:false` finding that `finalize` can fix; no change to render-plan.ts is needed.
  test-plan's dry run stubs the child workflows, so it is not affected by D4/D5.
- p4 (devflow-plan): D1's model changes, review-plan.md (D7), D7a in check-plan.ts and
  publish-plan.ts, draft/challenge/finalize (D8), and the `plan-test-never-clears` fixture split.
  It touches `scripts/test-render-run.sh` like p1, so it depends on p1.
- p4 moves test-plan/check-plan/plan-result to `.shared/` with devflow-plan's thin entries (step
  0, before its check-plan change), so p5 stays within M.
- p5 (devflow-refine): grows to the plan-loop of D1, devflow-refine's three thin entries, and refine fixtures that stub `render`'s new output shape and
  the loop's nodes. `complexity: M`, `model: medium`.
- p3 (review routing): 18 fixtures with a `review:` stub, not 17.

## Phases and models

| Phase | Title | Complexity | Depends on | Model | Why this model |
|---|---|---|---|---|---|
| p1-manifest-models | Manifest model keys in the renderer and load-plan, and the pick-one script | S | — | small | default |
| p4-plan-validation | devflow-plan: medium planning, the model rules in the large review, publish with unresolved review findings | M | p1-manifest-models | medium | moves three scripts to .shared/, edits four prompt files and two scripts, and must compose the model-rule text and the last-round behaviour exactly from the spec |
| p2-phase-routing | mod-devflow-phase runs each phase on its manifest model | S | p1-manifest-models | small | default |
| p3-review-routing | mod-devflow-tail and mod-devflow-deliver run the final review on the plan's review model | M | p1-manifest-models | small | default |
| p5-refine-validation | devflow-refine gets the same models, validation loop and rules | M | p4-plan-validation | medium | restructures devflow-refine.yaml into the plan loop and adapts devflow-plan's loop fixtures to devflow-refine's nodes |
| p6-docs-retire | Document the model tiers and retire the plan | S | p1-manifest-models, p2-phase-routing, p3-review-routing, p4-plan-validation, p5-refine-validation | small | default |

Final build review: **medium**. 6 phases (fewer than 7), none on large, and not security-related (it changes model tiers only)

## Manual steps

None. Archon 0.13.4 already supports everything used here. The pack reaches runners through the
existing sync that the READMEs document (`bootstrap.sh` or `archon plugin update`), and that is
not a step of this plan.

## Risks and open questions

- **From the interview, "Why no more questions":** the scope is devflow-plan, devflow-refine,
  mod-devflow-phase, mod-devflow-tail and mod-devflow-deliver with their includers' fixtures, the renderer and
  its tests, and the docs. Behaviour is settled by Q2 (picked once), Q6 (>= 7 phases), Q7 (C: no
  handling of old rendered workflows) and Q8 as narrowed by refinement Q2 = C (publish with a top callout when only review findings remain; fail on renderer or validator findings). Names follow the
  pack's conventions. No credentials, secrets or permissions change. There are no prerequisites
  and no after-merge steps. The profile has no ADR directory and no changelog, so there are no ADRs
  and no changelog line.
- **This plan's own run uses the pack as it is today.** Its `model` and `review_model` keys are
  ignored when this plan is implemented: every phase runs on medium and the final review on large.
  That is expected, not a failure.
- **Archon rejects the YAML anchors in D4/D5:** write each `output_format` out in full (the only
  allowed deviation). If `archon validate` rejects anything else in D1, D4 or D5 (`trigger_rule:
  one_success`, `when:` on `$load-plan.output.model` inside a loop, `with:` on the `tail` include,
  `inputs:` on mod-devflow-tail), the brief is wrong: stop with `status=blocked` and paste the
  validator output. The prototype accepted all of them on Archon 0.13.4.
- **A routed fixture does not route:** if a fixture's `implement-<tier>` or `review-<tier>` stub is
  reported as an unused stub while another tier's node reports "Missing reachable stub", the `when:`
  routing is wrong. Stop with `status=blocked`. Do not change `when:` to make the fixture pass.
- **p3's fixture edits:** the 18 fixtures that have a `review:` stub get a `review-large:` copy of
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
- **Default taken:** `unresolved.md` and the callout are written by scripts, not by a model, so
  no finding is "fixed" after the last large-tier review. The listed findings are exactly the last
  review's.
- **Default taken:** a plan whose last round has review findings and also renderer or validator
  findings fails as a whole: the review findings do not publish it on their own.
- **Plan review (section 4) findings answered here:** the default includer path of
  mod-devflow-tail's `review-tier` (no `with:`) was untested, so p3 adds the exec-code fixture
  `devflow-quick/fixtures/default-review-tier` and D5 spells out the one fallback
  (`m="${INPUTS_REVIEW_MODEL-}"`) if `$INPUTS.review_model` is not substituted. p5 was beyond M,
  so the script move went into p4 (step 0). The publish-plan test resets plan.md to serial.md so
  the Risks section lands before the manifest, and removes unresolved.md before section g.
- **Default taken:** publish-plan creates `## Risks and open questions` if a plan lacks it, before
  `## Assumptions` (else before `## Implementation manifest`).

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
  - 'grep -rn "Opus" packs/devflow/devflow-plan/commands packs/devflow/devflow-refine/commands packs/devflow/mod-devflow-phase/commands/implement-phase.md packs/devflow/mod-devflow-tail/commands/review.md prints nothing, and grep -n "Sonnet" packs/devflow/mod-devflow-phase/commands/implement-phase.md packs/devflow/mod-devflow-tail/commands/review.md prints nothing'
  - 'grep -c "model: large" packs/devflow/devflow-plan/devflow-plan.yaml packs/devflow/devflow-refine/devflow-refine.yaml prints 1 for each file (only plan-review)'
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
         - After the "d5" block (after the closing `)` of the subshell that ends with
           `echo "check-plan: ok"`), add a block "# d6. model keys are required" that, in the same style as d2, renders each new fixture with
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
    title: "devflow-plan: medium planning, the model rules in the large review, publish with unresolved review findings"
    depends_on: [p1-manifest-models]
    complexity: M
    model: medium
    model_reason: moves three scripts to .shared/, edits four prompt files and two scripts, and must compose the model-rule text and the last-round behaviour exactly from the spec
    touches:
      - packs/devflow/devflow-plan/devflow-plan.yaml
      - packs/devflow/devflow-plan/commands/**
      - packs/devflow/devflow-plan/scripts/**
      - packs/devflow/devflow-plan/fixtures/**
      - packs/devflow/.shared/publish-plan.ts
      - packs/devflow/.shared/test-plan.ts
      - packs/devflow/.shared/check-plan.ts
      - packs/devflow/.shared/plan-result.ts
      - scripts/test-render-run.sh
    brief: |
      Read the plan's Design sections D1, D2, D7, D7a and D8 first.
      0. Move the scripts first, with no logic change: git mv
         packs/devflow/devflow-plan/scripts/{test-plan,check-plan,plan-result}.ts to
         packs/devflow/.shared/, change their `../../.shared/util.ts` imports to `./util.ts`, and
         create two-line thin entries with the same three names in packs/devflow/devflow-plan/scripts/,
         in the pattern of packs/devflow/devflow-plan/scripts/publish-plan.ts (comment line naming
         `.shared/<name>.ts`, then `import "../../.shared/<name>.ts";`). In scripts/test-render-run.sh
         set `cp_script` to "$repo_root/packs/devflow/.shared/check-plan.ts" (`tp` stays on the thin
         entry). Run scripts/test-render-run.sh: it must pass before step 1.
      1. packs/devflow/devflow-plan/devflow-plan.yaml: workflow `model:`, `draft`, `challenge` and
         `finalize` (inside plan-loop) go from large to medium. `plan-review` stays large. Change
         nothing else in the file.
      2. commands/review-plan.md: the D7 edits (l.1-2 wording, check 8, the D2 section verbatim as
         the last section).
      3. Edit draft.md, challenge.md and finalize.md as D8 says (the devflow-plan items), including
         the D2 section verbatim before `## Output` in draft.md and finalize.md. The new finalize
         override is number 7.
      4. packs/devflow/.shared/check-plan.ts: the D7a last-round change, and the clean path also removes
         unresolved.md. packs/devflow/.shared/publish-plan.ts: the D7a plan.md annotation before step
         2, and `unresolved` in the output JSON.
      5. scripts/test-render-run.sh:
         - d5 (check-plan): replace the round-3 assertion (`if cp_run "$rev" 2 ...` and its grep) with
           two cases: (a) `cp_run "$rev" 2` (review-only findings) exits 0, prints `"done":true`,
           `$chk/tested.json` contains `"unresolved":1`, and `$chk/unresolved.md` contains
           `### Unresolved validation findings` and `- F1 [review, mechanical] p1: p`; (b) with
           test findings `{"ok":false,"findings":[{"id":"T1","source":"validate_manifest","kind":"mechanical","phase":"","problem":"bad","fix":"f"}]}`
           and round 2 it exits non-zero and stderr contains `after 2 fix rounds`. cp_run reads `$tst`
           when it is called, so pass the test findings as a temporary assignment:
           `tst='<that JSON>' cp_run "" 2` (not as an INPUTS_TEST prefix, which cp_run overrides). Clear `$chk`
           (`rm -f "$chk"/*`) before case (a). Then `cp_run "" ""` again and assert
           `test ! -e "$chk/unresolved.md"`.
         - f (publish-plan): after the existing publish3 assertions, reset the plan with
           `cp "$fx/serial.md" "$pub_art/plan.md"` (serial.md has no Risks and no Assumptions section,
           so D7a inserts a new `## Risks and open questions` right before `## Implementation
           manifest`). Write `$pub_art/unresolved.md`
           with the D7a heading, intro and one bullet `- F1 [review, mechanical] p1: x`, run
           `publish` again, and assert: the output contains `"unresolved":1`;
           `git -C "$porigin" show plans:plans/s/plan.md` contains `> [!WARNING]` on the third line
           and exactly one `### Unresolved validation findings` line, which comes after a
           `## Risks and open questions` line and before `## Implementation manifest`. Run
           `publish` once more and assert the heading count is still 1. Then
           `rm -f "$pub_art/unresolved.md"` (section g publishes again and must not get the
           callout). End with `echo "publish-plan unresolved: ok"`.
      6. Fixtures in packs/devflow/devflow-plan/fixtures/:
         - plan-test-never-clears.stubs.yaml: first comment line becomes
           `# The reviewer keeps finding a problem; after two fix rounds the plan is published anyway, with the findings recorded.`,
           and `fixture:` becomes `expect: completed` with no `fail-node`. Nothing else changes.
         - New plan-test-hard-never-clears.stubs.yaml: a copy of the original
           plan-test-never-clears.stubs.yaml as it is on main (`expect: failed`,
           `fail-node: plan-result`), whose first comment line is
           `# RED: the manifest validator keeps rejecting the plan; after two fix rounds the run fails and nothing is published.`,
           with `plan-test: {ok: false, findings: [{id: T1, source: validate_manifest, kind: mechanical, phase: "", problem: stub, fix: stub}]}`
           (block YAML like the others) and no `plan-review` stub (it is skipped when plan-test is
           not ok). If the simulation fails in another node than plan-result, stop with
           status=blocked.
         - happy-path, interview-done and interview-user-stops: unchanged.
      7. Run scripts/test-render-run.sh and scripts/test-devflow-pack.sh.
      Stop with status=blocked if plan-test-never-clears does not complete, or if
      plan-test-hard-never-clears does not fail: do not change the loop or add a node to make it pass.
    acceptance:
      - 'ls packs/devflow/.shared/test-plan.ts packs/devflow/.shared/check-plan.ts packs/devflow/.shared/plan-result.ts succeeds, and wc -l packs/devflow/devflow-plan/scripts/{test-plan,check-plan,plan-result}.ts prints 2 for each'
      - 'scripts/test-devflow-pack.sh ends with "0 failed" and lists devflow-plan/fixtures/plan-test-never-clears.stubs.yaml with "Simulation outcome: completed" and plan-test-hard-never-clears.stubs.yaml with "Simulation outcome: failed"'
      - 'scripts/test-render-run.sh prints "check-plan: ok" and "publish-plan unresolved: ok" and ends with "test-render-run: all ok"'
      - 'grep -n "model:" packs/devflow/devflow-plan/devflow-plan.yaml shows medium for the workflow, draft, challenge and finalize, and large only for plan-review'
      - 'for f in draft finalize review-plan; do sed -n ''/^## Models: the smallest model for each phase$/,/^   then the line/p'' packs/devflow/devflow-plan/commands/$f.md | md5sum; done prints the same hash three times, and the extracted text is non-empty'
      - 'grep -c "subagent review too\|on Opus reviews\|reviewer.s findings are fixed" packs/devflow/devflow-plan/commands/finalize.md prints 0, and grep -c "the next step validates the plan on the large tier" packs/devflow/devflow-plan/commands/finalize.md prints 1 (D8 keeps that phrase on one line)'
      - 'grep -rn "Opus" packs/devflow/devflow-plan/commands prints nothing'

  - id: p2-phase-routing
    title: mod-devflow-phase runs each phase on its manifest model
    depends_on: [p1-manifest-models]
    complexity: S
    model: small
    touches:
      - packs/devflow/mod-devflow-phase/**
    brief: |
      Read the plan's Design sections D4 and D6 first.
      1. packs/devflow/mod-devflow-phase/mod-devflow-phase.yaml: load-plan's output_format gains `model`
         (D4), and the `implement` node in the build loop is replaced by the four nodes of D4,
         verbatim. Do not touch `check`, `until_bash` or `gate`.
      2. Create packs/devflow/mod-devflow-phase/scripts/pick-one.ts, the thin entry of D6.
      3. commands/implement-phase.md line 1: the D4 wording change.
      4. Fixtures in packs/devflow/mod-devflow-phase/fixtures/:
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
      - 'grep -c "command: implement-phase" packs/devflow/mod-devflow-phase/mod-devflow-phase.yaml prints 3'
      - 'grep -n "script: pick-one" packs/devflow/mod-devflow-phase/mod-devflow-phase.yaml prints one line'
      - 'grep -n "Sonnet" packs/devflow/mod-devflow-phase/commands/implement-phase.md prints nothing'

  - id: p3-review-routing
    title: mod-devflow-tail and mod-devflow-deliver run the final review on the plan's review model
    depends_on: [p1-manifest-models]
    complexity: M
    model: small
    touches:
      - packs/devflow/mod-devflow-tail/**
      - packs/devflow/mod-devflow-deliver/**
      - packs/devflow/devflow-quick/fixtures/**
      - packs/devflow/devflow-docs/fixtures/**
      - packs/devflow/devflow-config/fixtures/**
      - packs/devflow/devflow-deps/fixtures/**
      - packs/devflow/devflow-audit/fixtures/**
      - packs/devflow/mod-devflow-audit-fix/fixtures/**
    brief: |
      Read the plan's Design sections D5 and D6 first.
      1. packs/devflow/mod-devflow-tail/mod-devflow-tail.yaml: add `inputs:`, the `review-tier` node,
         `review-loop`'s `depends_on: [review-tier]`, and replace the `review` node with the three
         nodes of D5, verbatim. Update the description and the l.15 comment as D5 says.
      2. Create packs/devflow/mod-devflow-tail/scripts/pick-one.ts, the thin entry of D6.
      3. packs/devflow/mod-devflow-tail/commands/review.md line 8: the D5 wording change.
      4. packs/devflow/mod-devflow-deliver/mod-devflow-deliver.yaml: load-plan's output_format gains
         `review_model`, and the `tail` include gains the `with:` of D5.
      5. Fixtures. Do not edit any workflow YAML other than mod-devflow-tail and mod-devflow-deliver.
         - The 18 fixtures that have a top-level `review:` stub, listed by
           `grep -ln "^review:" packs/devflow/*/fixtures/*.yaml`, get two edits each:
           a. directly before the `review:` line, a `review-large:` stub whose body is a copy of
              the `review:` body (the same indented lines). Keep the `review:` stub: it now stubs
              the picker in non-exec fixtures.
           b. as the file's last line, `tail__review-tier: '{"model":"large"}'`, or
              `ship__tail__review-tier: '{"model":"large"}'` in the two packs/devflow/devflow-audit/fixtures/
              files. Included top-level nodes are renamed `<include id>__<id>`; loop-body nodes such
              as `review-large` keep their ids.
         - Both packs/devflow/mod-devflow-deliver/fixtures files also get `review_model: large` as the
           last key of the `load-plan:` stub.
         - No other fixture changes. Exec-code fixtures get the same stubs (stubs win over real code).
         - New packs/devflow/mod-devflow-deliver/fixtures/medium-review.stubs.yaml: start from the edited
           happy-path.stubs.yaml; put `exec-code: true` as its first key (before `fixture:`); make the
           first comment line `# The plan's review_model is medium: only the medium review runs.`;
           set `review_model: medium` in the load-plan stub; rename the `review:` stub key to
           `review-medium:`; delete the `review-large:` and `tail__review-tier:` stubs (review-tier
           and the picker run for real, and review-large must not run).
         - New packs/devflow/devflow-quick/fixtures/default-review-tier.stubs.yaml (an includer that
           passes no `with:`): start from the edited devflow-quick happy-path.stubs.yaml; put
           `exec-code: true` as its first key; make the first comment line
           `# The includer passes no review_model: the default large review runs.`; delete the
           `review:` and `tail__review-tier:` stubs and keep `review-large:` (review-tier and the
           picker run for real).
      6. Run scripts/test-devflow-pack.sh; it must end with "0 failed". A red-path fixture
         (review-never-clears, dod-stays-red, fast-stays-red, ...) must still fail in the node it names
         today. Only stubs may change; never change a fixture's `expect` or `fail-node`.
      If default-review-tier fails in `tail__review-tier`, apply D5's one allowed fallback
      (`m="${INPUTS_REVIEW_MODEL-}"`) and rerun; stop with status=blocked if it or medium-review
      still fails there.
      Stop with status=blocked if medium-review fails with "Missing reachable stub for node
      'review-large'" (the routing is wrong), or if any fixture still fails after these exact edits:
      do not invent other stub changes and never edit an includer's workflow YAML.
    acceptance:
      - 'scripts/test-devflow-pack.sh ends with "0 failed" and shows mod-devflow-deliver/fixtures/medium-review.stubs.yaml and devflow-quick/fixtures/default-review-tier.stubs.yaml with "Simulation outcome: completed"'
      - 'grep -n "default: large" packs/devflow/mod-devflow-tail/mod-devflow-tail.yaml prints the review_model input'
      - 'grep -n ''review_model: "$load-plan.output.review_model"'' packs/devflow/mod-devflow-deliver/mod-devflow-deliver.yaml prints one line'
      - 'git diff --name-only "$(git merge-base origin/main HEAD)" HEAD -- '':(glob)packs/devflow/*/*.yaml'' lists only packs/devflow/mod-devflow-tail/mod-devflow-tail.yaml and packs/devflow/mod-devflow-deliver/mod-devflow-deliver.yaml'
      - 'grep -n "Opus" packs/devflow/mod-devflow-tail/commands/review.md prints nothing'

  - id: p5-refine-validation
    title: devflow-refine gets the same models, validation loop and rules
    depends_on: [p4-plan-validation]
    complexity: M
    model: medium
    model_reason: restructures devflow-refine.yaml into the plan loop and adapts devflow-plan's loop fixtures to devflow-refine's nodes
    touches:
      - packs/devflow/devflow-refine/**
    brief: |
      Read the plan's Design sections D1, D2, D7, D7a and D8 first, and look at what p4 did to
      packs/devflow/devflow-plan/ (git log -p -- packs/devflow/devflow-plan packs/devflow/.shared).
      1. p4 already moved test-plan, check-plan and plan-result to packs/devflow/.shared/. Copy
         p4's three thin entries from packs/devflow/devflow-plan/scripts/{test-plan,check-plan,plan-result}.ts
         to packs/devflow/devflow-refine/scripts/ unchanged (they import `../../.shared/<name>.ts`).
         If packs/devflow/.shared/check-plan.ts does not exist, p4 did not do its step 0: stop with
         status=blocked.
      2. packs/devflow/devflow-refine/devflow-refine.yaml: workflow, draft and challenge on medium.
         Replace the `finalize` and `render` nodes with a `plan-loop` and a `plan-result` node copied
         from devflow-plan.yaml (finalize on medium, render with `soft_errors: "true"` and the
         ok/error/workflow/file/waves output, plan-test, plan-review on large, plan-check). In the
         copied render node keep devflow-refine's current `with:` values (`$load.output.slug`,
         `$load.output.branch`, and the rest as they are in devflow-refine today), adding only
         `soft_errors`. plan-loop keeps devflow-refine's current `depends_on`/`when:` of finalize.
         `still-unstarted` depends on `plan-result` instead of `render`; `publish` reads `title` and
         `workflow` from `$plan-result.output.*` and keeps `commit_verb: Refine`.
      3. cp packs/devflow/devflow-plan/commands/review-plan.md to packs/devflow/devflow-refine/commands/.
      4. Edit devflow-refine's draft.md, challenge.md and finalize.md as D8 says, including both
         refine-only bullets in draft.md step 3, and copy devflow-plan's `## Fix rounds` and
         `## Assumptions` sections into finalize.md at the same place as in devflow-plan (after
         `## Inputs from the interview`, before `## Overrides`), and append devflow-plan's last
         `## Output` line ("plan.md has an `## Assumptions` section (see Assumptions above).").
         The new finalize override is number 8. Copy the D2 section from
         packs/devflow/devflow-plan/commands/draft.md so it is byte-identical.
      5. Fixtures in packs/devflow/devflow-refine/fixtures/: in happy-path.stubs.yaml, replace the
         `render:` stub by devflow-plan happy-path's `render`, `plan-test`, `plan-review`,
         `plan-check` and `plan-result` stubs. Add copies of devflow-plan's (p4-edited)
         plan-test-never-clears and plan-test-hard-never-clears, each with devflow-refine
         happy-path's `load:` and `still-unstarted:` stubs added after `setup:` and at the end,
         and with the first comment line kept.
         interview-user-stops and refuse-started are unchanged.
      6. Run scripts/test-render-run.sh and scripts/test-devflow-pack.sh.
      Stop with status=blocked if a copied command or node does not fit devflow-refine (it names
      devflow-plan, or reads a node devflow-refine does not have).
    acceptance:
      - 'cmp packs/devflow/devflow-plan/commands/review-plan.md packs/devflow/devflow-refine/commands/review-plan.md exits 0'
      - 'for f in devflow-plan/commands/draft devflow-refine/commands/draft devflow-refine/commands/finalize devflow-refine/commands/review-plan; do sed -n ''/^## Models: the smallest model for each phase$/,/^   then the line/p'' packs/devflow/$f.md | md5sum; done prints the same hash four times, and the extracted text is non-empty'
      - 'grep -n "model:" packs/devflow/devflow-refine/devflow-refine.yaml shows large only for plan-review'
      - 'ls packs/devflow/.shared/test-plan.ts packs/devflow/.shared/check-plan.ts packs/devflow/.shared/plan-result.ts succeeds, and wc -l on their thin entries in devflow-plan/scripts and devflow-refine/scripts prints 2 for each'
      - 'grep -rn "Opus" packs/devflow/devflow-refine/commands prints nothing, and grep -c "subagent review too" packs/devflow/devflow-refine/commands/finalize.md prints 0'
      - 'grep -n "^## " packs/devflow/devflow-refine/commands/finalize.md lists Your authority, Inputs from the interview, Fix rounds, Assumptions, Overrides, Files for the person, Models: the smallest model for each phase, Output in that order'
      - 'scripts/test-render-run.sh ends with "test-render-run: all ok" and scripts/test-devflow-pack.sh ends with "0 failed" with devflow-refine''s plan-test-never-clears completed and plan-test-hard-never-clears failed'

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
      1. packs/devflow/README.md: make exactly the D10 edits, keeping "**Phases and models**" and
         "A fresh reviewer on the large tier" each on one line (the includer list; devflow-plan steps 1, 2 and 4,
         keeping the five steps Interview, Plan, Render, Test, Publish; the paragraph after the
         steps; devflow-refine step 3).
      2. Check every statement the edits make against the merged code: tiers in
         devflow-plan.yaml/devflow-refine.yaml, the 3-round loop, mod-devflow-tail's default, and the
         includer list (grep -rn "include: mod-devflow-tail" packs/devflow).
      3. Run scripts/test-render-run.sh and scripts/test-devflow-pack.sh.
      Stop with status=blocked if the code contradicts a D10 sentence: report the difference and do
      not reword around it.
    acceptance:
      - 'grep -n "large tier" packs/devflow/README.md prints exactly one line, the Test step''s "A fresh reviewer on the large tier" bullet, and grep -n "(medium tier)" packs/devflow/README.md shows the Interview step'
      - 'grep -n "Phases and models" packs/devflow/README.md prints one line'
      - 'grep -n "devflow-config" packs/devflow/README.md includes the mod-devflow-tail includer sentence'
      - 'scripts/test-render-run.sh and scripts/test-devflow-pack.sh both pass'
```
