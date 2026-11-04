# cyc test plan

## Implementation manifest

```yaml
plan_slug: cyc
feature_branch: feat/cyc
manual_before: []
phases:
  - id: p1
    title: one
    depends_on: [p2]
  - id: p2
    title: two
    depends_on: [p1]
```
