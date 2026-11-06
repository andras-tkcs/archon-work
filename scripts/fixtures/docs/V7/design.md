---
issue: 7
kind: design
title: Export reports as CSV
revision: 1
run: run-7
updated: 2026-11-06
---

# Export reports as CSV

## Problem
Reports can only be viewed in the browser (src/report.py:40).

## Goal and non-goals
**Goal:** A person can download any report as a CSV file.
**Non-goals:** None.

## Decisions
### D1. Comma as the separator
- Choice: Use a comma.
- Rejected: A semicolon, which some locales prefer.
- Why: Every spreadsheet reads it.
- Source: answer Q1 round 1

### D2. Stream the rows
- Choice: Write rows as they are read.
- Rejected: Build the file in memory.
- Why: Reports can be large.
- Source: code src/report.py

## Design
A new function write_csv(rows) in src/export.py, called from the report page's Download button. See [the other plan](../issue-3/plan.md) and [notes](notes.md).

## Impact
src/export.py, src/report.py; the changelog gets one line.

## Acceptance
- A1. The Download button returns a CSV file with a header row.
- A2. A report of 100000 rows downloads without loading it all in memory.

## Assumptions
- **File name**: report-<id>.csv. Why: it matches the page URL. Change it by running devflow-refine with: "name the file after the report title".

## Risks
None.

## Related work
- https://github.com/o/r/issues/3 — asked for the same export

## Revision log
- r1 (2026-11-06, run run-7): first design, from the answer to Q1
