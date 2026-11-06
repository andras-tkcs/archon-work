# {{title}}

Design: design.md r{{design_revision}}

<!-- guide: the sections below follow "Write the plan" in knowledge/plan-method.md. A large-scope plan has
     Goal, Current state, Design, Phases and models, ADRs (only when the change records ADRs),
     Manual steps, Risks and open questions. A small-scope plan has Goal, Context, Design, Steps,
     Acceptance, Stop conditions, Phases and models, Risks and open questions. Delete every
     optional section your scope does not use; never rename, add or reorder a section. Every
     plan ends with Implementation manifest, Assumptions and Revision log. -->

## Goal
<!-- guide: what changes for the user, in a paragraph, with the issue link. -->
{{goal}}

## Current state
<!-- guide: large scope only. What the code does today, with path:line references and
     measurements. -->
{{current_state}}

## Context
<!-- guide: small scope only. What the code does today, with path:line references, and the ADRs
     and docs that rule on it. -->
{{context}}

## Design
<!-- guide: the spec. Every design.md Decision is binding and appears here; every decision is
     made here, not deferred to a phase: names, signatures, strings, data, error cases. -->
{{design}}

## Steps
<!-- guide: small scope only. Numbered and prescriptive, naming files, symbols and the tests to
     extend, ending with tests, docs and the changelog. -->
{{steps}}

## Acceptance
<!-- guide: small scope only. Each item a named test, a grep or a command with its expected
     output. -->
{{acceptance}}

## Stop conditions
<!-- guide: small scope only. What the worker would see if this plan is wrong, and that it then
     stops and reports. -->
{{stop_conditions}}

## Phases and models
<!-- guide: model-rules.md rule 7: the table
     | Phase | Title | Complexity | Depends on | Model | Why this model |
     with one row per manifest phase in manifest order, then the line
     Final build review: **<review_model>**. <review_model_reason> -->
{{phases_and_models}}

## ADRs
<!-- guide: only when the change records ADRs: one bullet per decision that needs one. -->
{{adrs}}

## Manual steps
<!-- guide: large scope only. A summary of manual_before and manual_after, pointing at before.md
     and after.md. -->
{{manual_steps}}

## Risks and open questions
<!-- guide: what could make a phase's brief wrong, and how a worker would notice. -->
{{risks}}

## Implementation manifest
<!-- guide: the fenced yaml block, validated by validate-manifest.py. plan_slug is issue-<n>.
     Each implementation phase <id> has a phase <id>-tests that depends on it and touches test
     files only; a final phase verify depends on every other phase. -->
```yaml
{{manifest}}
```

## Assumptions
<!-- guide: one bullet per decision this plan took that design.md does not settle:
     - **<the decision>**: <the choice>. Why: <reason>.
     or the single line None. -->
{{assumptions}}

## Revision log
<!-- guide: one line per revision, newest last; the last line is this revision. -->
- r{{revision}} ({{date}}, run {{run}}): {{change}}
