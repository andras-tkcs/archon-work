# Archon runner VM

One-command setup for a Linux VM that runs **Claude Code** with **Archon** as the workflow
engine (research → plan → code → review pipelines, each in its own git worktree).
You drive it from a browser (iPad) via Archon's web UI, and get Slack notifications.

```
iPad (Safari, Tailscale app) ──HTTPS over tailnet──▶ VM: Tailscale Serve ─▶ Archon :3090 ─▶ Claude Code + gh + git
                                                                         └─:8443─▶ code-server (VS Code: worktrees, diffs)
Slack  ◀──────────── Socket Mode (outbound only) ────────────────────────────┘
```

Nothing is exposed to the public internet except SSH (and you can close that too).

| File | What it is |
|---|---|
| `bootstrap.sh` | Installer **and** updater, run as root. Baseline: a fresh Ubuntu 24.04 machine. Re-run it any time. |
| `slack-app-manifest.yml` | Paste into Slack to create the Archon app in one step. |
| `tailscale-policy.hujson` | Tailnet policy: who reaches the runners, Tailscale SSH rules (uses `tag:runner`). |
| `packs/devflow/` | The devflow workflow pack for Archon (plan → implement → review → PR, with `devflow-plan` publishing a parallel implementation workflow and `devflow-refine` revising it before implementation, for any repo with a devflow profile). The bootstrap installs it; see its [README](packs/devflow/README.md). |
| `scripts/test-devflow-pack.sh` | Validates the pack and replays its fixtures (needs `archon`). |
| `scripts/test-render-run.sh` | Tests the devflow pack's plan workflow renderer, its plan test scripts and its git scripts (needs `archon` and `bun`). |
| `scripts/test-ide-link-patch.sh` | Tests the bootstrap's patch that points Archon's **Open in IDE** button at code-server. |
| `scripts/test-archon-repo-switch.sh` | Tests the bootstrap's helpers that detect and replace plugins left by another Archon repo when `ARCHON_REPO` changes. |
| `.claude/toolkit.yaml` | This repo's devflow profile, so the devflow workflows can run on it. Its definition of done is `scripts/test-devflow-pack.sh` and `scripts/test-render-run.sh`. |

---

## 1. Before: one-time setup outside the VM

### Tailscale
1. Create a tailnet (or use yours) and install the **Tailscale app on the iPad**.
2. Admin console → **DNS**: enable **MagicDNS** and **HTTPS Certificates**
   (required for the `https://<vm>.<tailnet>.ts.net` URL).
3. Pick the machine's tag (`TS_TAG`, default `tag:runner`). For another tag, render the
   policy with it: `sed 's/tag:runner/tag:<your-tag>/g' tailscale-policy.hujson`
4. Admin console → **Access controls**: paste/merge the policy. It defines the tag, lets
   your devices reach tagged machines only on HTTPS (Archon on 443, code-server on 8443)
   and SSH, allows Tailscale SSH
   as `agent` (and as `root` with a browser re-check), and gives the tagged machines
   **no** access to your other devices. It replaces the default allow-all policy, so merge
   by hand if you use shares, subnet routers or other tags.
5. Admin console → **Settings → Keys → Generate auth key**: one-off, pre-approved,
   **tagged with the same tag** (the script also requests `TS_TAG` when joining). Tagged
   machines don't expire with your login and are covered by the policy above.

### Hetzner
1. Create a server: **Ubuntu 24.04**, your SSH key.
   - Archon's x86 binary needs a CPU with **AVX2**. **ARM (CAX)** servers avoid the question
     and are cheaper; CAX21 (4 vCPU / 8 GB) is a reasonable start for a few parallel runs.
2. Attach a **Cloud Firewall**: inbound TCP 22 and UDP 41641 only (the script sets the same
   rules in `ufw`, the cloud firewall is the second layer).

### GitHub
Decide which identity the agents push as: your account, or a separate bot account
(recommended: easy to revoke, clear in history). You'll log in with `gh` on the VM later.

### Slack (optional, for notifications)
1. <https://api.slack.com/apps> → **Create New App → From an app manifest** → pick the
   workspace → paste `slack-app-manifest.yml`.
2. **Basic Information → App-Level Tokens → Generate**, scope `connections:write`
   → copy the `xapp-…` token.
3. **Install to Workspace** → copy the **Bot User OAuth Token** `xoxb-…`.
4. Your Slack member ID (profile → ⋯ → *Copy member ID*) for the allow-list.

### This repo
Public is fine (no secrets in it). Because you'll `curl | sudo bash` it, protect `main`
and run a **tag or commit SHA** rather than a moving branch.

---

## 2. Run the bootstrap

SSH in as root (from a laptop or an iPad SSH app) and run:

```bash
curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/<tag>/bootstrap.sh \
  | sudo TS_AUTHKEY=tskey-auth-xxxx TS_HOSTNAME=runner1 TS_TAG=tag:runner \
         GIT_NAME="Your Name" GIT_EMAIL="you@example.com" bash
```

It installs base tools, GitHub CLI, Tailscale (with Tailscale SSH), Claude Code, Archon and
code-server (VS Code in the browser), the devflow toolkit plugins for Claude Code, bun and
Node.js, and the devflow workflow pack for Archon, turns on unattended upgrades, creates an
`agent` user (no sudo), registers `archon.service` and `code-server@agent.service`, sets up
the firewall and Tailscale Serve. The Archon service is
**enabled but not started** until Claude is logged in.

| Variable | Default | |
|---|---|---|
| `ARCHON_REPO` | `tkcs-lab/Archon` | GitHub `owner/repo` whose releases supply Archon, its providers and the Slack plugin: the tkcs-lab fork by default, `coleam00/Archon` for upstream, or your own fork. Must be `owner/repo`; the script refuses anything else. See below |
| `TS_AUTHKEY` | – | Without it, run `sudo tailscale up --ssh` yourself and re-run |
| `TS_HOSTNAME` | VM hostname | Name in the tailnet / URL |
| `TS_TAG` | `tag:runner` | Tailscale tag of the machine; must match the policy and the auth key. Re-runs warn if the machine doesn't carry it |
| `AGENT_USER` | `agent` | User that runs Claude Code + Archon |
| `ARCHON_PORT` | `3090` | |
| `CODE_SERVER_PORT` | `8080` | Local port of code-server (loopback only); the tailnet URL is always `:8443` |
| `GIT_NAME`, `GIT_EMAIL` | – | Commit identity for the agents. With GitHub email privacy on, use the noreply address (`<id>+<user>@users.noreply.github.com`, see github.com/settings/emails), otherwise pushes fail with `GH007` |
| `UPGRADE` | `1` | `0` = only install what's missing and re-apply config; upgrade nothing |
| `AUTO_REBOOT` | `1` | Unattended upgrades may reboot when a kernel/libc update needs it |
| `REBOOT_TIME` | `03:00` | When that reboot may happen (VM clock: UTC on Hetzner, i.e. 04:00 in Budapest in winter) |
| `LOCK_SSH_TO_TAILSCALE` | `0` | `1` closes public port 22 |
| `DEVFLOW_PACK` | `tkcs-lab/archon-work/packs/devflow` | Archon workflow pack to install, `owner/repo/path[@tag]`. Point it at your fork, add `@<tag>` to pin it, or set it empty to install none |

**Which Archon.** By default the script installs the tkcs-lab fork of Archon
(`tkcs-lab/Archon`): its binaries download their server, web UI, providers and plugins from
the fork's own releases, and from 0.13.4 it has `extraWorkflowSources`, which the devflow
pack's plan workflows need and upstream does not have. `ARCHON_REPO=coleam00/Archon` installs
upstream with its stock installer. Another fork works if its `scripts/install.sh` reads
`ARCHON_RELEASE_REPO` and its binaries embed their own repo, as the tkcs-lab fork's do, and if
its latest release is a normal release, not a pre-release: GitHub's "latest" endpoint skips
pre-releases, so the upgrade check would find nothing. Write `ARCHON_REPO` in the repository's
exact case.

**Switching.** The script records the repo Archon came from in
`/var/lib/archon-bootstrap/archon-repo` (on a runner set up before that, it reads it from the
Claude provider's plugin id). When `ARCHON_REPO` names another repo, a run with `UPGRADE=1`
stops Archon (running workflows are interrupted), installs it from the new repo, replaces the
old repo's first-party plugins (`provider-*`, `chat-slack`, `forge-github`) with the new
repo's, and starts it again. With `UPGRADE=0` it only warns. Keep passing `ARCHON_REPO` on
every re-run if it is not the default, or the next run switches the runner back to the
tkcs-lab fork.

Variables are not remembered between runs: pass the ones you need each time
(`TS_AUTHKEY` is only needed until the machine has joined the tailnet; keep passing
`TS_TAG` if it isn't the default, so the tag check stays right).

---

## 3. After: one-time logins on the VM

```bash
sudo -iu agent

claude                      # choose /login, sign in with your Claude subscription, then /exit
gh auth login               # GitHub.com → HTTPS → login with browser/device code
gh auth setup-git
echo "GH_TOKEN=$(gh auth token)" >> ~/.archon/.env

# Slack (optional): edit ~/.archon/.env and fill in
#   SLACK_BOT_TOKEN=xoxb-...  SLACK_APP_TOKEN=xapp-...  SLACK_ALLOWED_USER_IDS=U0123...
nano ~/.archon/.env

exit
```

Then re-run the bootstrap (same command as above). This time it installs the Slack plugin
if the tokens are set, starts Archon and checks `/api/health`. The summary prints the URL.

### Check it works
1. On the iPad (Tailscale on): open `https://<TS_HOSTNAME>.<tailnet>.ts.net`, add a
   repository, and run something small, e.g. ask `archon-assist` to summarise the repo.
2. Slack: invite the bot to a channel (`/invite @archon`) or DM it, then
   `/archon-workflow list`.
3. Once Tailscale SSH works from your devices (`ssh agent@<TS_HOSTNAME>`), close public SSH:
   `curl … | sudo LOCK_SSH_TO_TAILSCALE=1 bash` and remove port 22 from the Hetzner firewall.

---

## Daily use

- **Prompting / oversight:** the Archon web UI. Runs, their steps and worktrees are in one
  place; approval gates wait for you there.
- **Slack notifications:** Archon reports to the **Slack thread a run was started from**
  (🔄 → ✅/❌, a live status message, buttons for approval gates). Runs started from the web
  UI or the CLI don't post to Slack, so start the runs you want to be pinged about from
  Slack (`/archon …` or `/archon-workflow run …`).
- **devflow:** in a repository with a devflow profile (`.claude/toolkit.yaml`), run
  `tkcs-lab/devflow:devflow-plan` (or `-refine`, `-quick`, `-docs`, `-audit`, `-config`, `-deps`) with the
  issue or the change; see [packs/devflow](packs/devflow/README.md).
- **Watching the code change (git diff):** Archon's UI has no diff view, so the VM also
  runs code-server at `https://<TS_HOSTNAME>.<tailnet>.ts.net:8443` (works in iPad Safari).
  It opens `~agent/.archon/workspaces`, where Archon keeps its clones and worktrees
  (`<owner>/<repo>/worktrees/<branch>`). To open the worktree of a run, tap **↗**
  (*Open in IDE*) next to the run in Archon's UI: it opens in code-server in a new tab
  (Archon itself would open `vscode://`, which an iPad can't; `bootstrap.sh` repoints it).
  Or use **File → Open Folder…**. The **Source Control** panel then lists the changed files
  and shows side-by-side diffs, refreshing as the agent edits. It runs as `agent` with no
  password, behind the tailnet policy like Archon — avoid editing files a run is working on.
- **Raw terminal:** `ssh agent@<TS_HOSTNAME>` over Tailscale, then `tmux` + `claude`.

## Operations

```bash
journalctl -u archon -f              # logs
journalctl -u code-server@agent -f   # code-server logs
sudo systemctl restart archon        # after editing ~agent/.archon/.env
curl -s localhost:3090/api/health    # health (shows Slack once connected)
```

### Automatic updates (unattended-upgrades)

Runs daily without you: Ubuntu security **and** `-updates` packages, plus the GitHub CLI and
Tailscale repos; old kernels and unused dependencies are removed. If an update needs a
reboot, the VM reboots at `REBOOT_TIME` (`AUTO_REBOOT=0` turns that off, then reboot
yourself when the script warns *reboot pending*). Archon comes back on its own after a reboot,
but a workflow running at that moment is interrupted.

```bash
sudo unattended-upgrade --dry-run --debug   # what would be upgraded now
less /var/log/unattended-upgrades/unattended-upgrades.log
```

Claude Code updates itself. Archon and code-server are **not** auto-updated (an update
restarts them); use the script for that.

### Upgrading with the script

Re-running `bootstrap.sh` is the upgrade path. Each run:

- upgrades all apt packages,
- runs `claude update`,
- updates Archon **only if a newer release exists, or `ARCHON_REPO` names another repo than
  the one it came from**. In that case it stops the service (running workflows are
  interrupted), replaces the binary, re-adds the Claude provider (required after every Archon
  update), replaces plugins left by another repo, and starts it again,
- updates the devflow toolkit plugins (unless they are synced from claude.ai, which manages them),
  bun, and the devflow pack (`archon plugin update`; a running workflow keeps the revision it
  started with). Node.js is installed once and not upgraded, so a new major can't break a
  project's checks,
- reinstalls code-server from its latest release (restarted only if the version changed),
- re-applies config (unattended-upgrades, systemd unit, code-server config, Archon's Open in IDE link, firewall,
  Tailscale Serve) and installs anything new, e.g. the Slack plugin once its tokens are in `.env`,
- restarts Archon only when its binary, `.env`, unit or plugins changed. Otherwise a running Archon
  is left alone.

To change config without upgrading anything: `curl … | sudo UPGRADE=0 bash`.

More VMs: run the same bootstrap with a different `TS_HOSTNAME`; each runs its own Archon.

## Security notes

- Archon binds to all interfaces and its web login is off on a single-user SQLite setup,
  so **the firewall plus your tailnet ACLs are the access control**. Keep both.
- code-server listens on loopback only and has no password: anyone who reaches `:8443`
  through the tailnet gets an editor and a terminal as `agent`. Same trust boundary as Archon.
- The `agent` user has no sudo; agents run with broad tool permissions inside it.
- Secrets live only in `~agent/.archon/.env` (mode 600) and Claude's/gh's own credential
  stores on the VM. Never commit them; `.gitignore` covers `.env` files.
- `SLACK_ALLOWED_USER_IDS` empty = anyone in the workspace can start agents on your VM.
- Your Tailscale auth key ends up in shell history when passed on the command line;
  use a one-off key, or prefix the command with a space if `HISTCONTROL=ignorespace`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `CPU has no AVX2` | Use an ARM (CAX) server, or another x86 type |
| `ssh agent@<vm>` denied or hangs, or *not tagged* warning | Policy not applied, or the VM doesn't carry `TS_TAG` (admin console → Machines → Edit ACL tags) |
| `tailscale up` fails with a tags error | The tag isn't in the policy's `tagOwners`, or the auth key is tagged with a different tag |
| `tailscale serve failed` | Enable MagicDNS + HTTPS certificates in the Tailscale admin console, re-run |
| `…:8443` doesn't load, Archon does | The tailnet policy lacks `tcp:8443` (re-paste `tailscale-policy.hujson`), or check `systemctl status code-server@agent` |
| **↗ Open in IDE** opens a blank page | Re-run the bootstrap (`UPGRADE=0` is enough) and reload the page: it repoints the link for each installed Archon version. If it warns `Open in IDE link not found`, Archon changed its web bundle and the patch needs updating. To get `vscode://` back, delete `~agent/.archon/web-dist/` and restart Archon (it downloads the original again) |
| Service crash-loops | Claude not logged in as `agent`, check `journalctl -u archon -n 50` |
| `archon not found after install` | The installer should put it in `/usr/local/bin`; check `~/.archon/install.json` and `archon doctor` |
| Runs fail after an Archon update | Provider missing: `sudo -iu agent archon provider add claude`, then `sudo systemctl restart archon` |
| `… belongs to coleam00/Archon/plugins/provider-claude` | A plugin from another Archon repo. Re-run the bootstrap with `UPGRADE=1`, or by hand: `sudo -iu agent archon plugin remove <that id>`, then `sudo -iu agent archon provider add claude` |
| `baseline is Ubuntu 24.04` | The script only supports Ubuntu; reinstall the VM with the Ubuntu 24.04 image |
| Slack bot silent | Both tokens set? Plugin installed (`sudo -iu agent archon plugin list` shows `…/plugins/chat-slack`)? Bot invited to the channel? Reinstall the Slack app after changing scopes |
