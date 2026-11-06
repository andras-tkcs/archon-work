# Deviations and decisions: {{title}}

## Outcome
<!-- guide: one line. The first word is the front matter's build_outcome: running (the build has
     not opened its PR yet), completed (the PR is open) or stopped. stuck counts the table rows in
     state stuck, failed or conflict; skipped counts the rows in state skipped. -->
{{outcome}} — phases: {{done}} done, {{stuck}} stuck, {{skipped}} skipped. Branch: {{branch}}. PR: {{pr}}. Run: {{run_link}}.

## Stuck and skipped phases
<!-- guide: the table | phase | state | reason | partial branch |, one row per phase that is not
     done (state stuck, failed, skipped or conflict), or the single line None. -->
{{table}}

## Deviations from design and plan
<!-- repeat deviations: one block per deviation, numbered V1, V2, … in order, or the single line None. -->
### V{{n}}. {{title}}
- Phase: {{phase}}
- Planned: {{planned}}
- Done: {{actual}}
- Why: {{why}}

## Decisions taken
<!-- repeat decisions: one block per decision taken where the design and the plan were silent,
     numbered K1, K2, … in order, or the single line None. -->
### K{{n}}. {{title}}
- Phase: {{phase}}
- Choice: {{choice}}
- Alternatives: {{alternatives}}
- Why: {{why}}

## Tests
<!-- guide: one line per phase with its plan-test.md cases (pass, fail, not_run), then the line
     "Cases of plan-test.md with no passing result: T…" (or "none"). -->
{{tests}}

## Before steps
<!-- guide: each before.md item with met, unmet or unknown and its evidence, or the single line None. -->
{{before}}

## After steps
<!-- guide: always the same line; after.md lists the steps. -->
See after.md; these steps are always yours.

## Review and CI
<!-- guide: written when the PR opens: the review's findings fixed and left, the definition of
     done, the local CI jobs run and skipped with the reason, the fix rounds used and the final
     status, the PR URL. Until then the single line None. -->
{{review}}

## Follow-ups
<!-- guide: appended by devflow-follow-up, one block per follow-up, numbered on:
     ### F<n> (<YYYY-MM-DD>, run <id>): <task> → <done|stuck>
     followed by lines starting "- Summary:", "- Stuck:", "- Decision:" or "- Deviation:".
     Until the first follow-up the single line None. -->
{{followups}}
