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
#   AGENT_USER=agent            unix user that runs Claude Code + Archon (no sudo)
#   ARCHON_PORT=3090            Archon HTTP port (Archon default)
#   TS_AUTHKEY=                 Tailscale auth key; without it run `tailscale up --ssh` yourself
#   TS_HOSTNAME=<hostname -s>   machine name in the tailnet -> https://<name>.<tailnet>.ts.net
#   TS_TAG=tag:runner           Tailscale tag for this machine (must exist in the policy's tagOwners;
#                               use the same tag on the auth key, or an untagged key)
#   GIT_NAME= GIT_EMAIL=        commit identity for the agents
#   UPGRADE=1                   0 = only install missing parts and apply config, upgrade nothing
#   AUTO_REBOOT=1               unattended-upgrades may reboot when a kernel/libc update needs it
#   REBOOT_TIME=03:00           when that reboot may happen (VM clock, UTC on Hetzner)
#   LOCK_SSH_TO_TAILSCALE=0     1 = close public port 22 (only once Tailscale SSH works)
set -euo pipefail

AGENT_USER="${AGENT_USER:-agent}"
ARCHON_PORT="${ARCHON_PORT:-3090}"
TS_AUTHKEY="${TS_AUTHKEY:-}"
TS_HOSTNAME="${TS_HOSTNAME:-$(hostname -s)}"
TS_TAG="${TS_TAG:-tag:runner}"
[[ "$TS_TAG" == tag:* ]] || TS_TAG="tag:$TS_TAG"
GIT_NAME="${GIT_NAME:-}"
GIT_EMAIL="${GIT_EMAIL:-}"
UPGRADE="${UPGRADE:-1}"
AUTO_REBOOT="${AUTO_REBOOT:-1}"
REBOOT_TIME="${REBOOT_TIME:-03:00}"
LOCK_SSH_TO_TAILSCALE="${LOCK_SSH_TO_TAILSCALE:-0}"

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
  curl ca-certificates gnupg git tmux jq unzip build-essential ufw sudo \
  unattended-upgrades needrestart

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

# ---------------------------------------------------------------- 6. archon
# The quick installer puts the binary in /usr/local/bin (needs root). Providers
# are per user and must be re-added after every Archon update.
log "Archon"
archon_latest() {
  curl -fsSL https://api.github.com/repos/coleam00/Archon/releases/latest 2>/dev/null \
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
  curl -fsSL https://archon.diy/install | bash -s -- --providers claude \
    || warn "Archon installer returned an error — checking the binary anyway"
  command -v archon >/dev/null || die "archon not found after install (expected /usr/local/bin/archon)"
  as_agent "archon provider add claude" || warn "'archon provider add claude' failed for $AGENT_USER"
fi
ARCHON_BIN="$(command -v archon)"

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
    if as_agent "archon plugin add coleam00/Archon/plugins/chat-slack"; then
      as_agent "touch ~/.archon/.slack-plugin-added"
    else
      warn "Slack plugin install failed — run as $AGENT_USER: archon plugin add coleam00/Archon/plugins/chat-slack"
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
  STATE_DIR=/var/lib/archon-bootstrap
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
log "Tailscale Serve (HTTPS -> Archon)"
TS_URL=""
if tailscale status >/dev/null 2>&1; then
  if tailscale serve --bg "$ARCHON_PORT" >/dev/null 2>&1; then
    TS_URL="https://$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
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
