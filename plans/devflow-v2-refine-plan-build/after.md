# After implementing devflow v2: refine → plan → build

## 1. Run devflow-refine on a real issue in a scratch project

Why: fixtures cannot prove the live engine and GitHub behaviour of the folder, the issue comment and the pause.

1. In a scratch project with the devflow pack installed and a `plans` branch (or none), open a small issue with one real open question.
2. Run: `archon workflow run tkcs-lab/devflow:devflow-refine "#<issue>"`.
3. Answer round 1 (and round 2 if asked). Confirm: at most 5 questions in round 1, at most 3 in round 2, one pause each.
4. Open the `plans` branch: `plans/plans/issue-<n>/design.md` exists with the front matter and all ten sections.
5. Open the issue: exactly one comment starting with `<!-- devflow:issue-<n> -->`, Design row `ready`.
6. At the final pause answer `revise: <note>` and confirm revision 2 with a Revision log line; then answer `plan`.

**Report:** `ma1 refine on a real issue: pass/fail — <what differed>`

## 2. Run devflow-plan, archon workflow sync, then build-issue-N on a two-phase plan

Why: the child workflows and the issue tracing in the generated workflow only work in a real run.

1. Run `archon workflow run tkcs-lab/devflow:devflow-plan "#<issue>"` (also try it with the design URL). It must not pause for questions.
2. Confirm one commit on `plans` with `plan.md`, `before.md`, `after.md` and `workflows/build-issue-<n>.yaml`.
3. Run `archon workflow sync`, then `archon workflow run build-issue-<n> --detach`.
4. Confirm the issue comment moves: building → PR open → merged/closed, and the PR body has `Closes #<n>` and a Traceability section.
5. Confirm the feature branch holds a `Plan-Phase: issue-<n>/<id>` merge commit per phase.

**Report:** `ma2 plan and build: pass/fail — <what differed>`
