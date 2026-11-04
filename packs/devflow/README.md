# devflow pack for Archon

Six workflows built on the devflow toolkit ([andras-tkcs/claude-toolkit](https://github.com/andras-tkcs/claude-toolkit)),
for any repository that has a devflow profile (`.claude/toolkit.yaml`). The pack holds no project
facts: branch rules, checks, docs to read, changelog and CI come from the profile, and the project's
environment comes from its own SessionStart hook.

`bootstrap.sh` installs it as an Archon plugin for the agent user, so every project on the runner can
use it. Installed, its workflows are named `<owner>/devflow:<workflow>`, for example
`tkcs-lab/devflow:devflow-ship`.

The repository moved from the `andras-tkcs` org to `tkcs-lab`. A runner bootstrapped before that
still has the pack installed as `andras-tkcs/archon-work/packs/devflow`, with workflows named
`andras-tkcs/devflow:*`. Re-running `bootstrap.sh` installs the pack again under the new source. To
keep one copy, remove the old one with `archon plugin` or set `DEVFLOW_PACK` to the old source.

| Workflow | Use it for | Pauses for a person when |
|---|---|---|
| `devflow-ship` | An issue or change that needs a plan, through to a merged PR | The planner has a decision only you can make, or `manual_before` steps to confirm |
| `devflow-quick` | A small edit with no plan (a typo, a one-file fix); refuses anything bigger | Never; it cancels with the reason if the edit is not small |
| `devflow-docs` | Review the docs and the website, fix what is wrong | Never; undecidable items are listed in the PR |
| `devflow-audit` | Security audit, then verify the findings, plan and fix them | The verifier leaves a decision to the maintainer |
| `devflow-config` | Review a repo's rulesets, Actions, access and security settings and workflow files; apply what you approve | Choosing which settings changes to apply (needs an admin token) |
| `devflow-deps` | Repair and push Dependabot PRs; fix vulnerability alerts no PR covers | Never; PRs it cannot fix are handed to a person with the evidence |

`devflow-tail` is the shared building block (review, fixes, definition of done, PR, watch) that the
first three include (`devflow-audit` reaches it through `devflow-ship`); it is not run on its own. No
workflow merges.

## Run it

```bash
cd /path/to/a/registered/repo
archon workflow run tkcs-lab/devflow:devflow-ship "Fix https://github.com/<owner>/<repo>/issues/<n>" --detach
```

From the web UI or chat, ask for `devflow-ship` with the issue or the description.
`--input scope=...` focuses `devflow-docs` and `devflow-audit`; `--input reference=<owner>/<name>`
gives `devflow-config` a repository whose setup to compare against.

## What a project needs

- `.claude/toolkit.yaml`, the devflow profile (copy the toolkit's `templates/toolkit.yaml`). It must
  validate with the toolkit's `validate_profile.py`, and must have `verify.fast` and `verify.dod`.
- Optionally, a SessionStart hook in `.claude/settings.json`. The `setup` node runs every SessionStart
  command hook (no matcher, or one that admits `startup`) in the run's worktree with
  `CLAUDE_CODE_REMOTE=true`, `CLAUDE_PROJECT_DIR` and `CLAUDE_ENV_FILE` set, the way a fresh
  Claude Code cloud session would. That is where the project builds its venv, installs
  `node_modules` and so on; what the hook exports through `CLAUDE_ENV_FILE` (a `PATH` with the venv,
  for example) is written to `project-env.sh` in the run's artifacts, which the checks load and the
  agents source before project commands. A hook that exits non-zero fails the run before any
  model is called. Without a hook nothing is installed, and checks whose tools are missing show up
  as `UNAVAILABLE` (definition of done) or red (fast checks).

Before that, `setup` restores full history and tags (`git fetch --unshallow --force --tags`), which
version tools such as `setuptools_scm` need. Origin's tags win: a tag re-pointed upstream replaces
the local one, as in a fresh clone.

## Host requirements

`preflight` checks these before any model is called: the devflow toolkit installed for the user
running Archon (a Claude Code plugin, from claude.ai or the `claude-toolkit` marketplace), a valid
profile, `gh` authenticated, and `python3` with PyYAML for the toolkit's validators. Script nodes need
`bun`. `bootstrap.sh` provides all of them. Anything else a project's hook or checks call (`uv`,
`node`/`npm`, a compiler) must be on the host: commands the host cannot run are reported as
`UNAVAILABLE` in the definition of done and in the PR body, never ticked; CI runs them.

## devflow-ship, step by step

1. **make-plan** (large tier): researches and writes `plan.md` with an implementation manifest,
   validated by the toolkit's `validate_manifest.py`. When a decision is the user's, or
   `manual_before` steps need confirming, the run pauses in the attention queue and replans with the
   answer.
2. **implement** (medium tier): one fresh session per phase, each followed by the profile's
   `verify.fast`. Large plans merge each phase `--no-ff` with a `Plan-Phase:` trailer, as `/implement`
   does. A gate then checks that every manifest phase landed and the fast checks are green.
3. **review** (large tier, fresh context) with the `review-checklist` and `secure-code-review` skills.
4. **fix blocking**: fix, then review again, up to three reviews. A gate fails the run if blocking
   findings remain.
5. **fix non-blocking**: each finding is fixed or declined with a reason; the PR body quotes the table.
6. **definition of done** (`verify.dod`), then **one PR**, then a **watch** that polls every 10 minutes
   and hands conflicts, red checks, review threads and comments to a steward session. The steward
   follows `pr-steward` and the profile's `project_steward` file. Each item is handed over once per
   head, so a red check the steward could not fix waits for a person rather than looping. The run ends
   when a person merges or closes the PR. It never merges.

## Where it differs from the toolkit commands

- The plan is a run artifact, not a `plan/<slug>` branch. The retirement phase still writes the ADRs,
  docs and changelog line, but there is no plan document to delete.
- Phases run one after another in the run's worktree rather than as parallel cloud sessions.
- Questions for the user go through the attention queue instead of `AskUserQuestion`, and manual steps
  are written into the plan instead of an HTML artifact.
- Non-blocking findings are fixed or declined, rather than only listed in the PR body.
- The PR is watched until it merges, not only until it is green.

## The other workflows

- **devflow-quick** writes a short `work.md` instead of a plan, makes the edit in one session with
  `verify.fast`, then runs the tail. Its scoping agent refuses a change that needs a design decision,
  touches authentication, authorization, secrets or other security controls, meets the profile's ADR
  bar, adds an outside integration or bumps a dependency, and says to use `devflow-ship`.
- **devflow-docs** has a reviewer apply the `docs-review` checklist and measure (website build if
  there is one, documented commands, links, changelog coverage). The fixes become `work.md`; what is a
  product or wording decision goes to the PR's "Needs a person" section instead of into edits.
- **devflow-audit** runs an auditor, then a fresh verifier that tries to disprove every finding and
  decides fix, not doing or needs a decision, then includes `devflow-ship` with the surviving findings
  as the work. The findings never leave the run's artifacts: no issue, and the PR names the class of
  fix, not how to attack it.
- **devflow-config** snapshots the repository's configuration through the GitHub API (read-only; each
  endpoint records whether this token could read it, and a 404 for a non-admin token counts as
  unknown, not off), then a reviewer compares it with the repo's documented intent, its workflow files
  and, if `reference` is given, that repository. Settings changes go through an allow-list that
  refuses visibility, name, archiving, secrets, webhooks, deploy keys and removing an admin, then you
  choose which to apply; each call records the before and after in `config-changes.md`. Without admin
  the run ends with the review as a report. File changes (workflow files, `dependabot.yml`,
  `CODEOWNERS`) go through a PR and the shared tail.
- **devflow-deps** reads the open Dependabot PRs and alerts, reviews each PR as a supply-chain change
  (version jump, new transitive packages, install scripts, release notes), then repairs the chosen PRs
  one at a time on their own branches: checks run, locks regenerated with the repo's tool, fixes
  pushed to the Dependabot branch, CI read back, at most two attempts each. Alerts no PR covers are
  fixed on a new branch through the shared tail. It never merges and never dismisses an alert.

## Prove changes

```bash
scripts/test-devflow-pack.sh
```

It loads the pack as a project pack in a scratch repository, runs `archon validate workflows` and
replays every fixture with `archon workflow test`. Fixtures named for a red path
(`review-never-clears`, `dod-stays-red`, `not-small`, `nothing-to-fix`, ...) must stay red; the ones
that execute a gate set `exec-code: true`.

Adapted from the PrivacyFence pack ([privacyfence/privacyfence `.archon/`](https://github.com/privacyfence/privacyfence/tree/chore/archon-devflow-workflow/.archon)).
Its `devflow-release` is not here: it drives that project's own release script and build workflows.
