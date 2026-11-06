# {{title}}

## Problem
<!-- guide: what is wrong or missing, from the issue, verified against the code (cite path:line).
     Free text: paragraphs and lists are fine. -->
{{problem}}

## Goal and non-goals
<!-- guide: keep both label lines. Write None. after "**Non-goals:**" when there are none. -->
**Goal:** {{goal}}
**Non-goals:** {{non_goals}}

## Decisions
<!-- repeat decisions: one block per decision, numbered D1, D2, … in order, each with exactly
     these four lines. Rejected is the strongest alternative. Source is exactly one of:
     answer Q<id> round <1|2> · ADR <id> · code <path> · rulings.md · issue comment <url> -->
### D{{n}}. {{title}}
- Choice: {{choice}}
- Rejected: {{rejected}}
- Why: {{why}}
- Source: {{source}}

## Design
<!-- guide: the approach: components, data and schema, interfaces, behaviour, error cases, and
     the exact names and strings the user will see. -->
{{design}}

## Impact
<!-- guide: areas and files touched, data and migrations, security, docs, changelog. -->
{{impact}}

## Acceptance
<!-- repeat acceptance: one line per checkable statement, numbered A1, A2, … from 1. The test
     plan covers each one by its id. -->
- A{{n}}. {{statement}}

## Assumptions
<!-- repeat assumptions: one line per decision taken without asking, or the single line None. -->
- **{{decision}}**: {{choice}}. Why: {{reason}}. Change it by running devflow-refine with: "{{example}}".

## Risks
<!-- guide: what could go wrong and how it is caught, or the single line None. -->
{{risks}}

## Related work
<!-- repeat related: one line per issue or PR the related-work search found, or the single line None. -->
- {{url}} — {{relation}}

## Revision log
<!-- guide: one line per revision, newest last, numbered from r1; keep the earlier lines as they are.
     The last line is this revision. -->
- r{{revision}} ({{date}}, run {{run}}): {{change}}
