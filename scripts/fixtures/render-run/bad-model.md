# bad-model test plan

## Implementation manifest

```yaml
plan_slug: issue-5
feature_branch: feat/bad-model
review_model: medium
review_model_reason: two phases
manual_before: []
phases:
  - id: p1
    title: first
    depends_on: []
    model: small
  - id: p2
    title: second
    depends_on: [p1]
    model: haiku
```
