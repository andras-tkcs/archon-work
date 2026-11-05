# After implementing devflow-plan: comment the plan and its implementation run on the issue

Do these after the feature PR (`feat/devflow-plan-issue-comments`) has merged into `main`.

## 1. Re-run bootstrap.sh on each runner and check ARCHON_PUBLIC_URL

Why: `bootstrap.sh` writes `ARCHON_PUBLIC_URL` from the runner's live Tailscale name and restarts
Archon so script nodes see it. With `UPGRADE=1` it also installs the merged devflow pack (with the
new `mod-devflow-issue` building block). CI has no runner and no tailnet, so only you can do this.
About 10 minutes per runner.

1. Make sure no workflow is running: `sudo -iu agent archon workflow runs --json` shows no run with
   status `running` or `paused`. You can also check the Archon web UI at
   `https://<machine>.<tailnet>.ts.net`.
2. Make sure Tailscale is up: `tailscale status` lists this machine. If it is not up, the bootstrap
   prints a warning and writes no run link.
3. Re-run the bootstrap with the same command as in the root README's "2. Run the bootstrap"
   section: https://github.com/tkcs-lab/archon-work/blob/main/README.md#2-run-the-bootstrap
   (`UPGRADE=1` is the default).
4. In the summary at the end, the new `Run links` line shows `https://<machine>.<tailnet>.ts.net`.
5. `sudo -iu agent grep '^ARCHON_PUBLIC_URL=' ~/.archon/.env` prints exactly one line,
   `ARCHON_PUBLIC_URL=https://<machine>.<tailnet>.ts.net`. This is not a secret. To use another
   address, edit the line and run `sudo systemctl restart archon`.
6. `sudo -iu agent archon workflow list | grep mod-devflow-issue` prints the new building block.

**Report:** `ma1-rerun-bootstrap: PASS on <runner(s)>: ARCHON_PUBLIC_URL=https://<host>…ts.net, mod-devflow-issue listed` (or `FAIL: <which step, what you saw>`)

## 2. Plan a throwaway issue and check the Planning started / stopped comments and their run links

Why: only a real runner, a real issue and the real Archon UI show that the comments are posted
with the agent's GitHub login and that the run link opens over the tailnet. About 10 minutes.

1. Open a new issue at https://github.com/tkcs-lab/archon-work/issues/new with the title
   `devflow issue comment test` and note its number `<n>`.
2. On the runner, as `agent` and in the archon-work checkout, start the plan run:
   `archon workflow run tkcs-lab/devflow:devflow-plan "#<n>" --detach`. This is the form shown in
   https://github.com/tkcs-lab/archon-work/blob/main/packs/devflow/README.md.
3. Within a minute, the issue (https://github.com/tkcs-lab/archon-work/issues/<n>) shows a comment
   by the agent's account headed **Planning started**. It names the run id, and it has an
   **Open the run in Archon** link.
4. On a device on your tailnet, click the link. The run opens in the Archon web UI at
   `…/console/r/<run id>`.
5. When the run asks its first interview question (in the Archon attention queue), answer `stop`.
6. The issue gets a second comment headed **Planning stopped** that says
   ``stopped at node `interview` ``. It has the same run id and a working run link, and no error
   text or interview content.
7. Close the throwaway issue.

**Report:** `ma2-issue-end-to-end: PASS: issue #<n> got "Planning started" and "Planning stopped", run link opened over the tailnet` (or `FAIL: <which step, what you saw>`)
