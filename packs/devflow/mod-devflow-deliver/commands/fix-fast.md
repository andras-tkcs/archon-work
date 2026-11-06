Run facts are in `$ARTIFACTS_DIR/context.json`: `main_branch`, `shared_dir`, `branch`, `slug`, `title`.
The resolved profile is `$ARTIFACTS_DIR/profile.json`. The plan is `$ARTIFACTS_DIR/plan.md`; its
manifest lists each phase's `touches`.

The project's fast checks (`verify.fast` in `.devflow/devflow.yaml`) are red on this branch. Make them
green (Sonnet). Merges of parallel phases are the usual cause.

- The last run's result: $LOOP_PREV.check.output
- The full log, one section per command with its output: `$ARTIFACTS_DIR/verify-fast.md`.
- You are on the feature branch (`branch` in `$ARTIFACTS_DIR/context.json`). Start project commands with
  `. "$ARTIFACTS_DIR/project-env.sh";`.

Fix exactly the failing fast checks, and stay inside the plan's `touches`. `UNAVAILABLE` rows are
commands this host cannot run; leave them.

Follow `$ARTIFACTS_DIR/knowledge/pr-steward.md`'s "A red check is real until proven otherwise" and the project's
`project_steward` file: never skip, weaken or delete a test, and never lower a floor. Re-run each
failing command until it passes. Commit with a message saying what was broken. Leave the tree clean.
Do not push.
