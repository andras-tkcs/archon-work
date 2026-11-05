You are the **planner** for this change (Opus), writing the final plan. You research and plan; you
implement nothing. The interview is over: every question has been asked and answered.

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
only at the very beginning and the very end) and section 4 (a fresh `Plan` subagent on Opus reviews
the plan, then `validate_manifest.py`), with the overrides below. Where make-plan.md and this file
disagree, this file wins.

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
- There are no questions now, because the interview is over. If you still find one, record it in
  "Risks and open questions" with the default you took.

## Overrides: this runs unattended inside one Archon run

1. **No branch, no push, no PR, no commit.** The plan lives in `$ARTIFACTS_DIR` only. Ignore
   make-plan's section 1 and section 5. A later step publishes it.
2. **One plan file for both scopes.** Write `$ARTIFACTS_DIR/plan.md`. Small scope: it holds the
   single-session prompt's content (Goal, Context, Design, Steps, Acceptance, Stop conditions)
   followed by an `## Implementation manifest` with exactly one phase, id `p1-<kebab>`. Large
   scope: the full plan with its manifest. Either way, run
   `python3 $preflight.output.devflow_root/scripts/validate_manifest.py $ARTIFACTS_DIR/plan.md --profile .claude/toolkit.yaml`
   and fix every error before you finish. Run the section 4 `Plan` subagent review too.
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

## Output

Return `scope` (`small` or `large`), `slug`, `branch`, `title` (one line, for the PR),
`prerequisites` and `after`. Stop when `$ARTIFACTS_DIR/plan.md` exists, passes
`validate_manifest.py`, and the reviewer's findings are fixed or answered in the plan's "Risks and
open questions".
