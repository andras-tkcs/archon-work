---
issue: 7
kind: before
title: Export reports as CSV
revision: 1
design_revision: 1
run: run-7
updated: 2026-11-06
---

# Before implementing Export reports as CSV

## 1. Create the bucket
Why: the export writes there
Steps:
1. Open https://example.invalid/buckets.
Secret: none
**Done when:** `gh variable list` shows BUCKET
