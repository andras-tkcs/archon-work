#!/usr/bin/env bash
# Archon + Claude Code runner — bootstrap for a fresh Ubuntu 24.04 VM (e.g. Hetzner).
#
# Safe to run any time: first run installs, later runs converge config and upgrade
# (apt packages, Claude Code, Archon when a newer release exists).
#
# Usage (as root):
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/<tag-or-commit>/bootstrap.sh \
#     | sudo TS_AUTHKEY=tskey-auth-... GIT_NAME="Your Name" GIT_EMAIL="you@example.com" bash
#
# No secrets live in this file: tokens are passed at run time or written to
# ~agent/.archon/.env on the VM. Safe for a public repo. See README.md.
#
# Optional env:
#   ARCHON_REPO=coleam00/Archon GitHub owner/repo whose releases provide Archon, its providers and
#                               the Slack plugin (set to your fork to run your own build)
#   AGENT_USER=agent            unix user that runs Claude Code + Archon (no sudo)
#   ARCHON_PORT=3090            Archon HTTP port (Archon default)
#   CODE_SERVER_PORT=8080       code-server (VS Code in the browser) port, bound to 127.0.0.1
#   TS_AUTHKEY=                 Tailscale auth key; without it run `tailscale up --ssh` yourself
#   TS_HOSTNAME=<hostname -s>   machine name in the tailnet -> https://<name>.<tailnet>.ts.net
#   TS_TAG=tag:runner           Tailscale tag for this machine (must exist in the policy's tagOwners;
#                               use the same tag on the auth key, or an untagged key)
#   GIT_NAME= GIT_EMAIL=        commit identity for the agents
#   UPGRADE=1                   0 = only install missing parts and apply config, upgrade nothing
#   AUTO_REBOOT=1               unattended-upgrades may reboot when a kernel/libc update needs it
#   REBOOT_TIME=03:00           when that reboot may happen (VM clock, UTC on Hetzner)
#   LOCK_SSH_TO_TAILSCALE=0     1 = close public port 22 (only once Tailscale SSH works)
#   DEVFLOW_PACK=andras-tkcs/archon-work/packs/devflow
#                               Archon workflow pack to install (owner/repo/path[@tag]); empty = none
set -euo pipefail

ARCHON_REPO="${ARCHON_REPO:-coleam00/Archon}"
AGENT_USER="${AGENT_USER:-agent}"
ARCHON_PORT="${ARCHON_PORT:-3090}"
CODE_SERVER_PORT="${CODE_SERVER_PORT:-8080}"
CODE_SERVER_HTTPS_PORT=8443   # must match the tcp:8443 grant in tailscale-policy.hujson
TS_AUTHKEY="${TS_AUTHKEY:-}"
TS_HOSTNAME="${TS_HOSTNAME:-$(hostname -s)}"
TS_TAG="${TS_TAG:-tag:runner}"
[[ "$TS_TAG" == tag:* ]] || TS_TAG="tag:$TS_TAG"
# Goes into URLs and a piped installer: refuse anything but owner/repo.
[[ "$ARCHON_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] \
  || { printf 'ERROR: ARCHON_REPO must be owner/repo, got: %s\n' "$ARCHON_REPO" >&2; exit 1; }
GIT_NAME="${GIT_NAME:-}"
GIT_EMAIL="${GIT_EMAIL:-}"
UPGRADE="${UPGRADE:-1}"
AUTO_REBOOT="${AUTO_REBOOT:-1}"
REBOOT_TIME="${REBOOT_TIME:-03:00}"
LOCK_SSH_TO_TAILSCALE="${LOCK_SSH_TO_TAILSCALE:-0}"
DEVFLOW_PACK="${DEVFLOW_PACK-andras-tkcs/archon-work/packs/devflow}"
STATE_DIR=/var/lib/archon-bootstrap   # change-detection sums, so re-runs restart only what changed

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mWARN: %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight
[[ $EUID -eq 0 ]] || die "run as root (pipe into 'sudo bash')"
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == ubuntu ]] || die "baseline is Ubuntu 24.04 (found ${ID:-unknown} ${VERSION_ID:-})"
[[ "${VERSION_ID:-}" == 24.04 ]] || warn "tested on Ubuntu 24.04, this is ${VERSION_ID:-?}"
if [[ "$(uname -m)" == x86_64 ]] && ! grep -qw avx2 /proc/cpuinfo; then
  die "CPU has no AVX2 — Archon's x64 binary won't run. Pick an ARM (CAX) or newer x64 server type."
fi

export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
APT=(apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

# ---------------------------------------------------------------- 1. packages
log "Packages"
apt-get update -y
"${APT[@]}" install --no-install-recommends \
  curl ca-certificates gnupg git tmux jq unzip xz-utils build-essential ufw sudo \
  unattended-upgrades needrestart python3-yaml python3-venv

if [[ ! -f /etc/apt/sources.list.d/github-cli.list ]]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
  chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
  apt-get update -y
fi
"${APT[@]}" install gh

command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh

if [[ "$UPGRADE" == 1 ]]; then
  log "Upgrading apt packages"
  "${APT[@]}" upgrade --with-new-pkgs
  "${APT[@]}" autoremove --purge
fi

# ---------------------------------------------------------------- 2. unattended upgrades
# Ubuntu's 50unattended-upgrades already covers <distro>-security; this adds
# -updates and the GitHub CLI + Tailscale repos, cleanup, and the reboot policy.
log "Unattended upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
reboot_flag=false; [[ "$AUTO_REBOOT" == 1 ]] && reboot_flag=true
cat > /etc/apt/apt.conf.d/52archon-runner <<EOF
// Managed by bootstrap.sh — re-run the script instead of editing.
Unattended-Upgrade::Origins-Pattern {
        "origin=\${distro_id},archive=\${distro_codename}-updates";
        "site=cli.github.com";
        "site=pkgs.tailscale.com";
};
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "$reboot_flag";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "$REBOOT_TIME";
EOF
systemctl enable --now unattended-upgrades.service apt-daily.timer apt-daily-upgrade.timer >/dev/null
unattended-upgrade --dry-run >/dev/null 2>&1 || warn "unattended-upgrade --dry-run reported a problem"

# ---------------------------------------------------------------- 3. tailscale
log "Tailscale"
if ! tailscale status >/dev/null 2>&1; then
  if [[ -n "$TS_AUTHKEY" ]]; then
    tailscale up --authkey="$TS_AUTHKEY" --hostname="$TS_HOSTNAME" --advertise-tags="$TS_TAG" --ssh
  else
    warn "Tailscale not logged in. Run: sudo tailscale up --ssh --hostname=$TS_HOSTNAME --advertise-tags=$TS_TAG  (then re-run this script)"
  fi
fi
if tailscale status >/dev/null 2>&1 \
   && ! tailscale status --json | jq -e --arg t "$TS_TAG" '(.Self.Tags // []) | any(.[]; . == $t)' >/dev/null; then
  warn "this machine is not tagged $TS_TAG — the tailnet policy won't apply to it. Fix: admin console -> Machines -> Edit ACL tags"
fi

# ---------------------------------------------------------------- 4. agent user
log "Agent user '$AGENT_USER' (no sudo on purpose: agents run with broad permissions)"
id "$AGENT_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$AGENT_USER"
AGENT_HOME="$(getent passwd "$AGENT_USER" | cut -d: -f6)"
AGENT_PATH="$AGENT_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
as_agent() { su - "$AGENT_USER" -c "export PATH=\"$AGENT_PATH\"; $1"; }

if [[ -n "$GIT_NAME" ]];  then as_agent "git config --global user.name  $(printf %q "$GIT_NAME")"; fi
if [[ -n "$GIT_EMAIL" ]]; then as_agent "git config --global user.email $(printf %q "$GIT_EMAIL")"; fi
as_agent "git config --global init.defaultBranch main"

# ---------------------------------------------------------------- 5. claude code
log "Claude Code"
if [[ ! -x "$AGENT_HOME/.local/bin/claude" ]]; then
  as_agent "curl -fsSL https://claude.ai/install.sh | bash"
elif [[ "$UPGRADE" == 1 ]]; then
  as_agent "claude update" || warn "claude update failed (it also auto-updates itself)"
fi
as_agent "claude --version" >/dev/null || die "claude not runnable after install"

# ---------------------------------------------------------------- 5b. devflow pack prerequisites
# The devflow pack's preflight needs the devflow toolkit as a Claude Code plugin of the agent user.
# Plugins synced from claude.ai are managed there; otherwise they come from the GitHub marketplace.
log "devflow toolkit (Claude Code plugins)"
TOOLKIT_PLUGINS=(devflow stack-python stack-go stack-swift stack-ipados)
plugin_ids="$(as_agent "claude plugin list --json" 2>/dev/null | jq -r '.[].id' || true)"
if grep -qx 'devflow@synced' <<<"$plugin_ids"; then
  echo "devflow is synced from claude.ai"
else
  as_agent "claude plugin marketplace add andras-tkcs/claude-toolkit" >/dev/null \
    || warn "could not add the claude-toolkit marketplace"
  if [[ "$UPGRADE" == 1 ]]; then
    as_agent "claude plugin marketplace update claude-toolkit" >/dev/null \
      || warn "could not update the claude-toolkit marketplace"
  fi
  for p in "${TOOLKIT_PLUGINS[@]}"; do
    if ! grep -qx "$p@claude-toolkit" <<<"$plugin_ids"; then
      as_agent "claude plugin install $p@claude-toolkit --scope user" || warn "could not install the $p plugin"
    elif [[ "$UPGRADE" == 1 ]]; then
      as_agent "claude plugin update $p@claude-toolkit" >/dev/null || warn "could not update the $p plugin"
    fi
  done
fi

# Archon script nodes run on bun; Node.js/npm is what JavaScript projects' setup hooks and checks call.
log "bun and Node.js for $AGENT_USER"
if ! as_agent "command -v bun" >/dev/null; then
  as_agent "curl -fsSL https://bun.sh/install | bash >/dev/null && ln -sf ~/.bun/bin/bun ~/.local/bin/bun"
elif [[ "$UPGRADE" == 1 ]]; then
  as_agent "bun upgrade" >/dev/null || warn "bun upgrade failed"
fi
as_agent "bun --version" >/dev/null || die "bun not runnable after install"
# Installed once at the current LTS and then left alone: a new major can break a project's checks.
install_node() {
  local arch ver
  case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) return 1 ;; esac
  ver="$(curl -fsSL https://nodejs.org/dist/index.json | jq -r '[.[] | select(.lts != false)][0].version')" || return 1
  [[ -n "$ver" ]] || return 1
  as_agent "mkdir -p ~/.local/node && curl -fsSL https://nodejs.org/dist/$ver/node-$ver-linux-$arch.tar.xz | tar -xJ --strip-components=1 -C ~/.local/node && ln -sf ~/.local/node/bin/node ~/.local/node/bin/npm ~/.local/node/bin/npx ~/.local/bin/"
}
if ! as_agent "command -v node" >/dev/null; then
  install_node || warn "Node.js install failed: projects whose setup hook or checks need npm will fail"
fi

# ---------------------------------------------------------------- 6. archon
# The quick installer puts the binary in /usr/local/bin (needs root). Providers
# are per user and must be re-added after every Archon update.
log "Archon"
archon_latest() {
  curl -fsSL "https://api.github.com/repos/$ARCHON_REPO/releases/latest" 2>/dev/null \
    | jq -r '.tag_name // empty' | sed 's/^v//'
}
need_archon=0
if ! command -v archon >/dev/null; then
  need_archon=1
elif [[ "$UPGRADE" == 1 ]]; then
  latest="$(archon_latest || true)"
  current="$(archon version 2>/dev/null || true)"
  if [[ -z "$latest" ]]; then
    warn "could not read the latest Archon release; skipping the Archon upgrade"
  elif [[ "$current" != *"$latest"* ]]; then
    log "Archon update available ($latest) — stopping the service (active workflow runs are interrupted)"
    need_archon=1
  fi
fi
if [[ "$need_archon" == 1 ]]; then
  systemctl stop archon.service 2>/dev/null || true
  # Root gets the binary; the provider for root may fail (no claude for root) — that's fine.
  # The default repo keeps the stock installer URL. Any other repo is installed with its own
  # scripts/install.sh at its latest release tag (a fork need not have a main branch, and the
  # tag is the script that shipped with the binary). It reads ARCHON_RELEASE_REPO (the variable
  # must prefix `bash`, not `curl`). The binary then downloads providers and plugins from the
  # same repo.
  if [[ "$ARCHON_REPO" == coleam00/Archon ]]; then
    installer_url="https://archon.diy/install"
  else
    release="$(archon_latest || true)"
    [[ -n "$release" ]] || die "no published release found for $ARCHON_REPO (is the latest release a pre-release or draft?)"
    installer_url="https://raw.githubusercontent.com/$ARCHON_REPO/v$release/scripts/install.sh"
  fi
  curl -fsSL "$installer_url" | ARCHON_RELEASE_REPO="$ARCHON_REPO" bash -s -- --providers claude \
    || warn "Archon installer returned an error — checking the binary anyway"
  command -v archon >/dev/null || die "archon not found after install (expected /usr/local/bin/archon)"
  as_agent "archon provider add claude" || warn "'archon provider add claude' failed for $AGENT_USER"
fi
ARCHON_BIN="$(command -v archon)"

# Archon discovers installed packs on every request, so installing or updating needs no restart,
# and a running workflow keeps the revision it started with.
if [[ -n "$DEVFLOW_PACK" ]]; then
  log "Archon workflow pack $DEVFLOW_PACK"
  if as_agent "archon plugin list" 2>/dev/null | awk -v id="${DEVFLOW_PACK%@*}" '$1 == id { found = 1 } END { exit !found }'; then
    if [[ "$UPGRADE" == 1 ]]; then
      as_agent "archon plugin update $DEVFLOW_PACK" || warn "could not update $DEVFLOW_PACK"
    fi
  else
    as_agent "archon plugin add $DEVFLOW_PACK" || warn "could not install $DEVFLOW_PACK"
  fi
fi

ENV_FILE="$AGENT_HOME/.archon/.env"
install -d -m 0700 -o "$AGENT_USER" -g "$AGENT_USER" "$AGENT_HOME/.archon"
if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<EOF
# Archon user-scope config (loaded by Archon itself from ~/.archon/.env)
PORT=$ARCHON_PORT
CLAUDE_BIN_PATH=$AGENT_HOME/.local/bin/claude
ARCHON_TELEMETRY_DISABLED=1

# --- Claude auth: default is the 'claude /login' session of this user.
#     Alternative (token): run 'claude setup-token' and set:
# CLAUDE_CODE_OAUTH_TOKEN=

# --- GitHub: token for cloning, API and gh (e.g. GH_TOKEN=\$(gh auth token))
# GH_TOKEN=

# --- GitHub webhook triggers (PAT mode needs both):
# GITHUB_TOKEN=
# WEBHOOK_SECRET=

# --- Slack (Socket Mode, no public endpoint). Set both, then re-run bootstrap.sh
# SLACK_BOT_TOKEN=xoxb-...
# SLACK_APP_TOKEN=xapp-...
# SLACK_ALLOWED_USER_IDS=U0123456789
# SLACK_STREAMING_MODE=batch
EOF
  chown "$AGENT_USER:$AGENT_USER" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
fi
has_env() { grep -q "^$1=.\+" "$ENV_FILE"; }

if has_env SLACK_BOT_TOKEN && has_env SLACK_APP_TOKEN; then
  if [[ ! -f "$AGENT_HOME/.archon/.slack-plugin-added" ]]; then
    log "Archon Slack plugin"
    if as_agent "archon plugin add $ARCHON_REPO/plugins/chat-slack"; then
      as_agent "touch ~/.archon/.slack-plugin-added"
    else
      warn "Slack plugin install failed — run as $AGENT_USER: archon plugin add $ARCHON_REPO/plugins/chat-slack"
    fi
  fi
  has_env SLACK_ALLOWED_USER_IDS \
    || warn "SLACK_ALLOWED_USER_IDS is empty: anyone in the Slack workspace can drive your agents"
fi

# ---------------------------------------------------------------- 7. service
log "systemd unit: archon.service"
cat > /etc/systemd/system/archon.service <<EOF
[Unit]
Description=Archon workflow engine (web UI + API)
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=$AGENT_USER
WorkingDirectory=$AGENT_HOME
Environment=PATH=$AGENT_PATH
ExecStart=$ARCHON_BIN serve
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable archon.service >/dev/null

# Start only once Claude is authenticated, otherwise it just crash-loops.
# A running, unchanged service is left alone so re-runs don't interrupt workflows.
ARCHON_STARTED=0
if [[ -f "$AGENT_HOME/.claude/.credentials.json" ]] || has_env CLAUDE_CODE_OAUTH_TOKEN; then
  ARCHON_STARTED=1
  install -d -m 0700 "$STATE_DIR"
  env_sum="$(sha256sum "$ENV_FILE" /etc/systemd/system/archon.service | sha256sum | cut -d' ' -f1)"
  if [[ "$need_archon" == 1 ]] || ! systemctl is-active --quiet archon.service \
     || [[ "$env_sum" != "$(cat "$STATE_DIR/config.sum" 2>/dev/null)" ]]; then
    systemctl restart archon.service
  fi
  echo "$env_sum" > "$STATE_DIR/config.sum"
  for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:$ARCHON_PORT/api/health" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -fsS "http://127.0.0.1:$ARCHON_PORT/api/health" >/dev/null 2>&1 \
    || warn "Archon not healthy yet — check: journalctl -u archon -n 50"
fi

# ---------------------------------------------------------------- 7b. code-server
# VS Code in the browser, to watch the agents' worktrees and their git diffs.
# Bound to loopback without a password: only Tailscale Serve reaches it, so the
# tailnet policy is its access control, as for Archon.
log "code-server (VS Code in the browser)"
code_server_version() { code-server --version 2>/dev/null | head -1; }
if [[ -z "$(code_server_version)" || "$UPGRADE" == 1 ]]; then
  curl -fsSL https://code-server.dev/install.sh | sh \
    || warn "code-server installer returned an error"
fi
CS_CONFIG="$AGENT_HOME/.config/code-server/config.yaml"
install -d -m 0700 -o "$AGENT_USER" -g "$AGENT_USER" "$AGENT_HOME/.config" "$AGENT_HOME/.config/code-server"
cat > "$CS_CONFIG" <<EOF
# Managed by bootstrap.sh — re-run the script instead of editing.
bind-addr: 127.0.0.1:$CODE_SERVER_PORT
auth: none
cert: false
EOF
chown "$AGENT_USER:$AGENT_USER" "$CS_CONFIG"
chmod 0600 "$CS_CONFIG"
CODE_SERVER_OK=0
if command -v code-server >/dev/null; then
  CODE_SERVER_OK=1
  systemctl enable "code-server@$AGENT_USER" >/dev/null
  # Restart only when the config or version changed, so re-runs keep open editor sessions.
  install -d -m 0700 "$STATE_DIR"
  cs_sum="$(sha256sum "$CS_CONFIG" | cut -d' ' -f1) $(code_server_version)"
  if ! systemctl is-active --quiet "code-server@$AGENT_USER" \
     || [[ "$cs_sum" != "$(cat "$STATE_DIR/code-server.sum" 2>/dev/null)" ]]; then
    systemctl restart "code-server@$AGENT_USER"
  fi
  echo "$cs_sum" > "$STATE_DIR/code-server.sum"
else
  warn "code-server not installed — the editor URL won't work"
fi

# ---------------------------------------------------------------- 8. firewall
# Archon binds 0.0.0.0 and web auth is off for a solo install, so the firewall
# is what keeps it private. Also add a Hetzner Cloud Firewall with the same rule.
log "Firewall (ufw)"
ufw default deny incoming  >/dev/null
ufw default allow outgoing >/dev/null
ufw allow in on tailscale0 >/dev/null
ufw allow 41641/udp        >/dev/null   # Tailscale direct connections
if [[ "$LOCK_SSH_TO_TAILSCALE" == 1 ]]; then
  ufw delete allow OpenSSH >/dev/null 2>&1 || true
else
  ufw allow OpenSSH >/dev/null
fi
ufw --force enable >/dev/null

# ---------------------------------------------------------------- 9. tailscale serve
log "Tailscale Serve (HTTPS -> Archon, :$CODE_SERVER_HTTPS_PORT -> code-server)"
TS_URL=""
CS_URL=""
if tailscale status >/dev/null 2>&1; then
  if tailscale serve --bg "$ARCHON_PORT" >/dev/null 2>&1; then
    TS_URL="https://$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
    if [[ $CODE_SERVER_OK == 1 ]]; then
      if tailscale serve --bg --https="$CODE_SERVER_HTTPS_PORT" "http://127.0.0.1:$CODE_SERVER_PORT" >/dev/null 2>&1; then
        CS_URL="$TS_URL:$CODE_SERVER_HTTPS_PORT/?folder=$AGENT_HOME/.archon/workspaces"
      else
        warn "tailscale serve for code-server (:$CODE_SERVER_HTTPS_PORT) failed"
      fi
    fi
  else
    warn "tailscale serve failed — enable MagicDNS + HTTPS certificates in the Tailscale admin console, then re-run"
  fi
fi

# ---------------------------------------------------------------- summary
log "Done"
cat <<EOF
  Claude Code : $(as_agent "claude --version" 2>/dev/null || echo '?')
  gh          : $(gh --version | head -1)
  Archon      : $(archon version 2>/dev/null | head -1 || echo '?')  (service: $( [[ $ARCHON_STARTED == 1 ]] && echo running || echo 'enabled, NOT started' ))
  Web UI      : ${TS_URL:-<run 'tailscale up' first>}
  Editor      : ${CS_URL:-<not available, see warnings above>}
  Auto-update : unattended-upgrades on, reboot $( [[ "$AUTO_REBOOT" == 1 ]] && echo "at $REBOOT_TIME if needed" || echo off )
EOF
if [[ -f /var/run/reboot-required ]]; then
  warn "a reboot is pending (kernel/libc update): sudo reboot when no workflow is running"
fi
if [[ $ARCHON_STARTED == 0 ]]; then
  cat <<EOF

Next (one-time):
  sudo -iu $AGENT_USER
  claude                                   # then /login
  gh auth login && gh auth setup-git
  echo "GH_TOKEN=\$(gh auth token)" >> ~/.archon/.env
  exit
  # then re-run this script
EOF
fi
