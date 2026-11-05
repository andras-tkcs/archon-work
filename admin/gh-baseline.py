#!/usr/bin/env python3
"""gh-baseline - read-only GitHub settings snapshot, plus audit / apply of a security
baseline on an organization, a repo, or all repos of an organization. One stdlib-only file.

  gh-baseline snapshot {repo,org,all} TARGET [--out DIR]
  gh-baseline audit  [TARGET] --policy FILE [--all] [--snapshot FILE] [--json OUT]
                     [--fail-on {high,medium,low,info}] [-v]
  gh-baseline apply  [TARGET] --policy FILE [--all] [--snapshot FILE] [--yes]
                     [--only IDS] [--skip IDS] [--status-checks NAMES] [--include-risky]

Targets: "myorg" = org settings only; "myorg --all" = org + every repo; "myorg/repo" = one repo.
snapshot only issues GET requests and writes <out>/<name>.json and .md (default out: snapshots).
         Secret VALUES are never read. Whatever the token cannot read is recorded under "gaps".
audit    never writes. With --snapshot it works fully offline on a stored snapshot file.
apply    is a DRY RUN unless --yes: it prints every API call it would make. It re-reads live
         state first, changes only what failed, never deletes anything, never removes an
         existing Actions allowlist entry, and writes apply-log-<time>.json (calls + before-state).
         Changes that can break workflows (default token read-only, allowlist flags) are
         "risky" and are skipped unless --include-risky.
         Apps, tokens, 2FA and the other UI-only items are report-only.

The policy file (--policy, required for audit and apply) holds the values to check against;
see policy.example.json. A policy that cannot be read exits 2.
Exit code: audit exits 1 if any non-accepted finding is at/above --fail-on (default high).

Needs: python3 and an authenticated `gh` (gh auth login --with-token, or GH_TOKEN).
Token: classic PAT of the admin account with scopes `repo`, `admin:org`, `read:org`,
`admin:repo_hook`, with an expiry. Rotate it before it expires: create a new PAT, run
`gh auth login --with-token` again, then revoke the old one. Endpoints the token cannot
read show up as gaps. Env: GH_BIN to override the gh binary.
"""
import argparse, base64, fnmatch, json, os, re, subprocess, sys
from datetime import datetime, timezone, timedelta

GH = os.environ.get("GH_BIN", "gh")
GAPS = []  # (scope, endpoint, status)


# ------------------------------------------------------------------ api helpers
def api(path, paginate=False, accept=None):
    """GET via gh. Returns parsed JSON, or {"_status": code, "_error": msg}."""
    cmd = [GH, "api", "--method", "GET", path]
    if paginate:
        cmd += ["--paginate", "--slurp"]
    if accept:
        cmd += ["-H", f"Accept: {accept}"]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        msg = (p.stdout + p.stderr).strip()
        m = re.search(r"HTTP (\d{3})", msg) or re.search(r'"status":\s*"?(\d{3})', msg)
        return {"_status": int(m.group(1)) if m else -1, "_error": msg[:300]}
    out = p.stdout.strip()
    if not out:
        return {"_status": 204}  # success, no body (e.g. vulnerability-alerts enabled)
    data = json.loads(out)
    if paginate and isinstance(data, list):  # --slurp gives list of pages
        flat = []
        for page in data:
            if isinstance(page, list):
                flat += page
            elif isinstance(page, dict):
                # endpoints that wrap the list: take the first list-valued key
                lists = [v for v in page.values() if isinstance(v, list)]
                flat += lists[0] if lists else [page]
        return flat
    return data


def bad(x):
    return isinstance(x, dict) and "_status" in x and "_error" in x


def got(scope, label, path, **kw):
    r = api(path, **kw)
    if bad(r):
        GAPS.append({"scope": scope, "endpoint": path, "status": r["_status"]})
    return r


def pick(d, keys):
    return {k: d.get(k) for k in keys} if isinstance(d, dict) else d


# ------------------------------------------------------------------ repo
REPO_KEYS = [
    "full_name", "private", "visibility", "fork", "archived", "disabled", "default_branch",
    "has_issues", "has_projects", "has_wiki", "has_discussions", "has_pages", "has_downloads",
    "allow_forking", "web_commit_signoff_required", "allow_merge_commit", "allow_squash_merge",
    "allow_rebase_merge", "allow_auto_merge", "delete_branch_on_merge", "allow_update_branch",
    "merge_commit_title", "merge_commit_message", "squash_merge_commit_title",
    "squash_merge_commit_message", "security_and_analysis", "topics", "license", "pushed_at",
]


def decode_file(scope, path):
    r = got(scope, "file", path)
    if bad(r) or not isinstance(r, dict) or "content" not in r:
        return None
    try:
        return base64.b64decode(r["content"]).decode("utf-8", "replace")
    except Exception:
        return None


def analyze_workflow(text):
    """Static checks on one workflow file (no YAML dependency: regex heuristics)."""
    uses = re.findall(r"^\s*-?\s*uses:\s*([^\s#]+)", text, re.M)
    ext = [u for u in uses if not u.startswith("./") and not u.startswith("docker://")]
    pinned = [u for u in ext if re.search(r"@[0-9a-f]{40}$", u)]
    return {
        "triggers_pull_request_target": bool(re.search(r"\bpull_request_target\b", text)),
        "triggers_workflow_run": bool(re.search(r"\bworkflow_run\b", text)),
        "top_level_permissions": bool(re.search(r"^permissions:", text, re.M)),
        "permissions_write_all": bool(re.search(r"permissions:\s*write-all", text)),
        "uses_self_hosted_runner": bool(re.search(r"self-hosted", text)),
        "uses_secrets_inherit": bool(re.search(r"secrets:\s*inherit", text)),
        "uses": sorted(set(ext)),
        "external_actions": len(ext),
        "external_actions_sha_pinned": len(pinned),
        "unpinned_actions": sorted(set(u for u in ext if u not in pinned)),
        "has_script_injection_risk": bool(re.search(r"\$\{\{\s*github\.event\.(issue|pull_request|comment|head_commit|review)[^}]*\}\}", text) and re.search(r"run:", text)),
    }


def collect_repo(full):
    s = f"repo:{full}"
    R = {"_collected": datetime.now(timezone.utc).isoformat()}
    meta = got(s, "repo", f"repos/{full}")
    if bad(meta):
        return {"_error": meta}
    R["settings"] = pick(meta, REPO_KEYS)
    default = meta.get("default_branch", "main")
    base = f"repos/{full}"

    # --- branches: legacy protection + rulesets effective on the default branch
    branches = got(s, "branches", f"{base}/branches?protected=true", paginate=True)
    R["protected_branches"] = {}
    if isinstance(branches, list):
        for b in branches:
            name = b["name"]
            R["protected_branches"][name] = got(s, "protection", f"{base}/branches/{name}/protection")
    if default not in R["protected_branches"]:
        R["protected_branches"][default] = got(s, "protection", f"{base}/branches/{default}/protection")
    R["signed_commits_default_branch"] = got(s, "sigs", f"{base}/branches/{default}/protection/required_signatures")
    R["effective_rules_default_branch"] = got(s, "rules", f"{base}/rules/branches/{default}")

    rs = got(s, "rulesets", f"{base}/rulesets?includes_parents=true&per_page=100", paginate=True)
    R["rulesets"] = []
    if isinstance(rs, list):
        for r in rs:
            R["rulesets"].append(got(s, "ruleset", f"{base}/rulesets/{r['id']}"))
    else:
        R["rulesets"] = rs
    R["legacy_tag_protection"] = got(s, "tagprot", f"{base}/tags/protection")  # deprecated, still reported
    tags = got(s, "tags", f"{base}/tags?per_page=100")
    R["tag_count_first_page"] = len(tags) if isinstance(tags, list) else tags

    # --- actions
    A = {}
    for k, p in {
        "permissions": "actions/permissions",
        "selected_actions": "actions/permissions/selected-actions",
        "workflow_token": "actions/permissions/workflow",
        "fork_pr_contributor_approval": "actions/permissions/fork-pr-contributor-approval",
        "fork_pr_workflows_private": "actions/permissions/fork-pr-workflows-private-repos",
        "artifact_and_log_retention": "actions/permissions/artifact-and-log-retention",
        "access_level": "actions/permissions/access",
    }.items():
        A[k] = got(s, k, f"{base}/{p}")
    sec = got(s, "secrets", f"{base}/actions/secrets", paginate=True)
    A["secret_names"] = [x["name"] for x in sec] if isinstance(sec, list) else sec
    var = got(s, "vars", f"{base}/actions/variables", paginate=True)
    A["variable_names"] = [x["name"] for x in var] if isinstance(var, list) else var
    run = got(s, "runners", f"{base}/actions/runners", paginate=True)
    A["self_hosted_runners"] = [pick(x, ["name", "os", "status", "labels"]) for x in run] if isinstance(run, list) else run
    wf = got(s, "workflows", f"{base}/actions/workflows", paginate=True)
    A["workflows"] = []
    if isinstance(wf, list):
        for w in wf:
            entry = pick(w, ["name", "path", "state"])
            if w["path"].startswith(".github/workflows/"):
                txt = decode_file(s, f"{base}/contents/{w['path']}?ref={default}")
                entry["analysis"] = analyze_workflow(txt) if txt else None
            A["workflows"].append(entry)
    envs = got(s, "envs", f"{base}/environments", paginate=True)
    A["environments"] = envs
    R["actions"] = A

    # --- code security
    C = {}
    C["vulnerability_alerts_enabled"] = got(s, "va", f"{base}/vulnerability-alerts")  # 204 => on, 404 => off
    C["automated_security_fixes"] = got(s, "asf", f"{base}/automated-security-fixes")
    C["private_vulnerability_reporting"] = got(s, "pvr", f"{base}/private-vulnerability-reporting")
    C["code_scanning_default_setup"] = got(s, "cs", f"{base}/code-scanning/default-setup")
    for k, p in {
        "open_code_scanning_alerts": "code-scanning/alerts?state=open&per_page=100",
        "open_dependabot_alerts": "dependabot/alerts?state=open&per_page=100",
        "open_secret_scanning_alerts": "secret-scanning/alerts?state=open&per_page=100",
    }.items():
        r = got(s, k, f"{base}/{p}")
        C[k] = (len(r) if isinstance(r, list) else r)  # counts only, no alert content
    C["dependabot_secret_names"] = [x["name"] for x in (got(s, "dsec", f"{base}/dependabot/secrets", paginate=True) or []) if isinstance(x, dict) and "name" in x]
    R["code_security"] = C

    # --- files that matter
    files = {}
    for f in ["SECURITY.md", ".github/SECURITY.md", "CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS",
              ".github/dependabot.yml", ".github/dependabot.yaml", ".github/pull_request_template.md",
              ".github/renovate.json", "renovate.json", "LICENSE", "CONTRIBUTING.md", ".gitignore"]:
        r = api(f"{base}/contents/{f}?ref={default}")
        files[f] = not bad(r)
    R["files_present"] = files
    dep = decode_file(s, f"{base}/contents/.github/dependabot.yml?ref={default}") or decode_file(s, f"{base}/contents/.github/dependabot.yaml?ref={default}")
    R["dependabot_ecosystems"] = sorted(set(re.findall(r"package-ecosystem:\s*[\"']?([\w-]+)", dep))) if dep else []
    R["community_profile"] = got(s, "community", f"{base}/community/profile")

    # --- access & integrations
    R["collaborators"] = [pick(c, ["login", "type", "role_name", "permissions"]) for c in (got(s, "collab", f"{base}/collaborators?affiliation=all", paginate=True) or []) if isinstance(c, dict) and "login" in c]
    teams = got(s, "teams", f"{base}/teams", paginate=True)
    R["teams"] = [pick(t, ["slug", "permission"]) for t in teams] if isinstance(teams, list) else teams
    inv = got(s, "invites", f"{base}/invitations", paginate=True)
    R["pending_invitations"] = [pick(i, ["invitee", "permissions", "created_at"]) for i in inv] if isinstance(inv, list) else inv
    keys = got(s, "keys", f"{base}/keys", paginate=True)
    R["deploy_keys"] = [pick(k, ["title", "read_only", "created_at", "last_used"]) for k in keys] if isinstance(keys, list) else keys
    hooks = got(s, "hooks", f"{base}/hooks", paginate=True)
    R["webhooks"] = [{"name": h.get("name"), "active": h.get("active"), "events": h.get("events"),
                      "host": re.sub(r"^(https?://[^/]+).*", r"\1", h.get("config", {}).get("url", "")),
                      "insecure_ssl": h.get("config", {}).get("insecure_ssl"),
                      "has_secret": "secret" in h.get("config", {})} for h in hooks] if isinstance(hooks, list) else hooks
    R["autolinks"] = got(s, "autolinks", f"{base}/autolinks")
    R["pages"] = got(s, "pages", f"{base}/pages")
    R["rate_of_forks_and_visibility"] = pick(meta, ["forks_count", "network_count", "subscribers_count"])
    return R


# ------------------------------------------------------------------ org
ORG_KEYS = [
    "login", "two_factor_requirement_enabled", "default_repository_permission",
    "members_can_create_repositories", "members_can_create_public_repositories",
    "members_can_create_private_repositories", "members_can_create_internal_repositories",
    "members_can_fork_private_repositories", "members_can_create_pages",
    "members_can_create_public_pages", "members_can_create_private_pages",
    "web_commit_signoff_required", "advanced_security_enabled_for_new_repositories",
    "dependabot_alerts_enabled_for_new_repositories",
    "dependabot_security_updates_enabled_for_new_repositories",
    "dependency_graph_enabled_for_new_repositories",
    "secret_scanning_enabled_for_new_repositories",
    "secret_scanning_push_protection_enabled_for_new_repositories",
    "secret_scanning_push_protection_custom_link_enabled", "plan", "billing_email",
    "public_repos", "total_private_repos",
]


def collect_org(org):
    s = f"org:{org}"
    O = {"_collected": datetime.now(timezone.utc).isoformat()}
    meta = got(s, "org", f"orgs/{org}")
    if bad(meta):
        return {"_error": meta}
    O["settings"] = pick(meta, ORG_KEYS)
    base = f"orgs/{org}"

    members = got(s, "members", f"{base}/members?role=admin", paginate=True)
    O["owners"] = [m["login"] for m in members] if isinstance(members, list) else members
    n2 = got(s, "no2fa", f"{base}/members?filter=2fa_disabled", paginate=True)
    O["members_without_2fa"] = [m["login"] for m in n2] if isinstance(n2, list) else n2
    oc = got(s, "outside", f"{base}/outside_collaborators", paginate=True)
    O["outside_collaborators"] = [m["login"] for m in oc] if isinstance(oc, list) else oc
    mem = got(s, "allmembers", f"{base}/members", paginate=True)
    O["member_count"] = len(mem) if isinstance(mem, list) else mem
    inv = got(s, "orginv", f"{base}/invitations", paginate=True)
    O["pending_invitations"] = [pick(i, ["login", "email", "role", "created_at"]) for i in inv] if isinstance(inv, list) else inv
    O["security_managers"] = got(s, "secmgr", f"{base}/security-managers")
    O["custom_repository_roles"] = got(s, "roles", f"{base}/custom-repository-roles")

    A = {}
    for k, p in {
        "permissions": "actions/permissions",
        "selected_actions": "actions/permissions/selected-actions",
        "workflow_token": "actions/permissions/workflow",
        "fork_pr_contributor_approval": "actions/permissions/fork-pr-contributor-approval",
        "fork_pr_workflows_private": "actions/permissions/fork-pr-workflows-private-repos",
        "selected_repositories": "actions/permissions/repositories",
        "runner_groups": "actions/runner-groups",
    }.items():
        A[k] = got(s, k, f"{base}/{p}")
    sec = got(s, "secrets", f"{base}/actions/secrets", paginate=True)
    A["secret_names_and_visibility"] = [pick(x, ["name", "visibility"]) for x in sec] if isinstance(sec, list) else sec
    var = got(s, "vars", f"{base}/actions/variables", paginate=True)
    A["variable_names_and_visibility"] = [pick(x, ["name", "visibility"]) for x in var] if isinstance(var, list) else var
    O["actions"] = A
    dsec = got(s, "dsec", f"{base}/dependabot/secrets", paginate=True)
    O["dependabot_secret_names"] = [pick(x, ["name", "visibility"]) for x in dsec] if isinstance(dsec, list) else dsec

    rs = got(s, "orgrulesets", f"{base}/rulesets?per_page=100", paginate=True)
    O["rulesets"] = [got(s, "orgruleset", f"{base}/rulesets/{r['id']}") for r in rs] if isinstance(rs, list) else rs

    # --- applications, tokens, credentials
    inst = got(s, "installs", f"{base}/installations", paginate=True)
    O["github_app_installations"] = [{
        "app_slug": i.get("app_slug"), "id": i.get("id"), "repository_selection": i.get("repository_selection"),
        "permissions": i.get("permissions"), "events": i.get("events"),
        "created_at": i.get("created_at"), "updated_at": i.get("updated_at"),
        "suspended_at": i.get("suspended_at")} for i in inst] if isinstance(inst, list) else inst
    pats = got(s, "pats", f"{base}/personal-access-tokens?per_page=100", paginate=True)
    O["fine_grained_pats_with_access"] = [pick(p, ["owner", "token_name", "token_expired", "token_expires_at",
                                                    "token_last_used_at", "repository_selection", "permissions",
                                                    "access_granted_at"]) for p in pats] if isinstance(pats, list) else pats
    prq = got(s, "patreq", f"{base}/personal-access-token-requests?per_page=100", paginate=True)
    O["fine_grained_pat_requests_pending"] = len(prq) if isinstance(prq, list) else prq
    O["credential_authorizations_saml"] = got(s, "cred", f"{base}/credential-authorizations", paginate=True)
    O["org_webhooks"] = [{"active": h.get("active"), "events": h.get("events"),
                          "host": re.sub(r"^(https?://[^/]+).*", r"\1", h.get("config", {}).get("url", "")),
                          "insecure_ssl": h.get("config", {}).get("insecure_ssl")} for h in
                         (got(s, "orghooks", f"{base}/hooks", paginate=True) or []) if isinstance(h, dict) and "config" in h]
    # PAT / SSH-key policy is only in the UI; flag it so nobody assumes it was checked
    O["_ui_only_not_collectable"] = [
        "Third-party OAuth app access policy (Settings > Third-party Access)",
        "Classic PAT access policy (Settings > Personal access tokens > Settings)",
        "SSH certificate authorities", "IP allow list", "Audit-log streaming (Enterprise)",
        "Fine-grained PAT approval policy (also reflected indirectly by the requests list)",
    ]
    return O


def list_org_repos(org):
    r = got(f"org:{org}", "repos", f"orgs/{org}/repos?type=all&per_page=100", paginate=True)
    return [x["full_name"] for x in r if not x.get("archived")] if isinstance(r, list) else []


# ------------------------------------------------------------------ markdown summary
def yn(v):
    return "yes" if v is True else "no" if v is False else "?" if v is None else str(v)


def not_bad(x):
    return not bad(x)


def rule_types(rulesets):
    out = []
    for r in rulesets if isinstance(rulesets, list) else []:
        if not isinstance(r, dict) or "rules" not in r:
            continue
        inc = (r.get("conditions") or {}).get("ref_name", {}).get("include")
        out.append(f"- **{r['name']}** ({r['target']}, {r['enforcement']}) targets `{inc}`: " +
                   ", ".join(x["type"] for x in r["rules"]) +
                   f" | bypass: {[(b['actor_type'], b['bypass_mode']) for b in r.get('bypass_actors', [])] or 'none'}")
    return out or ["- none / not readable"]


def md_repo(full, R):
    if "_error" in R:
        return [f"## {full}", f"unreadable: {R['_error']}"]
    st, A, C = R["settings"], R["actions"], R["code_security"]
    L = [f"## {full}", "",
         f"visibility **{st['visibility']}**, default `{st['default_branch']}`, archived {yn(st['archived'])}, forking {yn(st['allow_forking'])}, "
         f"web sign-off {yn(st['web_commit_signoff_required'])}, delete-branch-on-merge {yn(st['delete_branch_on_merge'])}, "
         f"merge/squash/rebase {yn(st['allow_merge_commit'])}/{yn(st['allow_squash_merge'])}/{yn(st['allow_rebase_merge'])}", "",
         "**Rulesets**", *rule_types(R["rulesets"]), "",
         "**Legacy branch protection:** " + (", ".join(k for k, v in R["protected_branches"].items() if not_bad(v)) or "none"),
         f"**Legacy tag protection:** {R['legacy_tag_protection'] if bad(R['legacy_tag_protection']) else len(R['legacy_tag_protection'])} rules", "",
         "**Actions**",
         f"- permissions: `{json.dumps(A['permissions'])}`",
         f"- selected actions: `{json.dumps(A['selected_actions'])}`",
         f"- default GITHUB_TOKEN: `{json.dumps(A['workflow_token'])}`",
         f"- fork PR approval: `{json.dumps(A['fork_pr_contributor_approval'])}`",
         f"- secrets: {A['secret_names']} | variables: {A['variable_names']} | self-hosted runners: {len(A['self_hosted_runners']) if isinstance(A['self_hosted_runners'], list) else A['self_hosted_runners']}"]
    for w in A["workflows"]:
        an = w.get("analysis") or {}
        L.append(f"- workflow `{w['path']}`: pinned {an.get('external_actions_sha_pinned')}/{an.get('external_actions')}, "
                 f"top-level permissions {yn(an.get('top_level_permissions'))}, pull_request_target {yn(an.get('triggers_pull_request_target'))}")
    L += ["", "**Code security**"] + [f"- {k}: `{json.dumps(v)[:120]}`" for k, v in C.items()]
    L += ["", f"**Files:** " + ", ".join(k for k, v in R["files_present"].items() if v),
          f"**Collaborators:** {len(R['collaborators'])}, deploy keys: {len(R['deploy_keys']) if isinstance(R['deploy_keys'], list) else R['deploy_keys']}, "
          f"webhooks: {len(R['webhooks']) if isinstance(R['webhooks'], list) else R['webhooks']}", ""]
    return L


def md_org(org, O):
    if "_error" in O:
        return [f"# org {org}", f"unreadable: {O['_error']}"]
    s = O["settings"]
    L = [f"# org {org}", "",
         f"2FA required {yn(s['two_factor_requirement_enabled'])}, default repo permission `{s['default_repository_permission']}`, "
         f"members create repos {yn(s['members_can_create_repositories'])}, owners {O['owners']}, members without 2FA {O['members_without_2fa']}",
         f"outside collaborators: {O['outside_collaborators']}", "", "**Org rulesets**", *rule_types(O["rulesets"]), "",
         f"**Actions:** `{json.dumps(O['actions']['permissions'])}` | token `{json.dumps(O['actions']['workflow_token'])}`", "",
         "**GitHub App installations**"]
    ins = O["github_app_installations"]
    L += [f"- {i['app_slug']}: repos={i['repository_selection']}, perms={i['permissions']}" for i in ins] if isinstance(ins, list) else [f"- {ins}"]
    p = O["fine_grained_pats_with_access"]
    L += ["", f"**Fine-grained PATs with org access:** {len(p) if isinstance(p, list) else p}; pending requests {O['fine_grained_pat_requests_pending']}", "",
          "**Not collectable via API (check in UI):** " + "; ".join(O["_ui_only_not_collectable"]), ""]
    return L


SEV = {"high": 3, "medium": 2, "low": 1, "info": 0}
CHECKS = {  # id: (default severity, title)
    "O-01": ("high", "org requires 2FA"),
    "O-02": ("medium", "org default repository permission"),
    "O-03": ("low", "members cannot create public repos"),
    "O-04": ("low", "org has >= min owners"),
    "O-05": ("high", "org Actions: only selected actions allowed"),
    "O-06": ("medium", "org Actions: allowlist flags and wildcards"),
    "O-07": ("medium", "org Actions: default token read-only"),
    "O-08": ("medium", "org Actions: workflows cannot approve PRs"),
    "O-09": ("medium", "org Actions: approval for all external contributors"),
    "O-10": ("high", "runner groups open to public repos"),
    "O-11": ("high", "GitHub Apps accepted and within accepted permissions"),
    "O-12": ("medium", "fine-grained tokens expire and are used"),
    "O-13": ("medium", "org webhooks secure"),
    "O-14": ("low", "new-repo security defaults"),
    "R-BR-01": ("high", "default branch: deletion blocked"),
    "R-BR-02": ("high", "default branch: force push blocked"),
    "R-BR-03": ("high", "default branch: pull request required"),
    "R-BR-04": ("medium", "default branch: review parameters"),
    "R-BR-05": ("high", "default branch: status checks required"),
    "R-BR-06": ("medium", "default branch: no unconditional bypass"),
    "R-TAG-01": ("high", "release tags protected"),
    "R-SET-01": ("low", "delete branch on merge"),
    "R-SEC-01": ("high", "secret scanning"),
    "R-SEC-02": ("high", "secret push protection"),
    "R-SEC-03": ("medium", "Dependabot alerts"),
    "R-SEC-04": ("medium", "Dependabot security updates"),
    "R-SEC-05": ("medium", "private vulnerability reporting"),
    "R-SEC-06": ("low", "code scanning"),
    "R-SEC-07": ("low", "dependabot.yml covers github-actions"),
    "R-ACT-01": ("high", "Actions: selected actions only"),
    "R-ACT-02": ("medium", "Actions: allowlist flags and wildcards"),
    "R-ACT-03": ("medium", "Actions: default token read-only"),
    "R-ACT-04": ("medium", "Actions: workflows cannot approve PRs"),
    "R-ACT-05": ("medium", "Actions: approval for all external contributors"),
    "R-ACT-06": ("medium", "workflows: third-party actions pinned to SHA"),
    "R-ACT-07": ("medium", "workflows: top-level permissions block"),
    "R-ACT-08": ("medium", "workflows: pull_request_target / workflow_run review"),
    "R-ACT-09": ("medium", "workflows: self-hosted runner on public repo"),
    "R-ACT-10": ("medium", "environments restrict deployment branches"),
    "R-ACT-11": ("low", "used actions covered by allowlist"),
    "R-FILE-01": ("low", "SECURITY.md present"),
    "R-FILE-02": ("low", "CODEOWNERS present"),
    "R-FILE-03": ("low", "LICENSE present (public repos)"),
    "R-ACC-01": ("high", "no write deploy keys"),
    "R-ACC-02": ("medium", "repo webhooks secure"),
    "R-ACC-03": ("low", "no stale pending invitations / direct admins"),
}


# ------------------------------------------------------------------ helpers
def ok(x):
    return x is not None and not bad(x)


class Finder:
    def __init__(self, scope, B, out):
        self.scope, self.B, self.out = scope, B, out

    def add(self, cid, status, msg, fix=None, manual=None):
        sev = self.B.get("severity_overrides", {}).get(cid) or CHECKS[cid][0]
        f = {"id": cid, "scope": self.scope, "title": CHECKS[cid][1], "severity": sev,
             "status": status, "message": msg, "fix": fix or [], "manual": manual}
        for s in self.B.get("suppress", []):
            if s["check"] == cid and fnmatch.fnmatch(self.scope.split(":", 1)[-1], s["target"]) and status == "fail":
                f["status"], f["message"] = "accepted", f"{msg} [accepted: {s['reason']}]"
        self.out.append(f)

    def check(self, cid, cond, msg_ok, msg_bad, fix=None, manual=None):
        """cond None => unknown (data unreadable)."""
        if cond is None:
            self.add(cid, "unknown", "could not be read with this token / plan")
        elif cond:
            self.add(cid, "pass", msg_ok)
        else:
            self.add(cid, "fail", msg_bad, fix, manual)


def call(key, method, path, body=None, risky=False, why=""):
    return {"key": key, "method": method, "path": path, "body": body, "risky": risky, "why": why}


def covers(patterns, used):
    return any(fnmatch.fnmatch(used, p) for p in patterns)


def to_pattern(u):
    return u.split("@")[0] + "@*"


# ------------------------------------------------------------------ org checks
def check_org(login, O, B, out):
    f = Finder(f"org:{login}", B, out)
    if "_error" in O:
        f.add("O-01", "unknown", "org unreadable")
        return
    b, s, A = B["org"], O["settings"], O["actions"]
    base = f"orgs/{login}"
    f.check("O-01", s.get("two_factor_requirement_enabled") is True, "required", "not required",
            manual="Org Settings > Authentication security > Require two-factor authentication")
    if O.get("members_without_2fa"):
        f.add("O-01", "fail", f"members without 2FA: {O['members_without_2fa']}")
    f.check("O-02", s.get("default_repository_permission") in b["default_repository_permission"],
            f"`{s.get('default_repository_permission')}`", f"`{s.get('default_repository_permission')}`, want one of {b['default_repository_permission']}",
            [call("org-defperm", "PATCH", base, {"default_repository_permission": B["org"]["default_repository_permission"][0]})])
    f.check("O-03", s.get("members_can_create_public_repositories") is False if b["members_can_create_public_repositories"] is False else True,
            "members cannot create public repos", "members can create public repos",
            [call("org-pubrepos", "PATCH", base, {"members_can_create_public_repositories": False})])
    owners = O.get("owners")
    f.check("O-04", len(owners) >= b["min_owners"] if isinstance(owners, list) else None,
            f"{owners}", f"only {len(owners) if isinstance(owners, list) else '?'} owner(s) {owners}, want >= {b['min_owners']} (lockout risk)",
            manual="add a second owner (or accept via suppress)")

    ab, perm, sel = B["actions"], A.get("permissions"), A.get("selected_actions")
    f.check("O-05", perm.get("allowed_actions") == "selected" if ok(perm) else None,
            "selected", f"allowed_actions={perm.get('allowed_actions') if ok(perm) else '?'}",
            [call("org-actperm", "PUT", f"{base}/actions/permissions",
                  {"enabled_repositories": perm.get("enabled_repositories", "all"), "allowed_actions": "selected"}, True,
                  "may block workflows that use actions not in the allowlist") ] if ok(perm) else None)
    if ok(sel):
        pats = sel.get("patterns_allowed", [])
        wild = [p for p in pats if p in ("*", "*/*", "*@*")]
        flags_ok = sel.get("github_owned_allowed") is ab["github_owned_allowed"] and sel.get("verified_allowed") is ab["verified_allowed"]
        extra = [p for p in pats if p not in ab["allowlist"]]
        f.check("O-06", flags_ok and not wild,
                f"flags ok, {len(pats)} patterns" + (f" ({len(extra)} beyond baseline: {extra})" if extra else ""),
                f"github_owned={sel.get('github_owned_allowed')} verified={sel.get('verified_allowed')} wildcards={wild}",
                [call("org-selected", "PUT", f"{base}/actions/permissions/selected-actions",
                      {"github_owned_allowed": ab["github_owned_allowed"], "verified_allowed": ab["verified_allowed"],
                       "patterns_allowed": sorted(set(pats) - set(wild))}, True,
                      "turning off GitHub-owned/verified blocks actions not covered by an explicit pattern")])
    else:
        f.add("O-06", "unknown", "selected-actions unreadable (org allows all actions?)" if not ok(perm) or perm.get("allowed_actions") != "selected" else "unreadable")
    tok = A.get("workflow_token")
    if ok(tok):
        f.check("O-07", tok.get("default_workflow_permissions") == ab["default_workflow_permissions"], "read", f"{tok.get('default_workflow_permissions')}",
                [call("org-token", "PUT", f"{base}/actions/permissions/workflow",
                      {"default_workflow_permissions": ab["default_workflow_permissions"], "can_approve_pull_request_reviews": False},
                      tok.get("default_workflow_permissions") != ab["default_workflow_permissions"], "workflows relying on a write default token will fail")])
        f.check("O-08", tok.get("can_approve_pull_request_reviews") is False, "no", "workflows may approve PRs",
                [call("org-token", "PUT", f"{base}/actions/permissions/workflow",
                      {"default_workflow_permissions": ab["default_workflow_permissions"], "can_approve_pull_request_reviews": False},
                      tok.get("default_workflow_permissions") != ab["default_workflow_permissions"], "workflows relying on a write default token will fail")])
    else:
        f.add("O-07", "unknown", "unreadable")
        f.add("O-08", "unknown", "unreadable")
    fk = A.get("fork_pr_contributor_approval")
    f.check("O-09", fk.get("approval_policy") == ab["fork_pr_contributor_approval"] if ok(fk) else None, "all_external_contributors",
            f"{fk.get('approval_policy') if ok(fk) else '?'}",
            [call("org-fork", "PUT", f"{base}/actions/permissions/fork-pr-contributor-approval", {"approval_policy": ab["fork_pr_contributor_approval"]})])
    rg = A.get("runner_groups")
    if ok(rg):
        open_ = [g["name"] for g in rg.get("runner_groups", []) if g.get("allows_public_repositories") and not g.get("restricted_to_workflows")]
        f.check("O-10", not open_, "no group exposes runners to public repos without workflow restriction",
                f"runner groups open to public repos: {open_}", manual="Org Settings > Actions > Runner groups: restrict to selected workflows or disallow public repos")
    else:
        f.add("O-10", "unknown", "unreadable")

    # apps
    inst, acc = O.get("github_app_installations"), B["apps"]["accepted"]
    if isinstance(inst, list):
        probs = []
        for i in inst:
            a = acc.get(i["app_slug"])
            if not a:
                probs.append(f"{i['app_slug']} not accepted (repos={i['repository_selection']}, perms={i['permissions']})")
                continue
            order = ["none", "read", "write", "admin"]
            for k, v in i["permissions"].items():
                if order.index(v) > order.index(a.get("permissions", {}).get(k, "none")):
                    probs.append(f"{i['app_slug']}: {k}={v} exceeds accepted {a.get('permissions', {}).get(k, 'none')}")
            if a.get("repository_selection") == "selected" and i["repository_selection"] == "all":
                probs.append(f"{i['app_slug']}: access widened to all repos")
        f.check("O-11", not probs, f"{len(inst)} app(s), all accepted", "; ".join(probs),
                manual="review in Org Settings > GitHub Apps; then record in the policy file apps.accepted with a reason, or uninstall/narrow")
    else:
        f.add("O-11", "unknown", "installations unreadable")
    pats = O.get("fine_grained_pats_with_access")
    if isinstance(pats, list):
        lim = datetime.now(timezone.utc) + timedelta(days=B["tokens"]["max_fine_grained_pat_lifetime_days"])
        stale = datetime.now(timezone.utc) - timedelta(days=B["tokens"]["stale_after_days"])
        pr = []
        for p in pats:
            exp, used = p.get("token_expires_at"), p.get("token_last_used_at")
            who = f"{(p.get('owner') or {}).get('login')}/{p.get('token_name')}"
            if not exp or datetime.fromisoformat(exp.replace("Z", "+00:00")) > lim:
                pr.append(f"{who}: no/too-long expiry")
            if used and datetime.fromisoformat(used.replace("Z", "+00:00")) < stale:
                pr.append(f"{who}: unused > {B['tokens']['stale_after_days']}d")
        f.check("O-12", not pr, f"{len(pats)} token(s) ok", "; ".join(pr), manual="Org Settings > Personal access tokens > Active tokens: revoke")
    else:
        f.add("O-12", "unknown", "fine-grained token list unreadable (feature off for the org, or scope admin:org missing). Classic PATs are never listed by the API: check SSO/credential authorizations and org policy in the UI")
    hk = O.get("org_webhooks")
    if isinstance(hk, list):
        probs = [h for h in hk if h.get("insecure_ssl") in ("1", 1, True) or not h.get("host", "").startswith("https://")]
        f.check("O-13", not probs, f"{len(hk)} webhook(s)", f"insecure webhooks: {probs}", manual="edit/delete in Org Settings > Webhooks")
    else:
        f.add("O-13", "unknown", "unreadable")
    legacy = [k for k in ("secret_scanning_enabled_for_new_repositories", "secret_scanning_push_protection_enabled_for_new_repositories",
                          "dependabot_alerts_enabled_for_new_repositories", "dependency_graph_enabled_for_new_repositories") if s.get(k) is False]
    f.check("O-14", not legacy or not b["new_repo_security_defaults"], "on", f"legacy new-repo flags off: {legacy}",
            manual="Org Settings > Code security > Configurations: attach a default configuration (secret scanning + push protection + Dependabot) for new repos. The legacy flags are deprecated, so a configuration may already cover this")


# ------------------------------------------------------------------ repo checks
def branch_rules(R):
    """Merge effective ruleset rules (incl. org rulesets) and legacy branch protection."""
    out, known = {}, False
    er = R.get("effective_rules_default_branch")
    if isinstance(er, list):
        known = True
        for r in er:
            out.setdefault(r["type"], []).append(r.get("parameters") or {})
    d = R["settings"]["default_branch"]
    lp = R["protected_branches"].get(d)
    if isinstance(lp, dict) and not bad(lp):
        known = True
        if (lp.get("allow_deletions") or {}).get("enabled") is False:
            out.setdefault("deletion", []).append({})
        if (lp.get("allow_force_pushes") or {}).get("enabled") is False:
            out.setdefault("non_fast_forward", []).append({})
        prr = lp.get("required_pull_request_reviews")
        if prr:
            out.setdefault("pull_request", []).append({
                "required_approving_review_count": prr.get("required_approving_review_count", 0),
                "dismiss_stale_reviews_on_push": prr.get("dismiss_stale_reviews"),
                "require_code_owner_review": prr.get("require_code_owner_reviews")})
        rsc = lp.get("required_status_checks")
        if rsc:
            out.setdefault("required_status_checks", []).append({
                "required_status_checks": [{"context": c} for c in rsc.get("contexts", [])],
                "strict_required_status_checks_policy": rsc.get("strict")})
    return out, known


def ref_matches(include, ref):
    return any(i in ("~ALL",) or (i == "~DEFAULT_BRANCH" and ref.startswith("refs/heads/")) or fnmatch.fnmatch(ref, i) for i in include)


def active_rulesets(R, target):
    rs = R.get("rulesets")
    return [x for x in rs if isinstance(x, dict) and "rules" in x and x.get("target") == target and x.get("enforcement") == "active"] if isinstance(rs, list) else None


def build_ruleset_calls(full, R, B, status_checks):
    """One create-or-update call that brings the default-branch ruleset to baseline."""
    bb, d = B["branch"], R["settings"]["default_branch"]
    has_co = any(R["files_present"].get(p) for p in (".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"))
    rules, _ = branch_rules(R)
    existing_pr = max([p.get("required_approving_review_count", 0) for p in rules.get("pull_request", [])] or [0])
    want_pr = {"required_approving_review_count": max(bb["min_review_count"], existing_pr), "dismiss_stale_reviews_on_push": True,
               "require_code_owner_review": bool(has_co and bb["require_code_owner_review_if_codeowners_exists"]),
               "require_last_push_approval": False, "required_review_thread_resolution": False}
    contexts = status_checks or sorted({c["context"] for p in rules.get("required_status_checks", []) for c in p.get("required_status_checks", [])})
    want = [{"type": "deletion"}, {"type": "non_fast_forward"}, {"type": "pull_request", "parameters": want_pr}]
    if contexts:
        want.append({"type": "required_status_checks", "parameters": {
            "strict_required_status_checks_policy": bb["strict_status_checks"], "do_not_enforce_on_create": False,
            "required_status_checks": [{"context": c} for c in contexts]}})
    mine = next((x for x in active_rulesets(R, "branch") or [] if x["name"] == "default-branch"), None)
    byp = [{k: bb["bypass_actor"][k] for k in ("actor_id", "actor_type", "bypass_mode")}]
    if mine:  # update in place: keep what is there, add/upgrade what is missing
        have = {r["type"]: r for r in mine["rules"]}
        for w in want:
            if w["type"] == "pull_request" and "pull_request" in have:
                cur = have["pull_request"].get("parameters", {})
                w["parameters"] = {**cur, **{k: (max(v, cur.get(k, 0)) if k == "required_approving_review_count" else (v or cur.get(k, False))) for k, v in want_pr.items()}}
            if w["type"] == "required_status_checks" and "required_status_checks" in have:
                continue
            have[w["type"]] = w
        body = {"name": mine["name"], "target": "branch", "enforcement": "active", "conditions": mine["conditions"],
                "bypass_actors": mine.get("bypass_actors", []), "rules": list(have.values())}
        if sorted(json.dumps(r, sort_keys=True) for r in body["rules"]) == sorted(json.dumps(r, sort_keys=True) for r in mine["rules"]):
            return []
        return [call("ruleset-default", "PUT", f"repos/{full}/rulesets/{mine['id']}", body, False, "update ruleset 'default-branch' in place")]
    body = {"name": "default-branch", "target": "branch", "enforcement": "active",
            "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}}, "bypass_actors": byp, "rules": want}
    note = "" if contexts else " (no required status checks: pass --status-checks ctx1,ctx2 or add them after the first CI run)"
    return [call("ruleset-default", "POST", f"repos/{full}/rulesets", body, False, "create ruleset 'default-branch'" + note)]


def check_repo(full, R, B, out, status_checks=None):
    f = Finder(f"repo:{full}", B, out)
    if "_error" in R:
        f.add("R-BR-01", "unknown", "repo unreadable")
        return
    st, A, C, base = R["settings"], R["actions"], R["code_security"], f"repos/{full}"
    if st.get("archived"):
        return
    pub = st.get("visibility") == "public"
    bb, rb, ab = B["branch"], B["repo"], B["actions"]

    # --- branch protection
    rules, known = branch_rules(R)
    fix = build_ruleset_calls(full, R, B, status_checks) if known else None
    f.check("R-BR-01", ("deletion" in rules) if known else None, "blocked", "default branch can be deleted", fix)
    f.check("R-BR-02", ("non_fast_forward" in rules) if known else None, "blocked", "force pushes allowed", fix)
    f.check("R-BR-03", ("pull_request" in rules) if known else None, "required", "direct pushes allowed", fix)
    if "pull_request" in rules:
        prs = rules["pull_request"]
        cnt = max(p.get("required_approving_review_count", 0) for p in prs)
        stale = any(p.get("dismiss_stale_reviews_on_push") for p in prs)
        has_co = any(R["files_present"].get(p) for p in (".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"))
        co = any(p.get("require_code_owner_review") for p in prs)
        probs = []
        if cnt < bb["min_review_count"]:
            probs.append(f"approvals={cnt} < {bb['min_review_count']}")
        if bb["dismiss_stale_reviews_on_push"] and not stale:
            probs.append("stale reviews not dismissed")
        if has_co and bb["require_code_owner_review_if_codeowners_exists"] and not co:
            probs.append("CODEOWNERS exists but code-owner review not required")
        f.check("R-BR-04", not probs, f"approvals={cnt}, stale-dismiss={stale}, code-owner={co}", "; ".join(probs), fix)
    elif known:
        f.add("R-BR-04", "fail", "no pull_request rule", fix)
    sc = rules.get("required_status_checks")
    has_ci = any((w.get("path") or "").startswith(".github/workflows/") for w in A.get("workflows", []))
    have_sc = bool(sc and any(p.get("required_status_checks") for p in sc))
    if known and not have_sc and not has_ci:
        f.add("R-BR-05", "na", "repo has no CI workflows to require")
    else:
        sfix = fix if (status_checks or have_sc) else None
        f.check("R-BR-05", have_sc if known else None,
                f"{sum(len(p.get('required_status_checks', [])) for p in sc or [])} check(s), strict={any(p.get('strict_required_status_checks_policy') for p in sc or [])}",
                "no required status checks", sfix, manual="apply with --status-checks <CI job names> (names as shown in a PR's checks list)")
    rs = active_rulesets(R, "branch")
    if rs is not None:
        al = [(x["name"], b) for x in rs if ref_matches((x.get("conditions") or {}).get("ref_name", {}).get("include", []), f"refs/heads/{st['default_branch']}")
              for b in x.get("bypass_actors", []) if b.get("bypass_mode") == "always"]
        f.check("R-BR-06", not al, "no unconditional bypass", f"bypass 'always' on branch rules: {al} (use pull_request mode)")
    else:
        f.add("R-BR-06", "unknown", "rulesets unreadable")

    # --- tags
    tags = R.get("tag_count_first_page")
    trs = active_rulesets(R, "tag")
    if isinstance(tags, int) and tags == 0:
        f.add("R-TAG-01", "na", "repo has no tags")
    elif trs is None:
        f.add("R-TAG-01", "unknown", "rulesets unreadable")
    else:
        tb = B["tag"]
        types = set()
        for x in trs:
            if ref_matches((x.get("conditions") or {}).get("ref_name", {}).get("include", []), "refs/tags/v1.0.0"):
                types |= {r["type"] for r in x["rules"]}
        miss = [t for t in tb["required_rules"] if t not in types]
        mine = next((x for x in trs if x["name"] == "release tags"), None)
        if mine:
            body = {"name": mine["name"], "target": "tag", "enforcement": "active", "conditions": mine["conditions"],
                    "bypass_actors": mine.get("bypass_actors", []), "rules": mine["rules"] + [{"type": t} for t in miss]}
            tfix = [call("ruleset-tags", "PUT", f"repos/{full}/rulesets/{mine['id']}", body)]
        else:
            body = {"name": "release tags", "target": "tag", "enforcement": "active",
                    "conditions": {"ref_name": {"include": [tb["pattern"]], "exclude": []}},
                    "bypass_actors": [{k: tb["bypass_actor"][k] for k in ("actor_id", "actor_type", "bypass_mode")}],
                    "rules": [{"type": t} for t in tb["required_rules"]]}
            tfix = [call("ruleset-tags", "POST", f"repos/{full}/rulesets", body)]
        f.check("R-TAG-01", not miss, f"v* tags: {sorted(types)}", f"tags v* missing rules {miss}", tfix)

    # --- repo settings & code security
    f.check("R-SET-01", st.get("delete_branch_on_merge") is rb["delete_branch_on_merge"], "on", "off",
            [call("repo-patch-dbom", "PATCH", base, {"delete_branch_on_merge": True})])
    sa = st.get("security_and_analysis")
    if sa:
        def en(k):
            return (sa.get(k) or {}).get("status") == "enabled"
        f.check("R-SEC-01", en("secret_scanning"), "enabled", "disabled",
                [call("repo-sa", "PATCH", base, {"security_and_analysis": {"secret_scanning": {"status": "enabled"}, "secret_scanning_push_protection": {"status": "enabled"}}})])
        f.check("R-SEC-02", en("secret_scanning_push_protection"), "enabled", "disabled",
                [call("repo-sa", "PATCH", base, {"security_and_analysis": {"secret_scanning": {"status": "enabled"}, "secret_scanning_push_protection": {"status": "enabled"}}})])
    else:
        f.add("R-SEC-01", "unknown", "security_and_analysis not visible (private repo without GitHub Secret Protection, or no admin)")
        f.add("R-SEC-02", "unknown", "same")
    va = C.get("vulnerability_alerts_enabled")
    f.check("R-SEC-03", (True if ok(va) else (False if isinstance(va, dict) and va.get("_status") == 404 else None)), "enabled", "disabled",
            [call("repo-va", "PUT", f"{base}/vulnerability-alerts")])
    asf = C.get("automated_security_fixes")
    f.check("R-SEC-04", asf.get("enabled") if ok(asf) else None, "enabled", "disabled",
            [call("repo-asf", "PUT", f"{base}/automated-security-fixes")])
    pv = C.get("private_vulnerability_reporting")
    if pub:
        f.check("R-SEC-05", pv.get("enabled") if ok(pv) else None, "enabled", "disabled", [call("repo-pvr", "PUT", f"{base}/private-vulnerability-reporting")])
    cs = C.get("code_scanning_default_setup")
    dyn = any("code-scanning" in (w.get("path") or "") or "codeql" in (w.get("path") or "").lower() for w in A.get("workflows", []))
    f.check("R-SEC-06", (cs.get("state") == "configured" or dyn) if ok(cs) else None, "configured", "code scanning not configured (default setup or CodeQL workflow)",
            manual="Repo Settings > Code security > Code scanning: set up default (free on public repos)")
    eco = R.get("dependabot_ecosystems", [])
    if R["files_present"].get(".github/dependabot.yml") or R["files_present"].get(".github/dependabot.yaml"):
        need = rb["dependabot_ecosystems_include_github_actions"] and any((w.get("path") or "").startswith(".github/workflows/") for w in A.get("workflows", []))
        f.check("R-SEC-07", ("github-actions" in eco) or not need, f"ecosystems {eco}", f"workflows exist but dependabot ecosystems {eco} lack github-actions")
    else:
        f.add("R-SEC-07", "fail", "no .github/dependabot.yml", manual="add dependabot.yml (see reference repo)")

    # --- Actions
    perm, sel, tok, fk = A.get("permissions"), A.get("selected_actions"), A.get("workflow_token"), A.get("fork_pr_contributor_approval")
    uses = sorted({u for w in A.get("workflows", []) for u in ((w.get("analysis") or {}).get("uses") or [])})
    has_uses = any("uses" in (w.get("analysis") or {}) for w in A.get("workflows", []))
    existing = sel.get("patterns_allowed", []) if ok(sel) else []
    derived = sorted(set(existing) | {to_pattern(u) for u in uses})
    f.check("R-ACT-01", (perm.get("enabled") and perm.get("allowed_actions") == "selected") if ok(perm) else None, "selected",
            f"enabled={perm.get('enabled') if ok(perm) else '?'} allowed_actions={perm.get('allowed_actions') if ok(perm) else '?'}",
            [call("repo-actperm", "PUT", f"{base}/actions/permissions", {"enabled": True, "allowed_actions": "selected"}, True, "may block workflows that use actions not in the allowlist"),
             call("repo-selected", "PUT", f"{base}/actions/permissions/selected-actions",
                  {"github_owned_allowed": False, "verified_allowed": False, "patterns_allowed": derived}, True, "allowlist derived from actions the repo's workflows use today")] if has_uses or not uses else None)
    if ok(sel):
        wild = [p for p in existing if p in ("*", "*/*", "*@*")]
        f.check("R-ACT-02", sel.get("github_owned_allowed") is False and sel.get("verified_allowed") is False and not wild,
                f"{len(existing)} explicit patterns", f"github_owned={sel.get('github_owned_allowed')} verified={sel.get('verified_allowed')} wildcards={wild}",
                [call("repo-selected", "PUT", f"{base}/actions/permissions/selected-actions",
                      {"github_owned_allowed": False, "verified_allowed": False, "patterns_allowed": derived}, True,
                      "allowlist = existing patterns + actions used by workflows today")] if has_uses or not uses else None)
        if has_uses:
            unc = [u for u in uses if not covers(existing, u)]
            f.check("R-ACT-11", not unc, "all used actions covered", f"used but not allowed (will fail at runtime): {unc}",
                    [call("repo-selected", "PUT", f"{base}/actions/permissions/selected-actions",
                          {"github_owned_allowed": False, "verified_allowed": False, "patterns_allowed": derived}, True, "add used actions")])
    elif ok(perm) and perm.get("allowed_actions") == "selected":
        f.add("R-ACT-02", "unknown", "allowlist unreadable")
    else:
        f.add("R-ACT-02", "fail" if ok(perm) else "unknown", "no allowlist because all actions are allowed")
    if ok(tok):
        tfix = [call("repo-token", "PUT", f"{base}/actions/permissions/workflow", {"default_workflow_permissions": ab["default_workflow_permissions"], "can_approve_pull_request_reviews": False},
                     tok.get("default_workflow_permissions") != ab["default_workflow_permissions"], "workflows relying on a write default token will fail")]
        f.check("R-ACT-03", tok.get("default_workflow_permissions") == ab["default_workflow_permissions"], ab["default_workflow_permissions"], f"{tok.get('default_workflow_permissions')}", tfix)
        f.check("R-ACT-04", tok.get("can_approve_pull_request_reviews") is False, "no", "workflows may approve PRs", tfix)
    else:
        f.add("R-ACT-03", "unknown", "unreadable")
        f.add("R-ACT-04", "unknown", "unreadable")
    f.check("R-ACT-05", fk.get("approval_policy") == ab["fork_pr_contributor_approval"] if ok(fk) else None, "all_external_contributors",
            f"{fk.get('approval_policy') if ok(fk) else '?'}",
            [call("repo-fork", "PUT", f"{base}/actions/permissions/fork-pr-contributor-approval", {"approval_policy": ab["fork_pr_contributor_approval"]})])
    wfs = [w for w in A.get("workflows", []) if (w.get("analysis") or {}) and w["analysis"] is not None]
    if wfs or not A.get("workflows"):
        unp = {w["path"]: w["analysis"]["unpinned_actions"] for w in wfs if w["analysis"]["unpinned_actions"]}
        f.check("R-ACT-06", not unp, f"{len(wfs)} workflow(s), all pinned", f"unpinned: {unp}", manual="pin to full commit SHA (Dependabot github-actions keeps them current)")
        np_ = [w["path"] for w in wfs if not w["analysis"]["top_level_permissions"]]
        f.check("R-ACT-07", not np_, "all declare permissions", f"no top-level permissions: {np_}", manual="add `permissions: {contents: read}` at top level")
        prt = [w["path"] for w in wfs if w["analysis"]["triggers_pull_request_target"] or w["analysis"]["triggers_workflow_run"]]
        inj = [w["path"] for w in wfs if w["analysis"]["has_script_injection_risk"]]
        f.check("R-ACT-08", not prt and not inj, "none", f"pull_request_target/workflow_run: {prt}; untrusted ${{{{ }}}} in run: {inj} (review: never check out PR code with secrets)",
                manual="review each workflow manually")
        sh = [w["path"] for w in wfs if w["analysis"]["uses_self_hosted_runner"]]
        f.check("R-ACT-09", not (sh and pub), "none", f"self-hosted runner in public repo: {sh} (fork PRs could run code on it)",
                manual="restrict the runner group to these workflows (org runner groups) and require approval for all outside contributors")
    envs = A.get("environments")
    if ok(envs) and isinstance(envs, dict) and "environments" in envs:
        bad_e = [e["name"] for e in envs["environments"] if not e.get("deployment_branch_policy") and e["name"] != "github-pages"]
        f.check("R-ACT-10", not bad_e, f"{len(envs['environments'])} environment(s)", f"no deployment branch policy: {bad_e}", manual="Settings > Environments > Deployment branches")

    # --- files
    for cid, names in (("R-FILE-01", ["SECURITY.md", ".github/SECURITY.md"]), ("R-FILE-02", [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"])):
        f.check(cid, any(R["files_present"].get(n) for n in names), "present", f"missing ({names[0]})", manual="add file; see reference repo")
    if pub:
        f.check("R-FILE-03", bool(R["files_present"].get("LICENSE")) or bool(st.get("license")), "present", "missing")

    # --- access
    dk = R.get("deploy_keys")
    f.check("R-ACC-01", all(k.get("read_only") for k in dk) if isinstance(dk, list) else None, f"{len(dk) if isinstance(dk, list) else '?'} key(s), read-only",
            f"write deploy keys: {[k['title'] for k in dk if not k.get('read_only')] if isinstance(dk, list) else ''}", manual="delete or replace with a scoped GitHub App / read-only key")
    wh = R.get("webhooks")
    if isinstance(wh, list):
        pr = [h for h in wh if h.get("insecure_ssl") in ("1", 1, True) or not h.get("host", "").startswith("https://") or not h.get("has_secret")]
        f.check("R-ACC-02", not pr, f"{len(wh)} webhook(s)", f"webhooks without https/secret or with insecure_ssl: {pr}", manual="edit webhook")
    else:
        f.add("R-ACC-02", "unknown", "unreadable")
    inv, col = R.get("pending_invitations"), R.get("collaborators") or []
    admins = [c["login"] for c in col if c.get("role_name") == "admin"]
    f.check("R-ACC-03", (not inv and len(admins) <= 2) if isinstance(inv, list) else None, f"admins {admins}", f"pending invitations {inv}; admins {admins}")


# ------------------------------------------------------------------ driver
def gather(args):
    """Return snapshot-shaped dict, from file or live."""
    if args.snapshot:
        return json.load(open(args.snapshot))
    t = args.target
    snap = {"target": t, "repos": {}}
    if "/" in t:
        snap["repos"][t] = collect_repo(t)
    else:
        snap["org"] = collect_org(t)
        if args.all:
            for full in list_org_repos(t):
                print(f"  collecting {full}", file=sys.stderr)
                snap["repos"][full] = collect_repo(full)
    snap["gaps"] = GAPS
    return snap


def run_checks(snap, B, status_checks=None):
    out = []
    if snap.get("org"):
        check_org(snap["org"].get("settings", {}).get("login", snap["target"]), snap["org"], B, out)
    for full, R in (snap.get("repos") or {}).items():
        check_repo(full, R, B, out, status_checks)
    return out


def report(findings, show_pass=False):
    order = {"fail": 0, "unknown": 1, "accepted": 2, "pass": 3, "na": 4}
    scopes = []
    for fd in findings:
        if fd["scope"] not in scopes:
            scopes.append(fd["scope"])
    for sc in scopes:
        rows = sorted([x for x in findings if x["scope"] == sc], key=lambda x: (order[x["status"]], -SEV[x["severity"]], x["id"]))
        n = {k: sum(1 for x in rows if x["status"] == k) for k in order}
        print(f"\n== {sc}   fail {n['fail']} | unknown {n['unknown']} | accepted {n['accepted']} | pass {n['pass']}")
        for x in rows:
            if x["status"] in ("pass", "na") and not show_pass:
                continue
            msg = x["message"] if len(x["message"]) < 260 else x["message"][:257] + "..."
            tag = {"fail": "FAIL", "unknown": "????", "accepted": "ACPT", "pass": "ok  ", "na": "n/a "}[x["status"]]
            fixes = "auto-fix" if x["fix"] else ("manual" if x["status"] == "fail" else "")
            print(f"  [{tag}] {x['severity']:<6} {x['id']:<9} {x['title']}: {msg}  ({fixes})" if fixes else
                  f"  [{tag}] {x['severity']:<6} {x['id']:<9} {x['title']}: {msg}")
            if x["status"] == "fail" and x["manual"] and not x["fix"]:
                print(f"           how: {x['manual']}")


def do_audit(args, B):
    snap = gather(args)
    fs = run_checks(snap, B)
    report(fs, args.verbose)
    if args.json:
        json.dump({"generated": datetime.now(timezone.utc).isoformat(), "findings": fs}, open(args.json, "w"), indent=2)
    thr = SEV[args.fail_on]
    return 1 if any(x["status"] == "fail" and SEV[x["severity"]] >= thr for x in fs) else 0


def do_apply(args, B):
    if args.snapshot and args.yes:
        sys.exit("refusing to apply from a stored snapshot: state may have changed. Drop --snapshot to use live data.")
    snap = gather(args)
    only = set(args.only.split(",")) if args.only else None
    skip = set(args.skip.split(",")) if args.skip else set()
    fs = run_checks(snap, B, args.status_checks.split(",") if args.status_checks else None)
    plan, seen, skipped = [], set(), []
    for x in fs:
        if x["status"] != "fail" or not x["fix"] or x["id"] in skip or (only and x["id"] not in only):
            continue
        for c in x["fix"]:
            k = (x["scope"], c["key"])
            if k in seen:
                continue
            seen.add(k)
            if c["risky"] and not args.include_risky:
                skipped.append((x, c))
            else:
                plan.append((x, c))
    print(f"\n{'APPLYING' if args.yes else 'DRY RUN (add --yes to execute)'}: {len(plan)} change(s), {len(skipped)} risky skipped\n")
    log = []
    for x, c in plan:
        print(f"* {x['scope']} {x['id']}: {c['method']} {c['path']}" + (f"   # {c['why']}" if c["why"] and c["risky"] else ""))
        if c["body"] is not None:
            print("    " + json.dumps(c["body"])[:400])
        entry = {"time": datetime.now(timezone.utc).isoformat(), "scope": x["scope"], "check": x["id"], "before": x["message"], **{k: c[k] for k in ("method", "path", "body")}}
        if args.yes:
            p = subprocess.run([GH, "api", "--method", c["method"], c["path"], "--input", "-"] if c["body"] is not None else [GH, "api", "--method", c["method"], c["path"]],
                               input=json.dumps(c["body"]) if c["body"] is not None else None, capture_output=True, text=True)
            entry["ok"], entry["response"] = p.returncode == 0, (p.stdout or p.stderr)[:500]
            print("    -> " + ("ok" if entry["ok"] else "FAILED: " + entry["response"][:200]))
        log.append(entry)
    for x, c in skipped:
        print(f"- SKIPPED (risky, use --include-risky) {x['scope']} {x['id']}: {c['method']} {c['path']}  # {c['why']}")
    manual = [x for x in fs if x["status"] == "fail" and not x["fix"]]
    if manual:
        print(f"\nReport-only ({len(manual)}): " + ", ".join(sorted({f"{x['id']}" for x in manual})) + "  (run `audit` for details)")
    if args.yes and log:
        name = f"apply-log-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        json.dump(log, open(name, "w"), indent=2)
        print(f"\nlog: {name}")
    return 0


def snapshot_main(a):
    if subprocess.run([GH, "auth", "status"], capture_output=True).returncode != 0:
        sys.exit("gh is not authenticated: run `gh auth login` or set GH_TOKEN")
    os.makedirs(a.out, exist_ok=True)
    snap, md = {"generated": datetime.now(timezone.utc).isoformat(), "target": a.target, "mode": a.kind}, []
    if a.kind == "repo":
        snap["repos"] = {a.target: collect_repo(a.target)}
        md += md_repo(a.target, snap["repos"][a.target])
        name = a.target.replace("/", "__")
    else:
        snap["org"] = collect_org(a.target)
        md += md_org(a.target, snap["org"])
        name = a.target
        if a.kind == "all":
            snap["repos"] = {}
            for full in list_org_repos(a.target):
                print(f"  repo {full}", file=sys.stderr)
                snap["repos"][full] = collect_repo(full)
                md += md_repo(full, snap["repos"][full])
            name += "__all"
    snap["gaps"] = GAPS
    if GAPS:
        md += ["## Gaps (token could not read)", ""] + [f"- {g['scope']}: `{g['endpoint']}` -> {g['status']}" for g in GAPS]
    with open(f"{a.out}/{name}.json", "w") as f:
        json.dump(snap, f, indent=2, sort_keys=True)
    with open(f"{a.out}/{name}.md", "w") as f:
        f.write("\n".join(md) + "\n")
    print(f"wrote {a.out}/{name}.json and .md  ({len(GAPS)} endpoints not readable)")


def main():
    ap = argparse.ArgumentParser(prog="gh-baseline", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="mode", required=True)
    sp = sub.add_parser("snapshot", help="read-only snapshot of a repo, an org, or an org with all its repos")
    sp.add_argument("kind", choices=["repo", "org", "all"])
    sp.add_argument("target")
    sp.add_argument("--out", default="snapshots")
    for name in ("audit", "apply"):
        p = sub.add_parser(name, help=f"{name} the policy on an org or repo")
        p.add_argument("target", nargs="?", help="ORG or OWNER/REPO")
        p.add_argument("--all", action="store_true", help="with ORG: also every repo")
        p.add_argument("--policy", required=True, help="policy file: checks and values, see policy.example.json")
        p.add_argument("--snapshot", help="use a `gh-baseline snapshot` JSON file instead of live data")
        if name == "audit":
            p.add_argument("--json", help="write findings here")
            p.add_argument("--fail-on", default="high", choices=list(SEV))
            p.add_argument("-v", "--verbose", action="store_true", help="also list passing checks")
        else:
            p.add_argument("--yes", action="store_true", help="execute (default: dry run)")
            p.add_argument("--only"), p.add_argument("--skip")
            p.add_argument("--status-checks", help="required status check names for a new default-branch ruleset")
            p.add_argument("--include-risky", action="store_true")
    a = ap.parse_args()
    if a.mode == "snapshot":
        return snapshot_main(a)
    if not a.target and not a.snapshot:
        ap.error("target required")
    try:
        B = json.load(open(a.policy))
    except (OSError, ValueError) as e:
        print(f"policy error: cannot read {a.policy}: {e}", file=sys.stderr)
        sys.exit(2)
    if a.snapshot:
        a.target = a.target or json.load(open(a.snapshot)).get("target", "")
    elif subprocess.run([GH, "auth", "status"], capture_output=True).returncode != 0:
        sys.exit("gh is not authenticated: gh auth login")
    sys.exit(do_audit(a, B) if a.mode == "audit" else do_apply(a, B))


if __name__ == "__main__":
    main()
