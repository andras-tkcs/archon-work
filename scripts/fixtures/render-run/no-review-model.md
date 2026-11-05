# no-review-model test plan

## Implementation manifest

```yaml
plan_slug: no-review-model
feature_branch: feat/no-review-model
manual_before: []
phases:
  - id: p1
    title: first
    depends_on: []
    model: small
  - id: p2
    title: second
    depends_on: [p1]
    model: small
```
