---
issue: 7
kind: plan-test
title: Export reports as CSV
revision: 1
design_revision: 1
run: run-7
updated: 2026-11-06
---

# Test plan for Export reports as CSV

Design: design.md r1
Plan: plan.md r1

## Strategy
Unit tests with pytest through verify.dod (make test); no fixtures beyond a 3-row table.

## Cases
### T1. Header row
- Covers: A1, D1
- Level: unit
- Phase: p1-export-tests
- Check: pytest tests/test_export.py::test_header

### T2. Large report streams
- Covers: A2, D2
- Level: integration
- Phase: verify
- Check: make test-large keeps memory under 100 MB

## Not tested
None.

## Revision log
- r1 (2026-11-06, run run-7): first test plan
