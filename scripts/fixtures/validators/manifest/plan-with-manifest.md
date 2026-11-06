# Plan

## Implementation manifest

```yaml
feature_branch: feature/demo
final_checks:
- the plan is deleted
manual_after:
- id: ma1-check
  title: Click through
  why: CI cannot
manual_before:
- done_when: the key exists
  id: mb1-account
  title: Create an account
  why: p1 needs it
manual_steps_artifact: https://example.invalid/manual-steps
manual_steps_source: docs/demo-plan-manual-steps.html
max_parallel: 2
phases:
- acceptance:
  - make test passes
  brief: do it
  complexity: S
  depends_on: []
  id: p1-core
  title: Core
  touches:
  - src/core.py
  - tests/test_core.py
- acceptance:
  - make test passes
  brief: do it
  complexity: M
  depends_on:
  - p1-core
  id: p2-api
  title: API
  touches:
  - src/core.py
  - src/api.py
- acceptance:
  - a grep matches
  brief: do it
  depends_on:
  - p1-core
  id: p3-docs
  title: Docs
  touches:
  - docs/*.md
plan_slug: demo
verify_after_merge:
- make test
```
