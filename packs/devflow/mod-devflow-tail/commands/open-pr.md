Run facts are in `$ARTIFACTS_DIR/context.json`: `main_branch` (written `<main>` below), `shared_dir`, `branch`
(`<branch>`), `slug`, `title`. The resolved profile is `$ARTIFACTS_DIR/profile.json`. The work order is
`$ARTIFACTS_DIR/plan.md` when it exists (with phases and a manifest), otherwise `$ARTIFACTS_DIR/work.md`
(an outcome and acceptance, no phases); `<work order>` below means whichever exists. When the work order
says the work is confidential security work, nothing public (PR title and body, comments, commit
messages) describes the vulnerability: name the class of fix only, never an exploit step.

Open the one pull request for this change (Sonnet). Branch `<branch>`, base
`<main>`, title from the plan: "<title>".

1. `git status --porcelain` must be empty. Push with `git push -u origin <branch>`.
   Never force-push. If the push is refused, stop and say why.
2. If `gh pr list --head <branch> --state open` already finds a PR (a resumed
   run), update its body with `gh pr edit` instead of opening another.
3. Otherwise `gh pr create --base <main> --head <branch>` with the body below. Prefix the title
   with its type when the repo's convention asks for it. Open it ready for review, except when
   local CI is red (`status` is `red` in `$ARTIFACTS_DIR/outcomes/ci-local.json`, or that file
   does not exist): then open it
   with `--draft` and make `<!-- devflow:draft-ci -->` the first line of the body. A PR that
   already exists is not converted either way.

The body follows `.github/pull_request_template.md` when the repo has one: fill in every section,
tick what was run and passed, and strike through a row that does not apply with a one-line reason.
Build it from the run's files, never from memory:

- **What this changes**: the plan's Goal, and the issue it closes (`Closes #<n>`) if the work
  named one. Read <work order>.
- **Traceability** (only when `context.json` has a non-empty `issue`): the line
  `Closes #<issue>`, and a "Traceability" section that links the design (`design_url`, revision
  `design_revision`) and the plan (`plan_url`, revision `plan_revision`) on the plans branch, all
  read from `context.json`, and names this run (`$WORKFLOW_ID`). Without an issue, leave out both.
- **Phases**: each phase with its commit (`git log --grep "Plan-Phase:"`), and the combined
  acceptance checklist.
- **Deviations** (only when `context.json` has a non-empty `issue`): read
  `plans/issue-<issue>/deviations.md` in the worktree and give the number of `### V` entries
  (deviations from design and plan), of `### K` entries (decisions taken) and of rows in its
  "Stuck and skipped phases" table, with a link to the file on the branch:
  `https://github.com/<owner>/<repo>/blob/<branch>/plans/issue-<issue>/deviations.md`.
- **Definition of done**: from `$ARTIFACTS_DIR/verify-dod.md`. A row marked `UNAVAILABLE` was not
  run on this host: say so and that CI runs it; never tick it. The `dod_conditional` and
  `dod_manual` tables from `$ARTIFACTS_DIR/review.md`; a conditional row that is owed (a dispatch,
  a credential) stays unticked with what is owed.
- **Local CI**: from `$ARTIFACTS_DIR/outcomes/ci-local.json`: the status (green, red or skipped),
  each job run with its result and each job skipped with its reason, and the fix rounds used
  (the `ci-fix-<n>.json` files next to it). When it is red, a section **Local CI failed** gives,
  per failed job, the job, the failed step and its last lines of output in a fenced block, and
  says that `devflow-follow-up #<number> "fix local CI: <job>"` continues it.
- **Review**: the final verdict and how many rounds it took, from `$ARTIFACTS_DIR/review*.md`.
- **Non-blocking findings**: the table from `$ARTIFACTS_DIR/non-blocking.md`.
- **Decisions**: the ADRs added, or, if the plan's Design made no ADR-worthy decision, a line
  saying so.
- **Needs a person**: if `$ARTIFACTS_DIR/docs-review.md` exists, quote its `## Needs a person`
  section (a docs review leaves product and wording decisions to people).
- **Manual verification**: each `manual_after` item from the plan's manifest as an unchecked box,
  with its steps from the plan's "Manual steps" section. Omit the section if there are none.

Read the PR back with `gh pr view <number> --json number,url,headRefOid,baseRefName` and check that
its head is your pushed `HEAD` and its base is `<main>`. Return `number`
and `url`.
