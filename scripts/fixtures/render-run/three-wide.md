# three-wide test plan

## Implementation manifest

```yaml
plan_slug: three-wide
feature_branch: feat/three-wide
max_parallel: 3
manual_before:
  - id: mb1
    title: create the account
manual_after:
  - id: ma1
    title: deploy
phases:
  - id: p1
    title: it's $x
    depends_on: []
  - id: p2
    title: second
    depends_on: []
  - id: p3
    title: third
    depends_on: []
  - id: p4
    title: fourth
    depends_on: []
  - id: p5
    title: fifth
    depends_on: [p1]
```
