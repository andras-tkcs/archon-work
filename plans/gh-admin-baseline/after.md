# After implementing: strip the admin path from devflow-config; bootstrap a sealed admin user with gh-baseline

Do steps 1-6 after the last phase is merged into `feat/gh-admin-baseline` and before the PR merges.
Do step 7 after the PR merges. Never paste a token into chat, the PR or a file other than the one
named in the step.

## 1. Require code-owner review on `main` (ma0, ~3 min)

Why: `.github/CODEOWNERS` only blocks merges once the `main` ruleset enforces it. `agent` must
never change rulesets, so the admin account does this.

1. Sign in to GitHub as the **admin account** (`andras-tkcs`), not the agent account.
2. Open the `main` ruleset: https://github.com/tkcs-lab/archon-work/settings/rules/26458212
3. Under **Require a pull request before merging**, tick **Require review from Code Owners**.
4. Click **Save changes**.
5. In a terminal, run
   `gh api repos/tkcs-lab/archon-work/codeowners/errors --jq '.errors | length'`.
   It prints `0`. The PR page now shows "Review required" from `@andras-tkcs` for `bootstrap.sh`
   and `admin/`.

**Report:** `ma0 code-owner review: PASS (ruleset updated, codeowners errors = 0)` or `FAIL: <what you saw>`

## 2. Bootstrap a test VM from the feature branch (ma1, ~15 min)

Why: the download, the hash check, the user creation and the file modes only run as root on a real
VM. CI cannot run them.

1. SSH in as root to a disposable test VM (Ubuntu 24.04, already joined to the tailnet), from the
   Hetzner console (https://console.hetzner.cloud/projects) or `ssh root@<test-vm>`.
2. Run:
   ```
   curl -fsSL https://raw.githubusercontent.com/tkcs-lab/archon-work/feat/gh-admin-baseline/bootstrap.sh \
     | sudo BOOTSTRAP_REF=feat/gh-admin-baseline DEVFLOW_PACK=tkcs-lab/archon-work/packs/devflow@feat/gh-admin-baseline UPGRADE=0 bash
   ```
3. Check that the output has the line `Sealed admin user 'ghadmin' (admin GitHub identity; not
   reachable from agent)`.
4. Check that there is **no** `WARN: admin tools not installed` line.
5. Check that the summary ends with the "Admin GitHub identity (one-time, as root)" block.
6. If `archon plugin add` refuses the `@feat/gh-admin-baseline` ref, install the pack from the
   branch by hand as `agent` before step 6. The rest of this step is unaffected.

**Report:** `ma1 bootstrap from branch: PASS (4b ran, no admin-tools WARN, admin block printed)` or `FAIL: <the WARN/ERROR line>`

## 3. Check that agent cannot reach ghadmin (ma2, ~3 min)

Why: proves the admin identity is not reachable from the user Claude runs as.

1. On the test VM, as root: `sudo -iu agent`.
2. Run `ls ~ghadmin`. It fails with `Permission denied`.
3. Run `cat ~ghadmin/bin/gh-baseline`. It fails with `Permission denied`.
4. Run `exit` to go back to root.
5. Run `sudo -iu ghadmin`, then `which gh-baseline`. It prints `/home/ghadmin/bin/gh-baseline`.
6. Run `ls -ld ~ && ls -l ~/bin`. The home is `drwx------`, and `gh-baseline` is
   `-rwxr-x--- root ghadmin`.

**Report:** `ma2 isolation: PASS (agent denied on home and script; ghadmin runs gh-baseline)` or `FAIL: <command and output>`

## 4. Log ghadmin in with an admin PAT and run a real audit (ma3, ~10 min)

Why: this exercises the merged script against the real org with the admin token.

1. In a browser signed in as the **admin account**, open
   https://github.com/settings/tokens/new (Settings > Developer settings > Personal access tokens >
   Tokens (classic)).
2. Note: `ghadmin on <test-vm>`. Expiration: 90 days, or your choice.
3. Tick the scopes `repo`, `admin:org`, `read:org` and `admin:repo_hook`.
4. Click **Generate token** and copy it. It goes only into the next command; do not save it
   anywhere else.
5. On the VM as root, run `sudo -iu ghadmin`, then `gh auth login --with-token`. Paste the token,
   press Enter, then Ctrl-D.
6. `gh auth status` shows the admin account logged in.
7. Run `cp policy.example.json policy.json`, then `nano policy.json`. Set `reference` to a repo of
   yours that you trust, and adjust the values for your org.
8. Run `gh-baseline audit tkcs-lab --all --policy ~/policy.json; echo "exit $?"`. It prints
   findings per org and repo, then `exit 0` or `exit 1`, with no Python traceback.
9. Run `cp ~/policy.json ~/policy.bad.json`, delete the `"checks"` entry for one id, then
   `gh-baseline audit tkcs-lab --policy ~/policy.bad.json`. It prints
   `policy error: checks is missing <ID>` and exits 2. Delete `policy.bad.json` afterwards.
10. Set a reminder to rotate the PAT before it expires: create a new one, run the same
    `gh auth login --with-token`, then revoke the old one at https://github.com/settings/tokens.

**Report:** `ma3 admin audit: PASS (exit <0|1>, <n> findings, bad policy -> exit 2)` or `FAIL: <output>`

## 5. Add the `workflow` scope to agent's token on the existing VM (ma3b, ~5 min)

Why: `devflow-config` pushes `.github/workflows/` fixes in its PR, and GitHub refuses those pushes
without the `workflow` scope (D15).

1. On the existing VM, as root: `sudo -iu agent`.
2. Run `gh auth refresh -s workflow` and confirm in the browser with the **agent** account.
3. Run `nano ~/.archon/.env`. Replace the `GH_TOKEN=` line's value with the output of
   `gh auth token`; it stays only in that file.
4. Run `exit`, then as root `systemctl restart archon`.
5. As agent, run `gh auth status`. The token scopes include `workflow`.

**Report:** `ma3b agent workflow scope: PASS (gh auth status lists workflow, Archon restarted)` or `FAIL: <output>`

## 6. Run the slimmed devflow-config on a real project (ma4, ~20 min)

Why: the split between devflow-config (files, as agent) and gh-baseline (settings, as ghadmin) can
only be shown against a real repo.

1. On the test VM, as `agent`, with Claude and `gh` logged in, run `archon workflow sync` in the
   project's checkout.
2. Open the Archon web UI (`https://<test-vm>.<tailnet>.ts.net`) and run
   `tkcs-lab/devflow:devflow-config` on one project (this repo is fine).
3. In the run's artifacts, `config-review.md` has a section `## Settings for the admin
   (gh-baseline)` with lines of the form
   `gh-baseline apply OWNER/REPO --policy ~/policy.json --only <ID>` (or "manual in the GitHub UI").
4. File gaps (including `.archon/config.yaml` `extraWorkflowSources`, when it has one) arrive as
   a PR from the agent account. The run never asks to apply settings.

**Report:** `ma4 devflow-config: PASS (settings listed for gh-baseline, file fixes in PR #<n>)` or `FAIL: <what happened>`

## 7. After the merge: tag v0.4.0 and roll it out to the existing VM (ma5, ~15 min)

Why: the README bootstraps only from a tag. Without the rollout, the existing VM has lost
devflow-config's settings path and has no gh-baseline in its place (D17).

1. Find the merge commit on https://github.com/tkcs-lab/archon-work/commits/main.
2. In a checkout, run:
   `git fetch origin && git tag -a v0.4.0 -m "v0.4.0" <merge commit> && git push origin v0.4.0`.
3. Check https://github.com/tkcs-lab/archon-work/tags lists `v0.4.0`.
4. On the existing VM, as root, run:
   ```
   curl -fsSL https://raw.githubusercontent.com/tkcs-lab/archon-work/v0.4.0/bootstrap.sh \
     | sudo BOOTSTRAP_REF=v0.4.0 UPGRADE=0 bash
   ```
5. The summary has no `Admin tools not installed` line.
6. Repeat step 3 (isolation) and step 4 (PAT login and audit) on this VM. Use a new PAT named
   `ghadmin on <existing-vm>`.

**Report:** `ma5 v0.4.0 rollout: PASS (tag pushed, existing VM bootstrapped, isolation and audit OK)` or `FAIL: <step and output>`
