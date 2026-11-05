# After implementing: mod-devflow-* internal workflows, and devflow-plan tests every plan before it publishes

Do these steps after the PR is merged. The runner keeps running the old pack until you update it.
Until then, nothing changes for new runs. After the update, any `devflow-run-<slug>` published
before the rename fails at its first phase, because the old names are gone with no aliases. One
known case is `privacyfence/peek`'s `backend-token-calls`. Run `devflow-plan` again for such a plan
if you still need it.

## 1. Update the installed devflow pack on the runner (about 5 minutes)

Why: the installed pack still has `devflow-phase` and `devflow-deliver`. The new `devflow-plan`
checks for `mod-devflow-phase` and `mod-devflow-deliver` before it renders anything. CI cannot
reach the runner's Archon install.

1. SSH into the runner as root.
2. Update the pack. Pick one of these:
   - Run `sudo -iu agent archon plugin update tkcs-lab/archon-work/packs/devflow`.
   - Or rerun the bootstrap, the upgrade path described in
     [README → Upgrading with the script](https://github.com/tkcs-lab/archon-work/blob/main/README.md#upgrading-with-the-script).

   A workflow that is already running keeps the revision it started with.
3. Run `sudo -iu agent archon plugin list | grep devflow`. The revision column should show the
   merge commit's short SHA from
   [the main branch history](https://github.com/tkcs-lab/archon-work/commits/main).
4. In any registered repository's checkout, run:
   `sudo -iu agent bash -c 'cd <repo checkout> && archon workflow list --json' | grep -o '"tkcs-lab/devflow:[a-z-]*"'`.
   The list must include `"tkcs-lab/devflow:mod-devflow-phase"` and
   `"tkcs-lab/devflow:mod-devflow-deliver"`. It must not include `"tkcs-lab/devflow:devflow-phase"`
   or `"tkcs-lab/devflow:devflow-deliver"`.

**Report:** `ma1-update-pack: PASS (catalog shows mod-devflow-phase and mod-devflow-deliver, no devflow-phase/devflow-deliver)`, or `FAIL: <what the list showed>`

## 2. Run devflow-plan once on a small real change (about 30-60 minutes, mostly unattended)

Why: only a live run exercises the Opus executability reviewer, the fix loop and the publish
message. The fixtures stub all three.

1. In a repository with a devflow profile, start the run:
   `archon workflow run tkcs-lab/devflow:devflow-plan "<a small real change or issue URL>" --detach`.
   Use the web UI's run page to follow it.
2. Answer the interview questions in the attention queue.
3. On the run page, check that the run passes through these nodes:
   - `plan-loop`, with `finalize`, `render`, `plan-test`, `plan-review` and `plan-check` inside it;
   - then `plan-result`;
   - then `publish`.
4. When the run completes, open `published.md` in the run's artifacts. It has an `## Assumptions`
   section: either the bullets or the line "None: every decision in the plan was made in the
   interview." The `publish` node's message says `assumptions: none` or `assumptions: <n>`.
5. If the run failed in `plan-check` instead, open `test-findings.md` in the artifacts. Check that
   each finding names a real problem in the plan; that counts as a pass for the test stage itself.
   If a finding is wrong, report it as a FAIL with that finding.

**Report:** `ma2-plan-run: PASS (run <run id>: plan-loop ran <n> round(s), published with assumptions: <none|n>)`, or `FAIL: <node and message>`
