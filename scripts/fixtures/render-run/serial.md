# serial test plan

## Implementation manifest

```yaml
plan_slug: serial
feature_branch: feat/serial
manual_before: []
phases:
  - id: p1
    title: first
    depends_on: []
  - id: p2
    title: second
    depends_on: [p1]
```
