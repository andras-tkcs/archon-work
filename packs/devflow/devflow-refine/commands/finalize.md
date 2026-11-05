You are the **planner** for this change, writing the final plan. You research and plan; you
implement nothing. The interview is over: every question has been answered, or is listed in
`$ARTIFACTS_DIR/open-questions.md` when the interview ended incomplete.

The plan to refine is `$ARTIFACTS_DIR/original/plan.md` (with `original/prerequisites.md` and
`original/after.md` when they exist), published as `$load.output.slug` at commit
`$load.output.plan_commit` on the plans branch. Its feature branch is `$load.output.branch`.
Nothing of it is implemented yet.

What to change (it may name the plan; that is the plan above):

$load.output.work

## Your authority

The devflow toolkit's `/make-plan` command is the method. Read it in full first:
`$preflight.output.devflow_root/commands/make-plan.md`. Follow its section 0 (understand the ask,
read the must-read docs, the steward files and every ADR, decide small or large scope), section 2
(the plan's sections, the implementation manifest, "Sizing for Sonnet"), section 3 (manual steps
only at the very beginning and the very end) and the model rules below, with the overrides below.
Do not run section 4's `Plan` subagent: the next step validates the plan on the large tier and
applies its findings. Where make-plan.md and this file disagree, this file wins.

The project profile is already validated and resolved at `$ARTIFACTS_DIR/profile.json`; read
project facts from it (must-read docs, `git.branch_pattern` and `branch_types`, `docs.adr_*`,
`docs.changelog`, `ci.dispatchable`, `verify.*`, `project_steward`). Load the skills it names
(`devflow:project-profile`, `devflow:pr-steward`, the `stack-*` skills for `stacks`) if your skill
list has them; otherwise read their `SKILL.md` under `$preflight.output.devflow_root/skills/`.
Issues: read them and their comments with `gh issue view <n> --comments`.

## Inputs from the interview

Read `$ARTIFACTS_DIR/interview.md` and `$ARTIFACTS_DIR/plan-draft.md`.

- Every answer in interview.md is a decision of the user. Record each one in the plan's Design.
- interview.md's "Why no more questions" goes into the plan's "Risks and open questions".
- There are no new questions now, because the interview is over (open-questions.md is
  handled below). If you still find one, record it in
  "Risks and open questions" with the default you took.

## Open questions from the interview

If `$ARTIFACTS_DIR/open-questions.md` exists, the interview ended with questions still open
(interview.md says why). For each `### Q<n>` block in it, take its recommended option, apply it
in Design like an answer, and add one bullet to `## Assumptions`:
`- **<the decision>**: <the recommended option>. Why: recommended default; the interview ended before it was answered (open question Q<n>).`
Do not write an `## Open questions` section yourself: the publish step inserts one from
open-questions.md. A plan that ended this way is still a full plan that passes
`validate_manifest.py`.

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
  - Keep `slug`, `branch` and `title` unchanged. Rerun `validate_manifest.py`.
  - Return the same output fields as on the first pass.

## Assumptions

plan.md always has an `## Assumptions` section, right before `## Implementation manifest`. It
lists every decision made after the interview, and every open question's default (above), one
bullet each:

`- **<the decision>**: <the choice>. Why: <reason>. Made after the interview, not asked (round <n>, finding <F-id>).`

When there are none, the section holds the single line `None.`.

## Overrides: this runs unattended inside one Archon run

1. **No branch, no push, no PR, no commit.** The plan lives in `$ARTIFACTS_DIR` only. Ignore
   make-plan's section 1 and section 5. A later step publishes it.
2. **One plan file for both scopes.** Write `$ARTIFACTS_DIR/plan.md`. Small scope: it holds the
   single-session prompt's content (Goal, Context, Design, Steps, Acceptance, Stop conditions)
   followed by an `## Implementation manifest` with exactly one phase, id `p1-<kebab>`. Large
   scope: the full plan with its manifest. Either way, run
   `python3 $preflight.output.devflow_root/scripts/validate_manifest.py $ARTIFACTS_DIR/plan.md --profile .claude/toolkit.yaml`
   and fix every error before you finish.
3. **The plan is never committed to the feature branch**, so the retirement phase does not delete a
   plan document, and `final_checks` must not ask for that. The retirement phase still writes the
   ADRs (when the profile has `docs.adr_dir`), updates the reference docs and adds the changelog
   line.
4. **No HTML artifact.** Put the manual steps, step by step with direct links, in the plan's
   "Manual steps" section too.
5. **`max_parallel` is required in the manifest.** It is at most 3, and it is 1 for small scope.
   Phases that may run together must have disjoint `touches`. The changelog line belongs to the
   retirement phase only, so parallel phases never share the changelog.
6. **Branch.** `branch` follows `git.branch_pattern` with a type from `git.branch_types` and a
   kebab-case slug, and equals the manifest's `feature_branch`. `slug` equals the manifest's
   `plan_slug`.
7. **Slug and branch stay.** `slug` is `$load.output.slug` and `branch` is `$load.output.branch`, and the
   manifest's `plan_slug` and `feature_branch` keep those values. The plan's Design records the
   requested change (under `### Refinement`, with the change text quoted) and every new interview
   answer. Phase ids may change freely, because nothing is implemented yet.
8. **Risks and open questions, and the table.** Both scopes have a `## Risks and open questions`
   section directly before `## Assumptions` (which stays right before `## Implementation
   manifest`), and the `## Phases and models` section of model rule 7.

## Files for the person

- `manual_before` non-empty → write `$ARTIFACTS_DIR/prerequisites.md`:
  - `# Before implementing <title>`.
  - Then per item: `## <n>. <title>`, the why, numbered steps with direct links (the exact console
    page), where a secret goes (never the value), and `**Done when:** <done_when>`.
  - Return `prerequisites: true`. Otherwise write no file and return false.
- `manual_after` non-empty → write `$ARTIFACTS_DIR/after.md` in the same shape:
  - `# After implementing <title>`, covering manual verification, deploy and after-merge steps.
  - Each item ends with `**Report:** <the pass/fail line to paste in the PR>`.
  - Return `after: true`. Otherwise write no file and return false.

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

## Output

Return `scope` (`small` or `large`), `slug`, `branch`, `title` (one line, for the PR),
`prerequisites` and `after`. Stop when `$ARTIFACTS_DIR/plan.md` exists, passes
`validate_manifest.py`.
plan.md has an `## Assumptions` section (see Assumptions above).
