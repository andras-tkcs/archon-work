---
issue: 7
kind: plan
title: Export reports as CSV
revision: 1
design_revision: 1
run: run-7
updated: 2026-11-06
---

# Export reports as CSV

Design: design.md r1

## Goal
Issue #7: a person can download {{what}} as a CSV file.

## Context
Reports render in src/report.py:40; there is no export.

## Design
write_csv(rows) in src/export.py streams rows with the csv module (D1, D2).

## Steps
1. Add write_csv.
2. Add the tests.

## Acceptance
- make test passes.

## Stop conditions
Stop if src/report.py has no row iterator.

## Phases and models
| Phase | Title | Complexity | Depends on | Model | Why this model |
|---|---|---|---|---|---|
| p1-export | CSV writer | S | — | small | default |
| p1-export-tests | CSV writer tests | S | p1-export | small | default |
| verify | Verify the test plan | S | p1-export, p1-export-tests | small | default |

Final build review: **medium**. three phases, none large

## Risks and open questions
The row iterator may not be lazy; p1-export stops if it is not.

## Implementation manifest
```yaml
plan_slug: issue-7
feature_branch: feat/issue-7-csv-export
max_parallel: 2
review_model: medium
review_model_reason: three phases, none large
manual_before: []
manual_after:
- id: ma1-open
  title: Open an exported file
  why: only a person can check the spreadsheet import
phases:
- id: p1-export
  title: CSV writer
  depends_on: []
  complexity: S
  model: small
  touches:
  - src/export.py
  brief: Add write_csv(rows) to src/export.py.
  acceptance:
  - make test passes
- id: p1-export-tests
  title: CSV writer tests
  depends_on: [p1-export]
  complexity: S
  model: small
  touches:
  - tests/test_export.py
  brief: Add tests T1 and T2 of plan-test.md to tests/test_export.py.
  acceptance:
  - make test passes
- id: verify
  title: Verify the test plan
  depends_on: [p1-export, p1-export-tests]
  complexity: S
  model: small
  touches: []
  brief: Run every case of plan-test.md and the design's Acceptance.
  acceptance:
  - make test passes
```

## Assumptions
None.

## Revision log
- r1 (2026-11-06, run run-7): first plan, from design r1
