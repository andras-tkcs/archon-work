# Plan: strip the admin path from devflow-config; bootstrap a sealed admin user with one GitHub baseline script

Scope: **large** (five serial phases). Slug `gh-admin-baseline`, feature branch
`feat/gh-admin-baseline`. This plan is not committed to the feature branch; it lives in the run's
artifacts and a later step publishes it.

**The inputs.** The user's three files (`gh_snapshot.py`, `gh_baseline.py`, `baseline.json`) are
**never committed** (Q8 answer B). Workers read them from the earlier run's artifacts folder on the VM:

```
INPUTS=/home/agent/.archon/workspaces/tkcs-lab/archon-work/artifacts/runs/2b901e05-f9f0-467b-97b8-1e2c6d1cbfe2/inputs
REF_NAME=$(jq -r .reference "$INPUTS/baseline.json" | cut -d/ -f1)
```

Nothing in the repo or its history may name the reference project. This plan calls it "the
reference project". Checks that need its name use `$REF_NAME` as defined above. Every brief that
uses `$INPUTS` or `$REF_NAME` sets both variables first with the two lines above.

## Goal

1. Strip the admin-token path out of the `devflow-config` workflow. That path applied GitHub repo
   settings and needed an admin token, which the `agent` user should not hold. What stays runs with
   `agent`'s own token: the read-only config review report and the file-change PR (Q11 B).
   Together, `devflow-config` (files, as `agent`) and `gh-baseline` (settings, as `ghadmin`) cover
   every gap the old workflow covered. The review also covers the project's `.archon/config.yaml`
   `extraWorkflowSources` (Q11).
2. `bootstrap.sh` creates a second, sealed system user, `ghadmin`. It holds the **admin/owner**
   GitHub identity (`gh auth`), separate from `agent`, the development/PR identity Claude uses.
   Claude, running as `agent`, cannot read that user's credentials or files.
3. The bootstrap installs the user's two attached scripts for that user, changed in two ways:
   they are merged into one script (`gh-baseline`), and the checklist and policy are not embedded
   in it. They are a separate file passed with `--policy`.

## Current state

The `path:line` references were checked against `main` at 71df193.

**The inputs** (in `$INPUTS`, not in the repo):

- `gh_snapshot.py` (426 lines) is a read-only collector.
  - `api()` and `got()` wrap `gh api` GETs and record unreadable endpoints in `GAPS`.
  - Functions: `collect_repo`, `collect_org`, `list_org_repos`, and the markdown summaries
    `md_repo`/`md_org`.
  - CLI: `repo|org|all TARGET [--out DIR]` writes `<out>/<name>.json` and `.md`. Env `GH_BIN`.
  - Top-level names: `GH`, `GAPS`, `api`, `bad`, `got`, `pick`, `REPO_KEYS`, `decode_file`,
    `analyze_workflow`, `collect_repo`, `ORG_KEYS`, `collect_org`, `list_org_repos`, `yn`, `ok`
    (line 327), `rule_types`, `md_repo`, `md_org`, `main` (line 390).
- `gh_baseline.py` (631 lines) does `import gh_snapshot as S` through a `sys.path.insert` of its
  own directory. It uses `S.bad`, `S.collect_org`, `S.collect_repo` (×2), `S.GAPS`, `S.GH` (×3)
  and `S.list_org_repos`.
  - Contents: `SEV` (line 26), the `CHECKS` table (line 27, **46 ids**, id → (default severity,
    title)), `ok` (line 81), `Finder` (`add` at line 89 reads `severity_overrides` at line 90),
    `check_org`, `check_repo`, `build_ruleset_calls`, `gather` (line 501), `run_checks`,
    `report`, `do_audit`, `do_apply`, and `main` (line 605; `--baseline` defaults to
    `baseline.json` next to the script, line 610).
  - CLI: `audit|apply TARGET [--all] [--baseline FILE] [--snapshot FILE] [--json OUT]
    [--fail-on SEV] [-v] [--yes] [--only] [--skip] [--status-checks] [--include-risky]`.
- **The two `ok()` helpers differ.** `gh_snapshot.py:327` is `return not bad(x)`, and it is used
  once, in `md_repo` (line 352). `gh_baseline.py:81` is `return x is not None and not bad(x)`,
  used 24 times. Design D18 settles this.
- `baseline.json` holds the user's policy values, derived from the reference project.
  - It has documentary keys the code does not read (`branch.required_rules`, `tag.applies_when`,
    `repo.secret_scanning*`, `repo.dependabot_*`, `repo.private_vulnerability_reporting`,
    `repo.require_files`, `actions.allowed_actions`, `actions.can_approve_pull_request_reviews`,
    `actions.workflows.*`, `actions.environments_need_branch_policy`, `org.two_factor_required`,
    per-section `source`, `_comment`, `reference`, `version`).
  - `actions.allowlist` has 21 entries.
- **Policy keys the code reads.** The separate policy file must satisfy this schema:
  - `org.{default_repository_permission[], members_can_create_public_repositories, min_owners, new_repo_security_defaults}`
  - `actions.{github_owned_allowed, verified_allowed, allowlist[], default_workflow_permissions, fork_pr_contributor_approval}`
  - `apps.accepted{slug:{permissions, repository_selection}}`
  - `tokens.{max_fine_grained_pat_lifetime_days, stale_after_days}`
  - `branch.{min_review_count, dismiss_stale_reviews_on_push, require_code_owner_review_if_codeowners_exists, strict_status_checks, bypass_actor{actor_id,actor_type,bypass_mode}}`
  - `tag.{required_rules[], pattern, bypass_actor{...}}`
  - `repo.{delete_branch_on_merge, dependabot_ecosystems_include_github_actions}`
  - optional: `severity_overrides{id:sev}` (dropped by D4) and `suppress[{check,target,reason}]`
- **Defects in the inputs.** They are fixed during the merge (D5) and need no user decision:
  - `analyze_workflow` (`gh_snapshot.py:97`) never returns a `uses` key. So in `check_repo`,
    `uses` is always empty and `has_uses` always False (`gh_baseline.py:425-426`). As a result,
    R-ACT-11 never runs and the derived allowlist ignores used actions.
  - Some hard-coded fix values ignore the policy:
    - `org-defperm` always PATCHes `"none"` (`gh_baseline.py:134`).
    - `org-token` (lines 167, 171) and `repo-token` (line 451) always send `"read"`.
  - Messages say "baseline.json", for example the O-11 manual text at line 204.

**The repo:**

- `packs/devflow/devflow-config/` holds:
  - workflow `devflow-config.yaml` (262 lines)
  - commands `review-config.md` and `edit-config.md`
  - scripts `snapshot.ts`, `validate-ops.ts`, `apply-changes.ts`, plus the thin re-exports
    `gate-build.ts`, `preflight.ts`, `prepare-branch.ts`, `setup-env.ts`, `verify.ts`
  - fixtures `apply-fails`, `clean`, `file-changes`, `no-admin`, `settings-applied`
- The nodes of `devflow-config.yaml`, in order:
  - `snapshot` (33) → `review-config` (51) → `ops` (90) → `no-admin` (120, `when` at 122) |
    `choose` (129, `when` at 131) → `apply` (140) → `apply-gate` (163)
  - then `preflight` (170: `depends_on: [review-config, apply, no-admin]`,
    `trigger_rule: none_failed_min_one_success` at 172, `when` file_count > 0 at 173) → `setup`
    → `prepare-branch` → `stop-at-branch` | `build` → `gate-build` → `tail`
  - The proposal schema has `kind: { enum: [api, file] }` at line 76, an `ops` array, and
    `required: [... kind, ops]` at line 86.
- `review-config.md` has areas 1-6 and no `.archon/config.yaml` area.
  `devflow-plan/scripts/publish-plan.ts:59-92` reads `.archon/config.yaml` `extraWorkflowSources`
  and prints the snippet to add.
- `snapshot.ts:89` sets `can_admin`. The `clean` fixture has `can_admin: true` and `file-changes`
  has `can_admin: false`.
- Places that describe devflow-config today:
  - `packs/devflow/archon-plugin.json` (entrypoint and `description`)
  - `packs/devflow/README.md:23` (table row "apply what you approve … needs an admin token"),
    `:40` (`reference` input) and `:134-141` (bullet that describes the allow-list,
    `config-changes.md` and "Without admin")
  - root `README.md:168-170` ("Daily use" devflow bullet)
- `packs/devflow/.shared/gh.ts` `api()` is used by `devflow-deps/scripts/deps-facts.ts:7` and by
  the snapshot, so it stays.
- `scripts/test-devflow-pack.sh` copies the whole pack and replays every fixture with
  `archon workflow test`. New fixtures are picked up without editing it. Deleting a fixture
  removes it from the replay.
- `bootstrap.sh` (572 lines):
  - header "Optional env" list at lines 14-30
  - env block at 40-52; `ARCHON_REPO` is validated with an inline `printf … exit 1` at 43-44,
    before `log`/`warn`/`die` are defined at 54-56
  - §4 agent user at 138-147
  - §5 starts at 149
  - `.env` template GitHub comment at 353
  - summary at 548-559
  - "Next (one-time)" footer at 561-571, printed only when `ARCHON_STARTED == 0`, with
    `gh auth login && gh auth setup-git` at 567
  - The existing convention is that an optional part warns and carries on (Tailscale login
    at 130, code-server, tailscale serve).
  - `python3` is present on Ubuntu 24.04.
  - No second user exists today.
- `scripts/test-archon-repo-switch.sh:7-10` extracts bootstrap functions with
  `sed -n "/^$fn() {\$/,/^}\$/p"` and prints `ok - …` lines. New tests copy this pattern.
- `README.md` sections:
  - file table at 15-25
  - §2 curl example at 76-80, variables table at 91-106
  - §3 logins at 130-148: `gh auth login` at 136, `.env` line at 138
  - "Daily use" at 160
  - `UPGRADE=0` re-run at 227
  - "Security notes" at 231-242
- `.archon/config.yaml` is tracked (since 9665c6e) and holds
  `extraWorkflowSources: [{ref: plans, path: plans}]`.
- Releases are annotated tags `v0.3.0`-`v0.3.4`.
- The profile has no `docs.adr_*` and no `docs.changelog`, so this plan has **no ADRs and no
  changelog line**.

## Design

Decisions D1-D14 come from the earlier run's interview (Q1-Q14). D15-D17 come from this
run's Q1-Q3. D18 and D19 are planner decisions made from the code. Every one is final.

### D1. devflow-config keeps its name and loses its admin path (Q11 B, Q13 A)

The user's answer to Q11 was: "make sure the workflow plus the script together fill all the gaps,
clears everything out; do not forget the .archon file with the extraWorkflowSources as well".

- **Removed**:
  - nodes `ops`, `no-admin`, `choose`, `apply`, `apply-gate`
  - scripts `validate-ops.ts`, `apply-changes.ts`
  - fixtures `apply-fails`, `settings-applied`, `no-admin`
  - the `kind: api` proposal type and the `ops` field in `review-config`'s output
  - the allow-list paragraph in `review-config.md`

  `preflight` then depends on `review-config` only. It has no `trigger_rule` and keeps its
  `when: "$review-config.output.file_count > 0"`.
- **Kept**:
  - `snapshot`: read-only, with `agent`'s token. Its `unknown_without_admin` handling stays,
    because the token is never admin now.
  - `review-config`
  - the file-change branch, `preflight` through `tail`
  - fixtures `clean` and `file-changes`
  - the optional `reference` input
- **New output field** `admin_settings` on `review-config`: an array of
  `{check_id: string, title: string, command: string}`, where `check_id` is `""` for UI-only items.
  It sits next to `proposals` in `properties` and in `required`.
- **Division of labour**, written into `review-config.md` and both READMEs:
  - Every **settings** gap goes into `config-review.md` under the heading
    `## Settings for the admin (gh-baseline)`. Each entry gives one of:
    - the matching `gh-baseline` check id and title, plus the exact line to run as `ghadmin`:
      `gh-baseline apply OWNER/REPO --policy ~/policy.json --only <ID>`
    - `manual in the GitHub UI`, when no check covers the gap: collaborator roles, webhooks,
      deploy keys, environment reviewers, topics, merge methods vs CONTRIBUTING, required-check
      names vs real workflow jobs.
  - Every **file** gap is a `kind: file` proposal fixed through the PR:
    - workflow files (gh-baseline R-ACT-06/07/08/09)
    - `dependabot.yml` (R-SEC-07 and missing ecosystems)
    - `CODEOWNERS` (R-FILE-02 and stale paths or owners)
    - `SECURITY.md` (R-FILE-01)
    - issue/PR templates
    - `.archon/config.yaml`

    `LICENSE` is a manual-in-the-UI note only, because R-FILE-03 is a person's choice.
- **New area 7 in `review-config.md`, "Archon config"** (`.archon/config.yaml` on the default
  branch):
  - Every `extraWorkflowSources[].ref` must exist on origin. A configured source that does not
    exist, or was never synced, fails every run in the project: risk `high`.
  - If `origin/plans` exists and no entry `{ref: plans, path: plans}` is configured, propose
    adding it (the snippet `publish-plan.ts` prints), with the note
    `after merge, run \`archon workflow sync\``.
  - It never adds a source whose ref does not exist.
- **No hand-over** (Q13 A). `devflow-config` finds file gaps itself, from the checkout and
  `agent`'s read-only snapshot.
  - It applies the same rules as gh-baseline's file checks (R-ACT-06..09, R-SEC-07,
    R-FILE-01..03). The rule titles come from the repo copy `admin/policy.example.json` `checks`,
    never from `~ghadmin`.
  - There is no `baseline_report` input and no `--files-only` output. Nothing written by
    `ghadmin` is read by `agent` or Claude.
  - `review-config.md` states: "There is no hand-over from gh-baseline: a gap may appear in both
    reports, and the PR's file fix also clears the matching gh-baseline file check on the next
    audit."
- `.shared/gh.ts` stays.

### D2. Sealed admin user `ghadmin` (Q5 C)

- The name comes from a new bootstrap env `ADMIN_USER=ghadmin`.
- The user has no password (`passwd -l`), a 0700 home, no sudo, and `agent` is not in its group.
- It has no SSH: nothing changes in `tailscale-policy.hujson`. The human reaches it only as root
  with `sudo -iu ghadmin`. Root SSH already needs the browser re-check.
- The merged script is installed **inside** the home as `~ghadmin/bin/gh-baseline`, with the
  directory and file `root:ghadmin` mode 0750. ghadmin can run it but not edit it, and every
  bootstrap run overwrites it. Ubuntu's default `~/.profile` puts `~/bin` on PATH for the login
  shell.
- The generic example policy goes to `~ghadmin/policy.example.json` (`root:ghadmin` 0640,
  overwritten each run).
- The bootstrap never creates or touches `~ghadmin/policy.json` (the user's real policy) or
  `~ghadmin/.config/gh`.
- Rejected:
  - A: script in `/usr/local/bin`, readable by agent. The user chose to hide it.
  - B: direct Tailscale SSH for ghadmin. It widens the attack surface.

### D3. One merged script

The two scripts merge into one stdlib-only Python 3 file, `admin/gh-baseline.py`, with three
subcommands:

- `snapshot` is the old `gh_snapshot.py repo|org|all`.
- `audit` and `apply` are the old `gh_baseline.py`.

There is no sibling import: collectors, checks and CLI are in one file.

### D4. One policy file holds the checklist and the values (Q3 B, Q8 B)

- The policy file is passed as a **required** `--policy FILE` to `audit` and `apply`. There is no
  default and no file next to the script. `snapshot` takes no policy.
- **New top-level `checks` object**:
  `{"<ID>": {"severity": "high|medium|low|info", "title": "...", "enabled": true}}`, covering all
  46 ids of the old `CHECKS` table, in its order.
  - The script keeps only the check *logic*, keyed by id. Titles and severities come from the
    file.
  - A check with `"enabled": false` is not run and not reported.
  - `severity_overrides` is dropped, because the severity lives in `checks`. `suppress[]` stays,
    for per-target exceptions.
- **Validation at load** raises `PolicyError`. `main()` prints `policy error: <msg>` to stderr
  and exits 2. The error messages:

  | Case | Message |
  |---|---|
  | unreadable or non-JSON file | `cannot read <path>: <reason>` |
  | `version` is not 1 | `version must be 1` |
  | an id in `checks` or `suppress[].check` that the script does not implement | `unknown check id: <ID>` |
  | an id the script implements that is missing from `checks` | `checks is missing <ID>` |
  | `severity` not one of `high`, `medium`, `low`, `info` | `bad severity for <ID>: <value>` |
  | a key the code reads (list under Current state) is missing | `missing key: <dotted.path>`, e.g. `missing key: actions.allowlist` |

  Keys the code does not read are allowed and ignored, so `source`, `_comment` and the other
  documentary keys stay.
- **Shipped example `admin/policy.example.json`**:
  - It is the user's `baseline.json`, plus the `checks` section, minus `severity_overrides`.
  - **Scrub** (Q8 B): every occurrence of the reference project's `owner/repo` becomes
    `OWNER/REPO`, in `reference`, inside the `_comment` text and in `suppress[0].target`.
  - Everything else keeps the user's values: the full 21-entry `actions.allowlist`, the
    `suppress` reason and the `source`/comment keys. `actor_id: 5` is GitHub's built-in
    repository-admin role, not org-specific, so it stays.
  - The user's real policy lives only in the sealed home.
- Every message that said "baseline.json" now says "the policy file".
- Rejected:
  - A: also scrub the allowlist and `suppress`.
  - C: commit the inputs and delete them later. They would stay in public history.

### D5. The input defects are fixed in the merge

The fixes, for the defects listed under Current state:

- `analyze_workflow` adds `"uses": sorted(set(ext))` to its result.
- `org-defperm` sends `B["org"]["default_repository_permission"][0]`.
- `org-token` and `repo-token` send `B["actions"]["default_workflow_permissions"]`, both in the
  body and in the `!=` comparison next to it. The R-ACT-03 check (`gh_baseline.py:453`) compares
  with `ab["default_workflow_permissions"]` instead of `"read"`.
- User-facing "baseline.json" becomes "the policy file".

### D6. Hash-pinned download from the same repo (Q7)

The user's answer to Q7 was: "C but the same repo so same version just a different folder".

- The bootstrap **downloads** `admin/gh-baseline.py` and `admin/policy.example.json` from the
  repo it is piped from. It refuses them unless their SHA-256 matches the hash recorded in
  `bootstrap.sh`. So what gets installed is always the version of the bootstrap you piped.
- **New env**, in the header "Optional env" list and the README variables table:
  - `BOOTSTRAP_REPO=tkcs-lab/archon-work`: "GitHub owner/repo this bootstrap comes from; the
    sealed admin user's tools are downloaded from its admin/ folder".
    - Validated like `ARCHON_REPO`.
    - Error: `ERROR: BOOTSTRAP_REPO must be owner/repo, got: <v>`.
  - `BOOTSTRAP_REF=main`: "the tag or commit in your curl URL; the downloads must match the hashes
    in this file".
    - Validated with `^[A-Za-z0-9._/-]+$`.
    - Error: `ERROR: BOOTSTRAP_REF must be a tag, branch or commit, got: <v>`.
- **Constants** after the env block:
  - `ADMIN_SCRIPT_SHA256=<64 hex>` and `ADMIN_POLICY_SHA256=<64 hex>`
  - with the comment
    `# sha256 of admin/gh-baseline.py and admin/policy.example.json at this commit; scripts/test-admin-tools.sh checks them`
- **New top-level function** `fetch_admin_file() {` … `}` with arguments
  `<path> <sha256> <dest>`. It is defined right after `die()` (`bootstrap.sh:56`), before any
  section runs, because §4b calls it long before the helpers of §6 exist.
  - It downloads with `curl -fsSL "https://raw.githubusercontent.com/$BOOTSTRAP_REPO/$BOOTSTRAP_REF/$1" -o "$tmp"`,
    where `tmp=$(mktemp)`, and compares `sha256sum "$tmp" | cut -d' ' -f1` with `$2`.
  - On a match it moves the temp file to `$3` and returns 0.
  - It never calls `die` or `exit` (D16), and every command that may fail is inside a
    conditional, so `set -euo pipefail` cannot end the script: `if ! curl …; then warn …;
    rm -f "$tmp"; return 1; fi`, and the same shape for the hash comparison. On failure it removes
    the temp file and returns 1 after one of these warnings:
    - download failed:
      `warn "admin tools not installed: could not download $1 from $BOOTSTRAP_REPO@$BOOTSTRAP_REF; pass BOOTSTRAP_REF=<the tag or commit in your curl URL>"`
    - hash mismatch:
      `warn "admin tools not installed: $1 from $BOOTSTRAP_REPO@$BOOTSTRAP_REF does not match this bootstrap (sha256 <got>, expected $2); pass BOOTSTRAP_REF=<the tag or commit in your curl URL>"`
- Rejected:
  - A: embed the files as heredocs. The user chose download.
  - B without hashes: it would install whatever is on the ref, under the admin token.

### D7. Bootstrap section 4b and the footer

Section `# ---------------------------------------------------------------- 4b. sealed admin user`
goes right after §4, before §5 at line 149. It runs these steps, in order:

1. `ADMIN_USER="${ADMIN_USER:-ghadmin}"` is set in the env block, next to `AGENT_USER`.
2. `[[ "$ADMIN_USER" != "$AGENT_USER" ]] || die "ADMIN_USER must differ from AGENT_USER"`
3. `log "Sealed admin user '$ADMIN_USER' (admin GitHub identity; not reachable from $AGENT_USER)"`
4. `id "$ADMIN_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$ADMIN_USER"`
5. `passwd -l "$ADMIN_USER" >/dev/null`
6. `ADMIN_HOME="$(getent passwd "$ADMIN_USER" | cut -d: -f6)"`, then `chmod 0700 "$ADMIN_HOME"`
7. `gpasswd -d "$AGENT_USER" "$ADMIN_USER" >/dev/null 2>&1 || true`
8. `install -d -o root -g "$ADMIN_USER" -m 0750 "$ADMIN_HOME/bin"`
9. Fetch both files to temp paths, never as a bare call (a bare non-zero return would end the
   script under `set -e`):
   ```
   t1=$(mktemp); t2=$(mktemp); admin_ok=1
   fetch_admin_file admin/gh-baseline.py "$ADMIN_SCRIPT_SHA256" "$t1" || admin_ok=0
   fetch_admin_file admin/policy.example.json "$ADMIN_POLICY_SHA256" "$t2" || admin_ok=0
   ```
10. Only if `admin_ok` is 1:
    - `install -o root -g "$ADMIN_USER" -m 0750 <tmp-script> "$ADMIN_HOME/bin/gh-baseline"`
    - `install -o root -g "$ADMIN_USER" -m 0640 <tmp-policy> "$ADMIN_HOME/policy.example.json"`

    Otherwise it leaves any installed copies unchanged and carries on (D16).
11. `rm -f "$t1" "$t2"` in either case.

The section never creates or touches `$ADMIN_HOME/policy.json` or `$ADMIN_HOME/.config/gh`.

The **footer** goes after the existing `ARCHON_STARTED` footer and is printed regardless of
`ARCHON_STARTED`:

- If `$ADMIN_HOME/bin/gh-baseline` does not exist, print the D16 line.
- Otherwise, if `$ADMIN_HOME/.config/gh/hosts.yml` does not exist, print this block from an
  unquoted heredoc, with `$ADMIN_USER` expanded:

```
Admin GitHub identity (one-time, as root):
  sudo -iu $ADMIN_USER
  # admin account (NOT the agent's): Settings > Developer settings > Tokens (classic),
  # scopes repo, admin:org, read:org, admin:repo_hook, expiry e.g. 90 days
  gh auth login --with-token               # paste the PAT, then Ctrl-D
  # rotate before it expires: new PAT, same command; then revoke the old one
  cp policy.example.json policy.json       # then edit it for your org
  gh-baseline audit YOUR_ORG --all --policy ~/policy.json
```

### D8. The merged script's CLI

`admin/gh-baseline.py`, installed as `gh-baseline`, uses argparse subparsers:

- `gh-baseline snapshot {repo,org,all} TARGET [--out DIR]` (`--out` default `snapshots`)
- `gh-baseline audit [TARGET] --policy FILE [--all] [--snapshot FILE] [--json OUT] [--fail-on {high,medium,low,info}] [-v]`
- `gh-baseline apply [TARGET] --policy FILE [--all] [--snapshot FILE] [--yes] [--only IDS] [--skip IDS] [--status-checks NAMES] [--include-risky]`

Further rules:

- `--policy` is `required=True`, so argparse exits 2 when it is missing.
- For `audit`/`apply`, the policy is loaded and validated **before** the `gh auth status` check.
  So a bad policy gives exit 2 even without `gh`.
- `TARGET` stays `nargs="?"`, as before. Without it and without `--snapshot`, the error is
  `target required`.
- Exit codes are unchanged: `audit` exits 1 on non-accepted findings at or above `--fail-on`
  (default `high`), and 2 on a bad policy.
- Env `GH_BIN` is kept.
- The module docstring is rewritten to cover the three subcommands, the policy file and the D14
  token scopes and rotation. It does not mention the reference project.

### D9. Tests

- stdlib `unittest` in `admin/tests/test_gh_baseline.py`. It loads the script with
  `importlib.util.spec_from_file_location("gh_baseline", <repo>/admin/gh-baseline.py)`, because
  the file name has a dash.
- No network:
  - audits run from the fixture snapshot `admin/tests/fixtures/snapshot-repo.json`
  - the CLI tests run the script as a subprocess with `GH_BIN` set to
    `admin/tests/fixtures/fake-gh`, which is `#!/bin/sh` + `exit 1`, mode 755
- `admin/tests/__init__.py` is empty, so `discover -t .` works.
- `scripts/test-admin-tools.sh` (mode 755, `set -euo pipefail`, header comment like
  `scripts/test-archon-repo-switch.sh`, `export PYTHONDONTWRITEBYTECODE=1` so no `__pycache__`
  is written into the tree):
  - runs `python3 -m unittest discover -s admin/tests -t .` from the repo root, then prints
    `ok - admin unit tests`
  - from p4 on, also checks the two hashes and tests `fetch_admin_file`
- `.claude/toolkit.yaml` `verify.fast` gains `bash -n scripts/test-admin-tools.sh` and
  `scripts/test-admin-tools.sh`.

### D10. Root README

- **File table**: new rows after `scripts/test-archon-repo-switch.sh`:
  - `admin/`: "The sealed admin user's GitHub baseline tool (`gh-baseline`) and the example
    policy; the bootstrap downloads them, hash-checked."
  - `scripts/test-admin-tools.sh`: "Tests the admin tool and checks that the hashes in
    `bootstrap.sh` match `admin/`."
  - `.github/CODEOWNERS`: "Code owners: the admin account reviews admin code, the bootstrap and
    CI workflows."
- **§2 variables table**: rows after `AGENT_USER`:
  - `ADMIN_USER`, default `ghadmin`: "Sealed user that holds the admin/owner GitHub login; no
    password, no SSH, no sudo; `agent` cannot read it."
  - `BOOTSTRAP_REPO`: the D6 text.
  - `BOOTSTRAP_REF`: the D6 text plus D16's "; if it does not match, the admin tools are skipped
    with a warning".
- **§2 curl example**: add `BOOTSTRAP_REF=<tag>` (the same `<tag>` as in the URL) to the env
  list.
- **§3**: new subsection `### Admin GitHub identity` after the agent login block. It holds:
  - the D7 commands, as a code block with `ghadmin`
  - "`policy.json` stays on the VM, in `~ghadmin`; only the generic `policy.example.json` is in
    this repo."
  - "Run `gh-baseline audit` / `apply` by hand; nothing runs it on a schedule."
  - "`devflow-config` lists settings gaps with the `gh-baseline apply … --only <ID>` line to run
    here."
- **"Security notes"** gains two bullets:
  - "The owner/admin GitHub login lives only in `~ghadmin` (mode 700, no password, no SSH, no
    sudo); reach it as root with `sudo -iu ghadmin`. `agent` cannot read it. Never put the
    admin token in `~agent/.archon/.env`."
  - "Changes to `admin/`, `bootstrap.sh`, `.github/CODEOWNERS` and `.github/workflows/` need
    review from the admin account (CODEOWNERS plus the `main` ruleset)."
- **"Daily use" devflow bullet** gains: "`-config` reviews settings and fixes files by PR;
  settings changes are for the admin user's `gh-baseline` (see §3 Admin GitHub identity)."

### D11. gh-baseline is deterministic (Q8)

- `gh-baseline` runs a policy check (`audit`) and `apply`, run by the human as `ghadmin`.
- No Claude and no Archon workflow invokes it or holds its token. `devflow-config` (D1) only
  names its check ids and prints the command for the human.

### D12. Manual only (Q9 A)

- The bootstrap installs no systemd timer, cron entry or service, and no env setting for a
  scheduled audit.
- Rejected:
  - B: a scheduled read-only audit.
  - C: an unattended scheduled `apply --yes`.

### D13. CODEOWNERS (Q10 B)

New file `.github/CODEOWNERS` (the repo has no `.github/` today), exactly:

```
# Code that runs as the sealed admin user, and this file itself, need the admin account's review.
/admin/              @andras-tkcs
/bootstrap.sh        @andras-tkcs
/.github/CODEOWNERS  @andras-tkcs
# CI workflows run with the repo's Actions secrets; agent may write them (D15), the admin reviews.
/.github/workflows/  @andras-tkcs
```

- The file owns itself, so a PR from `agent` cannot remove the rule.
- Turning on "Require review from Code Owners" in the `main` ruleset (id 26458212) is
  `manual_after` step ma0, done by the admin account. `agent` never changes rulesets.
- `BOOTSTRAP_REF` is not forced to a tag; option C was not chosen.

### D14. The admin credential is a classic PAT with an expiry (Q14 B)

- It is created on the admin account, with scopes `repo`, `admin:org`, `read:org` and
  `admin:repo_hook`. These are what complete org checks and `apply` need. The expiry is the
  human's choice (example: 90 days).
- `gh auth login --with-token` stores it in `~ghadmin/.config/gh/hosts.yml` (plain text,
  protected by the 0700 home).
- The footer (D7), README §3 (D10) and the script's docstring (D8) state the scopes, the command
  and the rotation: create a new PAT, run the same command, revoke the old one.
- The bootstrap never asks for, reads or writes the token.
- No scope pre-check in code: missing scopes surface as `GAPS` entries.
- Rejected:
  - A: OAuth login. It never expires.
  - C: a read-only fine-grained token plus a throwaway write token for each apply.

### D15. `workflow` scope for agent, guarded by CODEOWNERS (this run's Q1, answer C)

`agent`'s GitHub token gets the `workflow` scope, so `devflow-config` can push its `kind: file`
fixes to `.github/workflows/*` in the PR.

- **README §3 agent login block** becomes:
  ```
  gh auth login --scopes workflow   # GitHub.com → HTTPS → login with browser/device code
  gh auth setup-git
  echo "GH_TOKEN=$(gh auth token)" >> ~/.archon/.env
  ```
  with this line under the code block: "`workflow` lets Claude change `.github/workflows/` in a
  PR (CI files need it). Already logged in without it: `gh auth refresh -s workflow`, then
  replace the `GH_TOKEN=` line in `~/.archon/.env` with the new `gh auth token`."
- **`bootstrap.sh`**:
  - footer line 567 becomes `  gh auth login --scopes workflow && gh auth setup-git`
  - `.env` template comment (line 353) becomes
    `# --- GitHub: token for cloning, API and gh, scopes incl. workflow (e.g. GH_TOKEN=\$(gh auth token))`
- **`review-config.md`**: every proposal that edits `.github/workflows/` notes in
  `config-review.md`: "needs the `workflow` scope on the agent's token
  (`gh auth refresh -s workflow`)". No code pre-checks the scope.
- On the existing VM, the scope is added in manual step ma3b.
- Rejected:
  - A: the scope without CODEOWNERS review.
  - B: no scope, and workflow gaps become manual.

### D16. A failed admin-tool download warns and skips only the admin tools (this run's Q2, answer B)

- The rest of the bootstrap runs as usual. The `ghadmin` user, its home and `bin/` are still
  created.
- Already-installed copies are kept. Nothing unverified is installed, and temp files are deleted.
- When `$ADMIN_HOME/bin/gh-baseline` does not exist, the summary prints this in place of the D7
  block:
  `Admin tools not installed (see the WARN above): re-run with BOOTSTRAP_REF=<the tag or commit in your curl URL>`
- The README re-run commands (`README.md:227`) stay unchanged.
- Rejected:
  - A: a hard stop at 4b.
  - C: stop only on the first install.

### D17. Release `v0.4.0` and rollout to the existing VM (this run's Q3, answer A)

- After the PR merges, the annotated tag **`v0.4.0`** goes on the merge commit. It is a minor
  release: the apply path is removed and a user is added.
- The tag is pushed, and the existing VM re-runs the bootstrap from it with
  `BOOTSTRAP_REF=v0.4.0 UPGRADE=0`. The ma2 and ma3 checks are then repeated there.
- This is `manual_after` step ma5. No repo file names a version, so no phase changes anything
  for it.
- Rejected:
  - B: tag only.
  - C: no tag and no rollout.

### D18. The two `ok()` helpers (planner, from the code)

The inputs' `ok()` helpers differ (see Current state), so a plain merge would change
behaviour.

- The merged script keeps `gh_baseline.py`'s definition as `ok()`, which its 24 call sites use.
- `gh_snapshot.py`'s definition is renamed `not_bad(x)` (`return not bad(x)`), and its only call
  site in `md_repo` uses `not_bad(v)`.
- This keeps both behaviours byte-for-byte.
- Rejected: one shared definition. It would change either the markdown summary or 24 checks
  for `None` values.

### D19. The plan is not committed (run override)

- The retirement phase (p5) deletes no plan document.
- It does the reference-docs work: the root README (D10, D15's README part) and the final
  repo-wide checks.
- `README.md` is touched only by p5. So p4 stays within M, and the hashes p4 computes cannot be
  invalidated by p5, which must not touch `admin/`.

## Manual steps

- **Before implementation:** none.
  - Every phase works from the repo and the inputs folder on the VM.
  - The admin PAT and the agent's `workflow` scope are needed only for the after-steps.
- **After implementation, before the PR merges**, in this order:
  - ma0: turn on code-owner review in the `main` ruleset.
  - ma1: bootstrap a test VM from the feature branch.
  - ma2: isolation check.
  - ma3: admin PAT login and a real audit.
  - ma3b: add the `workflow` scope to agent's token on the existing VM.
  - ma4: a real devflow-config run.
- **After the merge:**
  - ma5: tag `v0.4.0`, roll it out to the existing VM, repeat ma2/ma3 there.

The step-by-step instructions with direct links, for the PR, are in `after.md` next to this plan
(written together with it). Summary:

1. **ma0 (admin account).** Open https://github.com/tkcs-lab/archon-work/settings/rules/26458212
   and enable **Require review from Code Owners** under "Require a pull request before merging".
   Save, then check `gh api repos/tkcs-lab/archon-work/codeowners/errors --jq '.errors | length'`
   prints `0`.
2. **ma1 (root on a test VM).**
   `curl -fsSL https://raw.githubusercontent.com/tkcs-lab/archon-work/feat/gh-admin-baseline/bootstrap.sh | sudo BOOTSTRAP_REF=feat/gh-admin-baseline DEVFLOW_PACK=tkcs-lab/archon-work/packs/devflow@feat/gh-admin-baseline UPGRADE=0 bash`.
   The output has the 4b log line, no `WARN: admin tools not installed`, and the "Admin GitHub
   identity" block.
3. **ma2 (same VM).** As `agent`, `ls ~ghadmin` and `cat ~ghadmin/bin/gh-baseline` both fail with
   `Permission denied`. As root, `sudo -iu ghadmin` works and `which gh-baseline` prints
   `/home/ghadmin/bin/gh-baseline`.
4. **ma3 (same VM).** Create the classic PAT at https://github.com/settings/tokens/new on the
   admin account (scopes `repo`, `admin:org`, `read:org`, `admin:repo_hook`, 90-day expiry). The
   token goes only into `gh auth login --with-token` as `ghadmin`; it is never written anywhere
   else. Then `cp policy.example.json policy.json`, edit it, and run
   `gh-baseline audit tkcs-lab --all --policy ~/policy.json`. It prints findings and exits 0 or 1.
5. **ma3b (agent on the existing VM).** `gh auth refresh -s workflow`, replace the `GH_TOKEN=`
   line in `~/.archon/.env` with the new `gh auth token`, then `sudo systemctl restart archon` as
   root. `gh auth status` lists `workflow`.
6. **ma4 (test VM, agent).** Run `archon workflow sync` in the project, then
   `tkcs-lab/devflow:devflow-config` on one project. `config-review.md` has
   `## Settings for the admin (gh-baseline)` with `gh-baseline apply … --only <ID>` lines. File
   gaps, including `.archon/config.yaml` `extraWorkflowSources`, arrive as a PR.
7. **ma5 (after the merge).**
   `git tag -a v0.4.0 -m "v0.4.0" <merge commit> && git push origin v0.4.0`. Then, as root on
   the existing VM:
   `curl -fsSL https://raw.githubusercontent.com/tkcs-lab/archon-work/v0.4.0/bootstrap.sh | sudo BOOTSTRAP_REF=v0.4.0 UPGRADE=0 bash`.
   The summary has no "Admin tools not installed" line. Repeat ma2 and ma3 there.

## Risks and open questions

**For workers**, each a `status=blocked` stop:

- **p2-merge-script:**
  - The inputs folder is missing.
  - A name that `gh_baseline.py` takes from `S.` is not defined in `gh_snapshot.py`.
  - A top-level name collides other than `ok` and `main`. Known collisions: only `ok` (D18) and
    `main` (replaced).
- **p3-policy-file:** the `CHECKS` table does not have 46 ids, or `actions.allowlist` does not
  have 21 entries. Then the inputs are not the ones this plan was written against.
- **p1-slim-devflow-config:**
  - `scripts/test-devflow-pack.sh` fails on a fixture this plan did not touch.
  - `archon workflow test` rejects a devflow-config fixture. A leftover stub for a deleted node
    must be removed; any other rejection means the brief is wrong.
- **p4-bootstrap-admin-user:**
  - The VM's `useradd` does not create a per-user group (`USERGROUPS_ENAB no`). Then the
    `install -g "$ADMIN_USER"` calls fail.
  - `bash -n bootstrap.sh` fails for a reason outside the change.
- **The hashes in `bootstrap.sh` must be computed after the last change to `admin/`.**
  - p4 depends on p3-policy-file (the last phase that changes `admin/`) for that, and p5 must
    not touch `admin/`.
  - Any later fix to `admin/` (including review-round fixes) must recompute both constants.
    `scripts/test-admin-tools.sh` fails until it does.

**Assumptions and defaults the planner took** (no question left; recorded here):

- The code owner login is `andras-tkcs` (D13); the user named no other.
- ma1 assumes a disposable test VM exists.
  - `DEVFLOW_PACK=…@feat/gh-admin-baseline` assumes `archon plugin add` accepts a branch after
    `@`. If it refuses, install the pack from the branch by hand on the test VM before ma4; the
    rest of ma1 is unaffected.
- `max_parallel: 1`. The phases form one chain, p2 → p3 → p1 → p4 → p5, ordered by data
  dependencies:
  - p3-policy-file needs p2's merged script.
  - p1-slim-devflow-config names the check ids p3 writes into `admin/policy.example.json`.
  - p4 hashes the final `admin/`.
  - p5 documents what p4 built.

**Why no more questions** (from the interview):

- **Scope**: D1-D17, five serial phases. `devflow-config` keeps its name and loses its admin
  settings-apply path. CI-workflow fixes go through its PR (D15).
- **Behaviour**:
  - gh-baseline keeps the inputs' flags and exit codes, `--policy` is required, and it is
    deterministic and manual (D8, D11, D12).
  - The two tools exchange no data (Q13 A).
  - A failed admin-tool download warns and skips only the admin tools (D16).
- **Names and strings**: all written out in D1, D4, D6, D7, D10, D13-D16. The release tag is
  `v0.4.0` (D17).
- **Data and schema**:
  - The policy file follows D4.
  - The review-config schema keeps `kind: [file]`, drops `ops` and adds `admin_settings`
    (`devflow-config.yaml:76,86`).
  - Only the reference `owner/repo` is scrubbed (Q8 B).
- **Security**:
  - The admin token lives only in the sealed `~ghadmin` (D2, D14). Nothing flows from `ghadmin`
    to `agent`.
  - Downloads are hash-pinned (D6, D16).
  - The inputs never enter history.
  - CODEOWNERS covers the admin code and workflows, plus the ruleset toggle ma0 (D13, D15).
  - The rollout re-checks isolation on the existing VM (D17).
- **Prerequisites/credentials**:
  - There is no `manual_before`.
  - The admin PAT (ma3, ma5) and agent's `workflow` scope (ma3b) are human steps after the code
    is done.
- **After-merge steps**: ma0-ma4 and ma3b before the merge, ma5 after it. `verify_after_merge`
  runs `scripts/test-admin-tools.sh`.

## Implementation manifest

```yaml
plan_slug: gh-admin-baseline
feature_branch: feat/gh-admin-baseline
max_parallel: 1
manual_before: []
manual_after:
  - id: ma0-require-code-owner-review
    title: As the admin account, turn on "Require review from Code Owners" in the main ruleset (https://github.com/tkcs-lab/archon-work/settings/rules/26458212) and check `gh api repos/tkcs-lab/archon-work/codeowners/errors --jq '.errors | length'` prints 0
    why: CODEOWNERS (D13) only blocks merges once the ruleset enforces it, and agent must not change rulesets
  - id: ma1-vm-bootstrap-from-branch
    title: On a test VM as root, pipe bootstrap.sh from feat/gh-admin-baseline with BOOTSTRAP_REF=feat/gh-admin-baseline DEVFLOW_PACK=tkcs-lab/archon-work/packs/devflow@feat/gh-admin-baseline UPGRADE=0; no "admin tools not installed" warning, the "Admin GitHub identity" block is printed
    why: the download, hash check, user creation and file modes only run on a real root VM; CI cannot
  - id: ma2-sealed-user-isolation
    title: On that VM, as agent `ls ~ghadmin` and `cat ~ghadmin/bin/gh-baseline` fail with Permission denied; as root `sudo -iu ghadmin` works and `which gh-baseline` prints /home/ghadmin/bin/gh-baseline
    why: proves the admin identity is not reachable from the Claude user
  - id: ma3-admin-audit
    title: As ghadmin, `gh auth login --with-token` with a classic PAT of the admin account (scopes repo, admin:org, read:org, admin:repo_hook; expiry; D14), copy and edit policy.json, run `gh-baseline audit tkcs-lab --all --policy ~/policy.json`
    why: exercises the merged script against the real org with the admin token
  - id: ma3b-agent-workflow-scope
    title: As agent on the existing VM, `gh auth refresh -s workflow`, replace the GH_TOKEN= line in ~/.archon/.env with `gh auth token`, restart Archon, check `gh auth status` lists workflow
    why: devflow-config pushes .github/workflows/ fixes in its PR and GitHub refuses those without the workflow scope (D15)
  - id: ma4-devflow-config-run
    title: On the test VM, after `archon workflow sync`, run devflow-config on one project as agent; config-review.md lists settings gaps as `gh-baseline apply … --only <ID>` lines and file gaps (incl. .archon/config.yaml extraWorkflowSources) arrive as a PR
    why: the slimmed workflow's split with gh-baseline (D1, Q13 A no hand-over) is only provable against a real repo
  - id: ma5-release-v0.4.0-and-rollout
    title: After the merge, `git tag -a v0.4.0 -m "v0.4.0" <merge commit> && git push origin v0.4.0`; on the existing VM as root pipe bootstrap.sh from v0.4.0 with BOOTSTRAP_REF=v0.4.0 UPGRADE=0, check the summary has no "Admin tools not installed" line, then repeat ma2 and ma3 there
    why: the README bootstraps only from a tag, and the existing VM otherwise loses devflow-config's settings path without getting gh-baseline in its place (D17)
verify_after_merge:
  - scripts/test-admin-tools.sh
final_checks:
  - 'INPUTS=/home/agent/.archon/workspaces/tkcs-lab/archon-work/artifacts/runs/2b901e05-f9f0-467b-97b8-1e2c6d1cbfe2/inputs; REF_NAME=$(jq -r .reference "$INPUTS/baseline.json" | cut -d/ -f1); git log -p origin/main..HEAD | grep -ciF "$REF_NAME" prints 0 (the inputs never entered history)'
  - git log --name-only --format= origin/main..HEAD | grep -E '(^|/)(gh_snapshot|gh_baseline)\.py$|(^|/)baseline\.json$' prints nothing
  - grep -rnE 'validate-ops|apply-changes|needs an admin token|config-changes\.md' packs/devflow prints nothing
  - every gh-baseline check id named in packs/devflow/devflow-config/commands/review-config.md exists in admin/policy.example.json checks
  - scripts/test-admin-tools.sh and scripts/test-devflow-pack.sh pass
phases:
  - id: p2-merge-script
    title: Merge gh_snapshot.py and gh_baseline.py into admin/gh-baseline.py with subcommands
    depends_on: []
    complexity: M
    touches:
      - admin/gh-baseline.py
      - admin/tests/**
      - scripts/test-admin-tools.sh
    brief: |
      Design D3, D5, D8, D9 and D18 are the spec. The inputs are NOT in the repo; read them from
      INPUTS=/home/agent/.archon/workspaces/tkcs-lab/archon-work/artifacts/runs/2b901e05-f9f0-467b-97b8-1e2c6d1cbfe2/inputs
      and never copy them into the tree. The bulk is a verbatim move; real edits stay under ~120 lines.
      0. Check: `$INPUTS/gh_snapshot.py`, `gh_baseline.py`, `baseline.json` exist; else stop with status=blocked.
      1. Create `admin/gh-baseline.py` (`#!/usr/bin/env python3`, `chmod 755`): one import block
         (union of both files' imports), then the body of `gh_snapshot.py` without its docstring,
         its `main()` and its `if __name__ == "__main__":` block, then the body of `gh_baseline.py` without its docstring, `main()`,
         `sys.path.insert(...)`, `import gh_snapshot as S` and any `bad = S.bad` line, with every
         `S.` prefix removed (`S.bad`, `S.collect_org`, `S.collect_repo`, `S.GAPS`, `S.GH`,
         `S.list_org_repos`).
      2. D18: rename gh_snapshot's `def ok(x): return not bad(x)` to `def not_bad(x)` and change
         its single call in `md_repo` (`if ok(v)`) to `if not_bad(v)`. Keep gh_baseline's `ok()`
         unchanged. Then `python3 -c "import ast,sys; t=ast.parse(open('admin/gh-baseline.py').read()); n=[x.name for x in t.body if isinstance(x,(ast.FunctionDef,ast.ClassDef))]; d={x for x in n if n.count(x)>1}; sys.exit(str(d) if d else 0)"`
         must exit 0. If any other duplicate name appears, stop with status=blocked.
      3. One `main()` per D8 with `argparse` subparsers `snapshot`, `audit`, `apply` (dest `mode`):
         - `snapshot`: positional `kind` choices repo/org/all, `target`, `--out` default
           `snapshots`; body = the old gh_snapshot `main()` body after `parse_args` (use
           `a.kind` where it used `a.mode`).
         - `audit` and `apply`: the old gh_baseline arguments exactly, except `--baseline` is
           replaced by `--policy` (`required=True`, help "policy file: checks and values, see
           policy.example.json"). `--json`, `--fail-on`, `-v` on audit; `--yes`, `--only`,
           `--skip`, `--status-checks`, `--include-risky` on apply; `--all`, `--snapshot` on both
           (`--snapshot` help: "use a `gh-baseline snapshot` JSON file instead of live data").
         - Order for audit/apply: `target required` check, then
           `B = json.load(open(a.policy))`, then the `gh auth status` check (skipped with
           `--snapshot`, as before), then `do_audit`/`do_apply`.
      4. D5 fixes: `analyze_workflow` result gets `"uses": sorted(set(ext))`; the `org-defperm`
         call body uses `B["org"]["default_repository_permission"][0]`; both `org-token` calls
         and the `repo-token` call use `B["actions"]["default_workflow_permissions"]` (as the
         body value and in the `!= "read"` risky comparison); the R-ACT-03 check (old line 453)
         compares `tok.get("default_workflow_permissions") == ab["default_workflow_permissions"]`
         and uses that value as its expected text; every user-facing "baseline.json"
         string says "the policy file". Do not restructure any other check logic.
      5. Module docstring per D8 and D14 (subcommands with their usage lines from D8, the policy
         file, token scopes `repo, admin:org, read:org, admin:repo_hook`, rotation). It must not
         contain the reference project's name.
      6. Tests (D9): empty `admin/tests/__init__.py`; `admin/tests/fixtures/fake-gh` (`#!/bin/sh`,
         `exit 1`, mode 755); `admin/tests/fixtures/snapshot-repo.json`, built mechanically: start from
         `{"target": "OWNER/REPO", "gaps": [], "repos": {"OWNER/REPO": {"settings": {"full_name": "OWNER/REPO", "visibility": "public", "default_branch": "main", "archived": false}, "protected_branches": {}, "rulesets": [], "actions": {"workflows": []}, "code_security": {}, "files_present": {}}}}`
         (no workflows, so no `analysis` dict is needed; `files_present` empty, so R-FILE-01
         fails). The example policy does not exist until p3, so complete the fixture in a
         throwaway `python3` session (never in a committed test): load the merged module, call
         `run_checks(snap, json.load(open("$INPUTS/baseline.json")))`; each time it raises `KeyError: 'k'`, add `k` to the dict it was read
         from with `{}` (or `[]` if the code iterates it, `false` if it is compared to a bool), and
         repeat until it returns. Commit only the resulting JSON. `admin/tests/test_gh_baseline.py` (unittest, loads the
         module via `importlib.util.spec_from_file_location`, runs the CLI via
         `subprocess.run([sys.executable, "admin/gh-baseline.py", ...], env={..., "GH_BIN": <fake-gh>})`)
         with tests: `test_help_lists_subcommands` (`--help` output contains snapshot, audit,
         apply); `test_audit_without_policy_exits_2`;
         `test_analyze_workflow_returns_uses` (text with `uses: actions/checkout@v4` gives
         `["actions/checkout@v4"]` as `uses`); `test_not_bad_and_ok_differ`
         (`not_bad(None)` is True, `ok(None)` is False).
      7. `scripts/test-admin-tools.sh` (mode 755, `#!/usr/bin/env bash`, header comment
         "Tests admin/gh-baseline.py (no network, no gh login). From p4 on also checks the hashes
         in bootstrap.sh.", `set -euo pipefail`, `export PYTHONDONTWRITEBYTECODE=1`, `repo_root`
         as in scripts/test-archon-repo-switch.sh):
         `cd "$repo_root" && python3 -m unittest discover -s admin/tests -t . ` then
         `echo "ok - admin unit tests"`.
    acceptance:
      - scripts/test-admin-tools.sh exits 0 and prints "ok - admin unit tests"
      - grep -cE 'import gh_snapshot|\bS\.' admin/gh-baseline.py prints 0
      - python3 admin/gh-baseline.py --help prints snapshot, audit and apply
      - python3 admin/gh-baseline.py audit OWNER/REPO; echo $? prints 2
      - grep -c 'def not_bad' admin/gh-baseline.py prints 1
      - INPUTS=/home/agent/.archon/workspaces/tkcs-lab/archon-work/artifacts/runs/2b901e05-f9f0-467b-97b8-1e2c6d1cbfe2/inputs; grep -rniF "$(jq -r .reference $INPUTS/baseline.json | cut -d/ -f1)" admin/ scripts/ prints nothing
      - git status --porcelain --untracked-files=all | grep -E '(^|/)(gh_snapshot|gh_baseline)\.py$|(^|/)baseline\.json$|__pycache__' prints nothing
  - id: p3-policy-file
    title: Move the checklist into the policy file, validate it, ship policy.example.json
    depends_on: [p2-merge-script]
    complexity: M
    touches:
      - admin/gh-baseline.py
      - admin/policy.example.json
      - admin/tests/**
    brief: |
      Design D4 is the spec. INPUTS=/home/agent/.archon/workspaces/tkcs-lab/archon-work/artifacts/runs/2b901e05-f9f0-467b-97b8-1e2c6d1cbfe2/inputs
      0. Check first: the `CHECKS` dict in `admin/gh-baseline.py` has 46 ids and
         `jq '.actions.allowlist | length' $INPUTS/baseline.json` prints 21; otherwise stop with
         status=blocked (the inputs are not the ones this plan was written for).
      1. Create `admin/policy.example.json` from `$INPUTS/baseline.json` with a short Python
         script run from the shell (not committed): load it; set `reference` to "OWNER/REPO";
         in `_comment` replace the reference `owner/repo` string (the old `reference` value) with
         "OWNER/REPO"; set `suppress[0].target` to "OWNER/REPO"; delete `severity_overrides`;
         add `checks` = for each id in the old `CHECKS` table, in order,
         `{"severity": <CHECKS[id][0]>, "title": <CHECKS[id][1]>, "enabled": true}` (import the
         table from the merged module via importlib before step 2 removes it). Write with
         `json.dump(..., indent=2, ensure_ascii=False)` plus a trailing newline. Then confirm
         `grep -ciF "$(jq -r .reference $INPUTS/baseline.json)" admin/policy.example.json` is 0
         and that the owner part alone does not appear either; if it does anywhere else, replace
         an `owner/repo` occurrence with `OWNER/REPO` and a bare owner with `OWNER`.
      2. `admin/gh-baseline.py`: replace the `CHECKS` dict with `CHECK_IDS = (...)` (the 46 ids in
         the same order). `Finder.add`: `c = self.B["checks"][cid]`; `if not c.get("enabled", True): return`;
         severity = `c["severity"]`, title = `c["title"]`. Remove all `severity_overrides` reads.
         `CHECKS` is used only in its definition and in `Finder.add` (old lines 27, 90-91); after
         this step `grep -n 'CHECKS\b' admin/gh-baseline.py` shows only `CHECK_IDS`.
      3. Add `class PolicyError(Exception)` and `load_policy(path) -> dict` with exactly the D4
         validation table messages; `READ_KEYS` = the dotted paths of "Policy keys the code
         reads" in Current state (all except `severity_overrides` and `suppress`, which are
         optional; `apps.accepted` must exist as an object, its entries are not validated).
         Validation order: read/parse, version, unknown ids in checks, unknown ids in
         suppress[].check, missing ids, severities, READ_KEYS. In `main()`, for audit/apply,
         replace `json.load(open(a.policy))` with `load_policy(a.policy)` inside
         `try/except PolicyError as e: print(f"policy error: {e}", file=sys.stderr); sys.exit(2)`.
      4. Tests, extend `admin/tests/test_gh_baseline.py`: `test_example_policy_loads`; one test per
         error row of D4 (write a modified copy of the example to a temp dir, run
         `audit --snapshot admin/tests/fixtures/snapshot-repo.json --policy <tmp>`, assert exit 2
         and the message on stderr); `test_disabled_check_not_reported` (set
         `checks["R-FILE-01"].enabled` to false, which the fixture fails, run with `--json OUT`,
         `R-FILE-01` is absent from OUT); `test_severity_from_policy` (set
         `checks["R-FILE-01"].severity` to "info", it appears in OUT with "info"); `test_audit_fixture_runs`
         (example policy + fixture snapshot exits 0 or 1).
    acceptance:
      - scripts/test-admin-tools.sh exits 0
      - grep -c 'severity_overrides' admin/gh-baseline.py admin/policy.example.json prints 0 for both
      - grep -c '^CHECKS = ' admin/gh-baseline.py prints 0
      - jq '.actions.allowlist | length' admin/policy.example.json prints 21
      - jq '.checks | length' admin/policy.example.json prints 46
      - jq -r '.reference' admin/policy.example.json prints OWNER/REPO
      - INPUTS=/home/agent/.archon/workspaces/tkcs-lab/archon-work/artifacts/runs/2b901e05-f9f0-467b-97b8-1e2c6d1cbfe2/inputs; grep -rniF "$(jq -r .reference $INPUTS/baseline.json | cut -d/ -f1)" admin/ prints nothing
      - python3 admin/gh-baseline.py audit --snapshot admin/tests/fixtures/snapshot-repo.json --policy admin/policy.example.json; echo $? prints 0 or 1
  - id: p1-slim-devflow-config
    title: Strip the admin settings-apply path from devflow-config; add the Archon-config area
    depends_on: [p3-policy-file]
    complexity: M
    touches:
      - packs/devflow/devflow-config/**
      - packs/devflow/archon-plugin.json
      - packs/devflow/README.md
    brief: |
      Design D1 and D15 (review-config note) are the spec.
      1. `git rm packs/devflow/devflow-config/scripts/validate-ops.ts
         packs/devflow/devflow-config/scripts/apply-changes.ts
         packs/devflow/devflow-config/fixtures/apply-fails.stubs.yaml
         packs/devflow/devflow-config/fixtures/settings-applied.stubs.yaml
         packs/devflow/devflow-config/fixtures/no-admin.stubs.yaml`.
      2. `devflow-config.yaml`: delete nodes `ops` (from its section comment at ~line 89),
         `no-admin`, `choose`, `apply`, `apply-gate`. `preflight`: `depends_on: [review-config]`,
         delete its `trigger_rule` line, keep its `when`; replace the comment above it (line 169,
         "After the settings branch has finished or been skipped…") with
         "# Runs when the review proposed file changes.". In `review-config`'s output schema:
         `kind: { type: string, enum: [file] }` (line 76); delete the `ops` property and `ops`
         from the proposal's `required` (line 86); add top-level property
         `admin_settings: { type: array, items: { type: object, properties: { check_id: { type: string }, title: { type: string }, command: { type: string } }, required: [check_id, title, command] } }`
         and add `admin_settings` to the top-level `required`. Rewrite the workflow `description`:
         review is read-only with the agent's token; settings gaps go to `config-review.md` for
         the admin's `gh-baseline`; file gaps go through a PR. Keep the `area` enum unchanged.
      3. `commands/review-config.md`: replace the whole **Proposals** paragraph (lines 57-69,
         from "**Proposals** (the `proposals` field)" to "enough to restore it.") with:
         "**Proposals** (the `proposals` field). `id` is `c1`, `c2`, ... Every proposal is
         `kind: file`: a change to a file in the repository (`area` `workflow-file` or
         `community-files`, or `other` for `.archon/config.yaml`), made on a branch and reviewed in
         a pull request. Settings gaps are never proposals: they go to `admin_settings` and the
         section below. `risk` is what happens if the change is wrong (a too-strict required check
         blocks all merges: `high`); `reversible` is whether the `before` state is enough to
         restore it." In the return paragraph (lines 76-79): `clean` is true only when there are
         no proposals, `admin_settings` is empty and nothing is in the manual steps; add
         `admin_settings` to the listed return fields. Then add: (a) the D1 division of labour text with the `## Settings for the admin (gh-baseline)`
         section format and the exact command `gh-baseline apply OWNER/REPO --policy ~/policy.json --only <ID>`
         (OWNER/REPO = the reviewed repo), "manual in the GitHub UI" for the listed UI-only items,
         and that each entry also goes into the `admin_settings` output; (b) a table of all 46
         gh-baseline check ids and titles, generated with
         `jq -r '.checks | to_entries[] | "| \(.key) | \(.value.title) |"' admin/policy.example.json`
         under a header row `| Check | Title |` (the only table rows in the file that start with
         `| O-` or `| R-`); (c) the file-gap rules, as a bullet list, not a table (R-ACT-06..09, R-SEC-07,
         R-FILE-01..03 per D1; LICENSE is a manual note); (d) the D15 note on every proposal that
         edits `.github/workflows/`: "needs the `workflow` scope on the agent's token (`gh auth refresh -s workflow`)";
         (e) area 7 "Archon config" exactly per D1; (f) the "no hand-over" sentence from D1 verbatim.
      4. `commands/edit-config.md`: add `.archon/config.yaml` to the files it may edit; validate it
         as YAML the same way as workflow files.
      5. Fixtures: in `clean.stubs.yaml` and `file-changes.stubs.yaml` remove the top-level `ops:`
         node stub and every proposal's `ops: []` line (file-changes.stubs.yaml:30), and any stub
         for another deleted node,
         set `can_admin: false`, `role: write`, add `admin_settings: []` (clean) and one entry
         `{check_id: R-BR-01, title: <its title from policy.example.json>, command: "gh-baseline apply OWNER/REPO --policy ~/policy.json --only R-BR-01"}`
         (file-changes).
         Add `fixtures/archon-sources.stubs.yaml`, a copy of `file-changes.stubs.yaml` whose one
         proposal is `kind: file` for `.archon/config.yaml` (area `other`), runs to the same end
         state as file-changes.
      6. `packs/devflow/archon-plugin.json` `description`, and `packs/devflow/README.md` line 23
         (row), line 40 if it mentions applying, and the bullet at lines 134-141: drop "apply what
         you approve", "needs an admin token", the allow-list and `config-changes.md`; say: the
         review is read-only with the agent's token, file fixes (incl. `.github/workflows/`, which
         needs the `workflow` scope, and `.archon/config.yaml`) go through a PR, settings gaps are
         listed for the admin user's `gh-baseline` (root README §3 "Admin GitHub identity").
         The table's last column becomes "Never; settings changes are listed for the admin".
      7. Keep `packs/devflow/.shared/gh.ts` and `scripts/snapshot.ts` unchanged.
      8. Do not add a `baseline_report` input or read anything from `~ghadmin`.
      Stop with status=blocked if `scripts/test-devflow-pack.sh` fails on a workflow other than
      devflow-config, or if `archon workflow test` rejects a devflow-config fixture for any reason
      other than a leftover stub for a deleted node (remove those stubs; anything else means this
      brief is wrong).
    acceptance:
      - grep -rnE 'validate-ops|apply-changes|no-admin|can_admin == true|config-changes\.md|needs an admin token' packs/devflow prints nothing
      - grep -n 'extraWorkflowSources' packs/devflow/devflow-config/commands/review-config.md prints a line
      - grep -n 'refresh -s workflow' packs/devflow/devflow-config/commands/review-config.md prints a line
      - grep -n 'Settings for the admin (gh-baseline)' packs/devflow/devflow-config/commands/review-config.md prints a line
      - grep -c '^| [OR]-' packs/devflow/devflow-config/commands/review-config.md equals jq '.checks | length' admin/policy.example.json (46)
      - grep -ln 'gh-baseline' packs/devflow/devflow-config/commands/review-config.md packs/devflow/README.md packs/devflow/archon-plugin.json lists all three
      - jq . packs/devflow/archon-plugin.json succeeds
      - grep -rnE 'baseline_report|~ghadmin|/home/ghadmin' packs/devflow prints nothing
      - grep -n 'admin_settings' packs/devflow/devflow-config/devflow-config.yaml prints a line
      - ls packs/devflow/devflow-config/fixtures shows exactly archon-sources, clean, file-changes stubs
      - scripts/test-devflow-pack.sh passes
  - id: p4-bootstrap-admin-user
    title: Bootstrap the sealed ghadmin user, install the hash-checked admin tools, add CODEOWNERS
    depends_on: [p1-slim-devflow-config, p3-policy-file]
    complexity: M
    touches:
      - bootstrap.sh
      - scripts/test-admin-tools.sh
      - .claude/toolkit.yaml
      - .github/CODEOWNERS
    brief: |
      Design D2, D6, D7, D13, D15 (bootstrap part) and D16 are the spec. Do not touch `admin/` or
      README.md.
      1. Create `.github/CODEOWNERS` with exactly the D13 content.
      2. `bootstrap.sh` header "Optional env" list (lines 14-30): add, after `AGENT_USER`,
         `ADMIN_USER=ghadmin` ("sealed user holding the admin GitHub login; no password/SSH/sudo"),
         and after `DEVFLOW_PACK`, `BOOTSTRAP_REPO=tkcs-lab/archon-work` and `BOOTSTRAP_REF=main`
         with the D6 descriptions, in the same column layout.
      3. Env block (lines 40-52): `ADMIN_USER="${ADMIN_USER:-ghadmin}"` after `AGENT_USER`;
         `BOOTSTRAP_REPO="${BOOTSTRAP_REPO:-tkcs-lab/archon-work}"` and
         `BOOTSTRAP_REF="${BOOTSTRAP_REF:-main}"` after `DEVFLOW_PACK`, each validated in the
         inline style of lines 43-44 with the D6 error texts. Then the D6 comment and the two
         constants with the values of `sha256sum admin/gh-baseline.py admin/policy.example.json`
         of the current tree.
      4. `fetch_admin_file() {` … `}` per D6 as a top-level function (opening line exactly
         `fetch_admin_file() {`, closing `}` at column 0), defined right after `die()` (line 56),
         NOT next to `archon_plugins_repo` (that is in §6, after 4b runs). Use `local tmp got`;
         `curl` and the hash comparison inside `if !`; `warn` for both messages; never `die` or `exit`.
      5. Section 4b per D7 between §4 and `# ---- 5. claude code`, with the call form of D7 step 9
         (`|| admin_ok=0`, never a bare call).
      6. Summary (after the existing `ARCHON_STARTED == 0` footer at the end of the file): the D16
         line or the D7 "Admin GitHub identity" block, per D7's rule.
      7. D15: footer line `gh auth login && gh auth setup-git` becomes
         `gh auth login --scopes workflow && gh auth setup-git`; the `.env` template comment
         (line 353) becomes the D15 text.
      8. `scripts/test-admin-tools.sh`: after the unit tests add:
         - hash check: for each pair (`ADMIN_SCRIPT_SHA256`, `admin/gh-baseline.py`),
           (`ADMIN_POLICY_SHA256`, `admin/policy.example.json`) read the value with
           `sed -n "s/^$var=\([0-9a-f]\{64\}\).*/\1/p" bootstrap.sh` and compare with
           `sha256sum`; fail with "FAIL - $var does not match $file" else, once both pass, print
           `ok - bootstrap hashes match admin/`.
         - `fetch_admin_file`: extract it with the sed pattern of
           `scripts/test-archon-repo-switch.sh:8`; define `warn() { echo "WARN: $*" >&2; }`,
           `BOOTSTRAP_REPO=o/r BOOTSTRAP_REF=t`, and `curl()` as a shell function that copies
           `$src` to the file after `-o`. Cases, each printing an `ok - ` line:
           (a) matching hash → returns 0, dest exists with the content (`ok - fetch_admin_file installs a matching file`);
           (b) wrong hash → returns 1, stderr contains "does not match this bootstrap", dest does
               not exist, no temp file left (compare `ls "${TMPDIR:-/tmp}"` before/after), and the
               test continues after the call (`ok - fetch_admin_file refuses a mismatch without exiting`);
           (c) `curl() { return 22; }` → returns 1, stderr contains "could not download"
               (`ok - fetch_admin_file warns when the download fails`).
           Call it in every case as `rc=0; fetch_admin_file … 2>"$err" || rc=$?`, and run the
           cases with `export TMPDIR=$(mktemp -d)` so "no temp file left" is checked as
           "`$TMPDIR` is empty afterwards" (not a listing of the shared /tmp).
         Update the header comment to drop "From p4 on".
      9. `.claude/toolkit.yaml` `verify.fast`: append `bash -n scripts/test-admin-tools.sh` and
         `scripts/test-admin-tools.sh`.
      Stop with status=blocked if `bash -n bootstrap.sh` fails for a cause outside your change,
      or if `admin/` differs from what the hashes were computed on at the end of the phase.
      Also stop with status=blocked if `useradd` on this machine does not create a per-user group
      (`grep USERGROUPS_ENAB /etc/login.defs` says `no`).
    acceptance:
      - bash -n bootstrap.sh
      - bash -n scripts/test-admin-tools.sh
      - scripts/test-admin-tools.sh exits 0 and prints "ok - bootstrap hashes match admin/", "ok - fetch_admin_file installs a matching file", "ok - fetch_admin_file refuses a mismatch without exiting" and "ok - fetch_admin_file warns when the download fails"
      - scripts/test-archon-repo-switch.sh passes
      - grep -c '@andras-tkcs' .github/CODEOWNERS prints 4
      - grep -n 'admin:repo_hook' bootstrap.sh prints a line
      - grep -n 'scopes workflow' bootstrap.sh prints a line
      - grep -n 'Admin tools not installed' bootstrap.sh prints a line
      - grep -n '^fetch_admin_file() {$' bootstrap.sh prints a line
      - '[ "$(grep -n "^fetch_admin_file() {$" bootstrap.sh | cut -d: -f1)" -lt "$(grep -n "4b. sealed admin user" bootstrap.sh | cut -d: -f1)" ] exits 0 (defined before section 4b runs)'
      - grep -nE '^\s*fetch_admin_file ' bootstrap.sh shows only lines ending in '|| admin_ok=0'
      - grep -nE 'die|exit' <(sed -n '/^fetch_admin_file() {$/,/^}$/p' bootstrap.sh) prints nothing
      - grep -nE 'systemctl|cron|timer' <(sed -n '/4b. sealed admin user/,/5. claude code/p' bootstrap.sh) prints nothing
      - grep -c 'test-admin-tools' .claude/toolkit.yaml prints 2
  - id: p5-docs-and-retire
    title: Document the admin user, the agent workflow scope and the new devflow-config split in the root README
    depends_on: [p4-bootstrap-admin-user]
    complexity: S
    touches:
      - README.md
    brief: |
      Retirement phase. Design D10, D15 (README part) and D16 (variables text) are the spec. Do
      not touch `admin/`, `bootstrap.sh` or `packs/`. There is no plan document in the repo to
      delete, no ADR and no changelog in this project.
      1. File table (README.md:15-25): add the three D10 rows after `scripts/test-archon-repo-switch.sh`.
      2. §2 curl example (lines 76-80): add `BOOTSTRAP_REF=<tag>` to the env list.
      3. §2 variables table: the three D10 rows (`ADMIN_USER` after `AGENT_USER`;
         `BOOTSTRAP_REPO`, `BOOTSTRAP_REF` after `DEVFLOW_PACK`).
      4. §3: replace `gh auth login               # GitHub.com …` with the D15 line, add the D15
         note under the code block, then the `### Admin GitHub identity` subsection per D10 (before
         `### Check it works`).
      5. "Daily use" devflow bullet: append the D10 sentence.
      6. "Security notes": append the two D10 bullets, and change the bullet "Secrets live only in
         `~agent/.archon/.env` (mode 600) and Claude's/gh's own credential stores on the VM." to
         "Secrets live only in `~agent/.archon/.env` (mode 600), Claude's/gh's own credential stores
         on the VM, and the admin token in `~ghadmin/.config/gh` (see below)."
      6b. §2 intro paragraph (line 85): "creates an `agent` user (no sudo)" becomes "creates an
         `agent` user (no sudo) and a sealed `ghadmin` user for the admin GitHub login".
      7. Final repo checks (no edit expected): `grep -rnE 'validate-ops|apply-changes|needs an admin token' . --exclude-dir=.git`
         prints nothing; `scripts/test-admin-tools.sh` passes. If a committed file reads the
         run's artifacts folder (`grep -rn 'artifacts/runs' --exclude-dir=.git .` prints a line)
         or contains the reference project's name, stop with status=blocked.
    acceptance:
      - grep -n 'ghadmin' README.md shows lines in the variables table, section 3 and Security notes
      - grep -n 'BOOTSTRAP_REF' README.md shows the curl example and the variables table
      - grep -n 'admin:repo_hook' README.md prints a line
      - grep -n 'scopes workflow' README.md prints a line
      - grep -n 'refresh -s workflow' README.md prints a line
      - grep -n 'CODEOWNERS' README.md shows the file table and the Security notes line
      - grep -n '### Admin GitHub identity' README.md prints a line
      - grep -rn 'artifacts/runs' --exclude-dir=.git . prints nothing
      - scripts/test-admin-tools.sh passes
```
