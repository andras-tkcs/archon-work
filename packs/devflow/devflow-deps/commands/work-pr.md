You work on one Dependabot pull request (Sonnet), attempt $next.output.attempts of 2: PR
#$next.output.number, branch `$next.output.branch`. You start with no memory of earlier steps.

Read first: the resolved profile `$ARTIFACTS_DIR/profile.json` and its `docs.must_read` and
`project_steward` file, the `pr-steward` skill (`devflow:pr-steward`, or `skills/pr-steward/SKILL.md`
under the devflow root), `$ARTIFACTS_DIR/deps-triage.md` (why this PR was chosen, and what to
watch), `.github/dependabot.yml`, and the doc that says how the locks are made. If this is
attempt 2, `$ARTIFACTS_DIR/deps/pr-$next.output.number-ci.md` has the failing jobs' logs from the last
push: start from them. Start project commands with `. "$ARTIFACTS_DIR/project-env.sh";`.

1. **Check out the PR branch**, clean: `git status --porcelain` must be empty, then
   `git fetch origin $next.output.branch` and `git switch --detach FETCH_HEAD`. If the branch has a
   conflict with the base (`gh pr view $next.output.number --json mergeable`), merge `origin/$preflight.output.main_branch` into
   it (a merge commit, never a rebase) and regenerate generated files rather than hand-resolving them.
2. **See what is red**: `gh pr checks $next.output.number`, then each failing job's log
   (`gh run view <run id> --log-failed`). Read the log before acting; never guess from the check name.
3. **Run the checks locally that apply to what the PR touches**, as the repo's CI does (read the
   workflow that is red): for a manifest or lockfile, regenerate the locks with the repo's own tool
   and run the profile's `verify.fast` commands plus the lockfile and audit checks the repo's CI runs
   for that ecosystem, at the level CI uses; for
   `.github/workflows`, confirm every `uses:` is pinned to a full SHA; for a Dockerfile, confirm the
   digest pin and that the build still parses. A command that cannot run on this host is reported as such.
4. **Repair only what the bump caused.** Lockfiles come from the tool, never by hand. A test that
   fails because the new version changed behaviour is fixed in the code under test only if the
   change is small and clearly right; otherwise stop with `needs-person` and the evidence. Never
   skip, weaken or delete a test, never lower a coverage floor or loosen a linter or audit policy to
   get green (`pr-steward`: a red check is real until proven otherwise). A check that is red on
   `$preflight.output.main_branch` too is not this PR's: say so with the link.
5. **Commit and push.** If there is something to push: commits with messages saying what was red and
   what fixed it, then `git push origin HEAD:refs/heads/$next.output.branch` (a plain push, never
   force; if it is rejected because Dependabot moved the branch, fetch, merge, re-run the checks you
   changed and push again). Verify with `gh pr view $next.output.number --json headRefOid` that the head
   is your commit. Leave the tree clean and **leave no local state on a branch you must not touch**:
   finish with `git switch --detach origin/$preflight.output.main_branch`.
6. Never merge, never close the PR, never `@dependabot` commands (they would overwrite your push),
   never touch another PR, never push to `$preflight.output.main_branch`.

Return `outcome`: `pushed` (you pushed fixes), `nothing-to-push` (it was already green and fresh, or
red for a reason outside the PR, which you explain), or `needs-person` (the evidence says what is
needed); `summary`: what was red, what you ran, what you changed; `head`: the PR head SHA now
(`gh pr view $next.output.number --json headRefOid -q .headRefOid`).
