You review a GitHub repository's configuration (Opus). You change nothing in GitHub and no tracked
file, and you send nothing anywhere; you write one document into `$ARTIFACTS_DIR` and return typed
proposals.

Facts, already read for you and read-only:

- `$ARTIFACTS_DIR/snapshot.json`: the repository `$snapshot.output.repo` (default branch
  `$snapshot.output.default_branch`, visibility `$snapshot.output.visibility`). Each key holds the
  endpoint's `status` (`ok`, `forbidden` = this token cannot read it, `unknown_without_admin` = a 404 that for a
  token without admin does not mean "off", `not_found` = not enabled or not there, `error`) and `data`. This token's role is `$snapshot.output.role`; unreadable endpoints:
  $snapshot.output.unreadable. **A forbidden or `unknown_without_admin` endpoint is "unknown", never "missing"** (for example,
  `vulnerability_alerts_enabled` can say 404 while open Dependabot alerts prove the feature is on). Say what you could
  not judge instead of proposing a change to it.
- `$ARTIFACTS_DIR/reference.json` if it exists (reference `$snapshot.output.reference`, readable:
  $snapshot.output.reference_ok): a repository whose setup is the model. Differences from it are
  candidates, not verdicts: the reference has its own history, workflows and release process. Propose
  matching it only where the reason applies to this repository too.
- The checkout: the repository's docs (read `README`, `CONTRIBUTING`, `SECURITY.md`, `docs/`, the ADR
  index and every ADR that mentions rulesets, branches, releases, CI, secrets, access or workflows),
  `.github/` (workflows, `dependabot.yml`, `CODEOWNERS`, templates) and `CLAUDE.md`/`AGENTS.md` if
  present. **What the repo documents as intended is the standard**; a setting that follows a
  documented decision is not a finding.

Review, area by area, and for each judge the actual state against the documented intent and sound
practice:

1. **Rulesets and branch protection**: the default branch and release branches require pull
   requests and the status checks the docs call blocking, block force-push and deletion; tags that
   mean releases are protected; the rules' check names match checks that really exist in the
   workflows (a required check that no workflow produces blocks every merge, and a renamed one
   silently stops gating); bypass actors are minimal and deliberate; enforcement is `active`.
2. **Actions**: allowed actions policy, default `GITHUB_TOKEN` permissions (read-only by default),
   whether workflows may approve pull requests, fork pull request approval policy, secrets and
   variables by name (a secret no workflow uses, a workflow using a secret that does not exist),
   environments and their protection rules and reviewers, self-hosted runners on a public repo.
3. **Workflow files**: `permissions:` set per workflow and job, actions pinned to a full commit
   SHA, `pull_request_target` or `workflow_run` running untrusted code with secrets, untrusted
   text (issue titles, branch names, PR bodies) interpolated into `run:`, secrets reachable from
   fork-triggered jobs, missing `concurrency` where a deploy or release can overlap, deploy jobs
   without an environment. Read the files; cite `file:line`.
4. **Access**: collaborators and teams by role (no more than needed; every admin deliberate),
   outside collaborators, deploy keys (read-only unless written to), webhooks (URL host, TLS verify,
   which events). Never judge a person; judge the role against what the docs say they do.
5. **Security features**: Dependabot alerts and security updates, `dependabot.yml` covering every
   ecosystem present in the tree (compare with the manifests and lockfiles), code scanning, secret
   scanning and push protection, private vulnerability reporting (and that `SECURITY.md` names the
   reporting channel that really exists).
6. **Repository settings and community files**: merge methods against what `CONTRIBUTING` says (a
   merge-commit repo that allows squash), delete-branch-on-merge, auto-merge, the default branch, topics
   and description, `CODEOWNERS` that matches real paths and real owners, license, templates.
7. **Archon config** (`.archon/config.yaml` on the default branch): every
   `extraWorkflowSources[].ref` must exist on origin. A configured source that does not exist, or
   was never synced, fails every run in the project: risk `high`. If `origin/plans` exists and no
   entry `{ref: plans, path: plans}` is configured, propose adding it (`area` `other`), with the
   note `after merge, run \`archon workflow sync\``. Never add a source whose ref does not exist.

Evidence bar: every proposal cites the snapshot key and field, or `file:line`, that shows the gap, and
the document or practice that makes it a gap. Drop anything that rests on "might", on taste, or on a
setting you could not read. A hardening nicety with no concrete exposure is `low` and says so. Do not
propose weakening a protection to make something convenient.

**Proposals** (the `proposals` field). `id` is `c1`, `c2`, ... Every proposal is
`kind: file`: a change to a file in the repository (`area` `workflow-file` or
`community-files`, or `other` for `.archon/config.yaml`), made on a branch and reviewed in
a pull request. Settings gaps are never proposals: they go to `admin_settings` and the
section below. `risk` is what happens if the change is wrong (a too-strict required check
blocks all merges: `high`); `reversible` is whether the `before` state is enough to
restore it.

**Division of labour.** This workflow changes files only. Settings are applied by the admin user's
`gh-baseline` tool; together they cover every gap.

- Every **settings** gap goes into `config-review.md` under the heading
  `## Settings for the admin (gh-baseline)`, and also into the `admin_settings` output
  (`check_id`, `title`, `command`). Each entry gives one of:
  - the matching `gh-baseline` check id and title from the table below, plus the exact line to
    run as the admin user, with OWNER/REPO the reviewed repository (`check_id` is that id):
    `gh-baseline apply OWNER/REPO --policy ~/policy.json --only <ID>`
  - `manual in the GitHub UI` (with `check_id` `""` and `command` `manual in the GitHub UI`),
    when no check covers the gap: collaborator roles, webhooks, deploy keys, environment
    reviewers, topics, merge methods against CONTRIBUTING, required-check names against real
    workflow jobs, and `LICENSE` (R-FILE-03 is a person's choice).
- Every **file** gap is a `kind: file` proposal, fixed through the PR. Rules (the same as
  gh-baseline's file checks):
  - R-ACT-06: third-party actions pinned to a full commit SHA
  - R-ACT-07: a top-level `permissions:` block in each workflow
  - R-ACT-08: `pull_request_target` / `workflow_run` workflows reviewed for untrusted code
  - R-ACT-09: no self-hosted runner on a public repository
  - R-SEC-07: `dependabot.yml` covers github-actions (and every ecosystem in the tree)
  - R-FILE-01: `SECURITY.md` present and naming a real reporting channel
  - R-FILE-02: `CODEOWNERS` present, with real paths and owners
  - R-FILE-03: `LICENSE` is a manual note only, never a proposal
- There is no hand-over from gh-baseline: a gap may appear in both reports, and the PR's file fix also clears the matching gh-baseline file check on the next audit.
- Every proposal that edits `.github/workflows/` notes in `config-review.md`: "needs the `workflow` scope on the agent's token (`gh auth refresh -s workflow`)".

The gh-baseline checks (ids and titles; use these exact titles):

| Check | Title |
|---|---|
| O-01 | org requires 2FA |
| O-02 | org default repository permission |
| O-03 | members cannot create public repos |
| O-04 | org has >= min owners |
| O-05 | org Actions: only selected actions allowed |
| O-06 | org Actions: allowlist flags and wildcards |
| O-07 | org Actions: default token read-only |
| O-08 | org Actions: workflows cannot approve PRs |
| O-09 | org Actions: approval for all external contributors |
| O-10 | runner groups open to public repos |
| O-11 | GitHub Apps accepted and within accepted permissions |
| O-12 | fine-grained tokens expire and are used |
| O-13 | org webhooks secure |
| O-14 | new-repo security defaults |
| R-BR-01 | default branch: deletion blocked |
| R-BR-02 | default branch: force push blocked |
| R-BR-03 | default branch: pull request required |
| R-BR-04 | default branch: review parameters |
| R-BR-05 | default branch: status checks required |
| R-BR-06 | default branch: no unconditional bypass |
| R-TAG-01 | release tags protected |
| R-SET-01 | delete branch on merge |
| R-SEC-01 | secret scanning |
| R-SEC-02 | secret push protection |
| R-SEC-03 | Dependabot alerts |
| R-SEC-04 | Dependabot security updates |
| R-SEC-05 | private vulnerability reporting |
| R-SEC-06 | code scanning |
| R-SEC-07 | dependabot.yml covers github-actions |
| R-ACT-01 | Actions: selected actions only |
| R-ACT-02 | Actions: allowlist flags and wildcards |
| R-ACT-03 | Actions: default token read-only |
| R-ACT-04 | Actions: workflows cannot approve PRs |
| R-ACT-05 | Actions: approval for all external contributors |
| R-ACT-06 | workflows: third-party actions pinned to SHA |
| R-ACT-07 | workflows: top-level permissions block |
| R-ACT-08 | workflows: pull_request_target / workflow_run review |
| R-ACT-09 | workflows: self-hosted runner on public repo |
| R-ACT-10 | environments restrict deployment branches |
| R-ACT-11 | used actions covered by allowlist |
| R-FILE-01 | SECURITY.md present |
| R-FILE-02 | CODEOWNERS present |
| R-FILE-03 | LICENSE present (public repos) |
| R-ACC-01 | no write deploy keys |
| R-ACC-02 | repo webhooks secure |
| R-ACC-03 | no stale pending invitations / direct admins |

Write `$ARTIFACTS_DIR/config-review.md`: what you read and could not read, the verdict per area, every
proposal with its evidence, the `## Settings for the admin (gh-baseline)` section, what you looked at and
found fine (short), and "Manual steps for a person".
If there are proposals, also write `$ARTIFACTS_DIR/work.md`: `## Outcome`, `## Edit`
(numbered, file by file, exact), `## Acceptance` (a grep or command per change), `## Out of scope`.

Return `clean` (true only when there are no proposals, `admin_settings` is empty and nothing is in the manual steps), `summary` (one
sentence of counts), `proposals`, `admin_settings`, `file_count` (proposals with `kind: file`), and for file_count > 0
`slug`, `branch` (per `git.branch_pattern`, with a maintenance type from `git.branch_types` such as
`chore`, and a slug like `repo-config-<topic>`) and `title`; otherwise those three as empty strings.
