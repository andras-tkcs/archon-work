# three-wide test plan

## Implementation manifest

```yaml
plan_slug: three-wide
feature_branch: feat/three-wide
max_parallel: 3
review_model: large
review_model_reason: p3 is on large
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
    model: small
  - id: p2
    title: second
    depends_on: []
    model: small
  - id: p3
    title: third
    depends_on: []
    model: large
    model_reason: security-sensitive parser
  - id: p4
    title: fourth
    depends_on: []
    model: small
  - id: p5
    title: fifth
    depends_on: [p1]
    model: small
```
