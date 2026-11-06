# Test plan for {{title}}

Design: design.md r{{design_revision}}
Plan: plan.md r{{plan_revision}}

## Strategy
<!-- guide: the test levels used, the profile's verify commands that run them, and the fixtures
     and stubs the cases need. -->
{{strategy}}

## Cases
<!-- repeat cases: one block per case, numbered T1, T2, … in order. Covers lists design ids
     (A<n> Acceptance items, D<n> Decisions), comma-separated; every A<n> of the design is covered
     by some case. Level is unit, integration or e2e. Phase is the id of a <id>-tests or verify
     phase of the manifest; every <id>-tests phase has at least one case. Check is a command or an
     observable assertion. -->
### T{{n}}. {{title}}
- Covers: {{covers}}
- Level: {{level}}
- Phase: {{phase}}
- Check: {{check}}

## Not tested
<!-- guide: each gap and why it is not tested, or the single line None. -->
{{not_tested}}

## Revision log
<!-- guide: one line per revision, newest last; the last line is this revision (the plan's). -->
- r{{revision}} ({{date}}, run {{run}}): {{change}}
