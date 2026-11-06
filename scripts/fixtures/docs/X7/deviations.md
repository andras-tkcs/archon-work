---
issue: 7
kind: deviations
title: Export reports as CSV
revision: 1
plan_revision: 2
build_outcome: stopped
branch: feat/issue-7-csv-export
run: run-7
updated: 2026-11-06
---

# Deviations and decisions: Export reports as CSV

## Outcome
stopped — phases: 1 done, 1 stuck, 1 skipped. Branch: feat/issue-7-csv-export. PR: no PR (stopped). Run: run-7.

## Stuck and skipped phases
| phase | state | reason | partial branch |
|---|---|---|---|
| p1-export-tests | stuck | fast checks red after the last step | feat/issue-7-csv-export-partial-p1-export-tests |
| verify | skipped | dependency p1-export-tests is stuck | — |

## Deviations from design and plan
### V1. Rows are written in batches of 1000
- Phase: p1-export
- Planned: write rows one by one
- Done: write batches of 1000 rows
- Why: one write per row was too slow on 100000 rows

## Decisions taken
### K1. Quote every field
- Phase: p1-export
- Choice: csv.QUOTE_ALL
- Alternatives: csv.QUOTE_MINIMAL
- Why: the design is silent; quoting everything is the safe choice for spreadsheets

## Tests
- p1-export: none
- p1-export-tests: T1 fail
- verify: not run

Cases of plan-test.md with no passing result: T1, T2

## Before steps
None.

## After steps
See after.md; these steps are always yours.

## Review and CI
None.

## Follow-ups
None.
