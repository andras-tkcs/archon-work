# devflow pack for Archon

Seven workflows (and the building blocks mod-devflow-phase and mod-devflow-deliver) built on the devflow toolkit ([andras-tkcs/claude-toolkit](https://github.com/andras-tkcs/claude-toolkit)),
for any repository that has a devflow profile (`.claude/toolkit.yaml`). The pack holds no project
facts: branch rules, checks, docs to read, changelog and CI come from the profile, and the project's
environment comes from its own SessionStart hook.

`bootstrap.sh` installs it as an Archon plugin for the agent user, so every project on the runner can
use it. Installed, its workflows are named `<owner>/devflow:<workflow>`, for example
`tkcs-lab/devflow:devflow-plan`.

The repository moved from the `andras-tkcs` org to `tkcs-lab`. A runner bootstrapped before that
still has the pack installed as `andras-tkcs/archon-work/packs/devflow`, with workflows named
`andras-tkcs/devflow:*`. Re-running `bootstrap.sh` installs the pack again under the new source. To
keep one copy, remove the old one with `archon plugin` or set `DEVFLOW_PACK` to the old source.

| Workflow | Use it for | Pauses for a person when |
|---|---|---|
| `devflow-plan` | An issue or change that needs a plan: interview, plan, then a published `devflow-run-<slug>` workflow that implements it | Up to 5 questions a round in at most 3 rounds; the run publishes the plan (marked incomplete if questions are still open) and you start `devflow-run-<slug>` after `archon workflow sync` |
| `devflow-refine` | Change a plan devflow-plan published, before its implementation starts: the same interview, then the plan and `devflow-run-<slug>` republished in place | Up to 5 questions a round in at most 3 rounds about what the change leaves open; it refuses a plan whose branch is on origin or that is merged |
| `devflow-quick` | A small edit with no plan (a typo, a one-file fix); refuses anything bigger | Never; it cancels with the reason if the edit is not small |
| `devflow-docs` | Review the docs and the website, fix what is wrong | Never; undecidable items are listed in the PR |
| `devflow-audit` | Security audit, then verify the findings, plan and fix them | The verifier leaves a decision to the maintainer |
| `devflow-config` | Review a repo's rulesets, Actions, access and security settings and workflow files; fix file gaps through a PR and list settings gaps for the admin | Never; settings changes are listed for the admin |
| `devflow-deps` | Repair and push Dependabot PRs; fix vulnerability alerts no PR covers | Never; PRs it cannot fix are handed to a person with the evidence |

**Renamed building blocks:** `devflow-phase`, `devflow-deliver`, `devflow-tail` and `devflow-audit-fix` are now `mod-devflow-phase`, `mod-devflow-deliver`, `mod-devflow-tail` and `mod-devflow-audit-fix`; the `mod-` prefix marks a workflow you never start yourself. The old names are gone, with no aliases. A `devflow-run-<slug>` published before the rename fails at its first phase, so run `devflow-plan` again for that plan, or edit its workflow file to the new names.

`mod-devflow-tail` is the shared building block (review, fixes, definition of done, PR, watch). It is
included by `devflow-quick`, `devflow-docs`, `devflow-config`, `devflow-deps`, `mod-devflow-audit-fix` (which
`devflow-audit` includes) and `mod-devflow-deliver`, and is not run on its own. `mod-devflow-phase` and `mod-devflow-deliver` are building
blocks too: a generated `devflow-run-<slug>` workflow starts them. No workflow merges.

## Run it

```bash
cd /path/to/a/registered/repo
archon workflow run tkcs-lab/devflow:devflow-plan "Fix https://github.com/<owner>/<repo>/issues/<n>" --detach
```

From the web UI or chat, ask for `devflow-plan` with the issue or the description.
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

## devflow-plan, step by step

1. **Interview** (medium tier): each round shows up to 5 numbered questions through the attention
   queue, the planner's and a fresh challenger's ranked together. Answer as `1: a, 2: c, …`.
   Skipped questions and those that did not fit come back next round. There are at most 3 rounds.
   Answer "publish" to end the questions and publish the plan as it is, or "stop" to abandon the
   run with nothing published. Questions still open at the end are taken at their recommended
   defaults (listed under `## Assumptions` and `## Open questions`), and the plan gets an
   "Incomplete plan" warning under its title.
2. **Plan** (medium tier): researches and writes `plan.md` with an implementation manifest, validated by the
   toolkit's `validate_manifest.py`. Each phase gets the smallest model tier that can do it
   (`small` by default, `medium` or `large` with a reason), and the plan gets a final-review
   tier: `large` for security-related changes, for a plan with a `large` phase or with 7 or more
   phases, else `medium`. A **Phases and models** table in plan.md shows them all. `manual_before` and `manual_after` steps become
   `prerequisites.md` and `after.md`.
3. **Render**: a deterministic renderer turns the validated manifest into
   `devflow-run-<slug>.yaml`, checked with `archon validate`. It checks that the installed pack has
   `mod-devflow-phase` and `mod-devflow-deliver` (the pack the run was started from,
   unless `--input pack=` names another).
4. **Test**:
   - The manifest validator runs again, and the generated workflow is dry-run with stubbed
     children.
   - A fresh reviewer on the large tier then walks every phase against the code: paths, symbols,
     acceptance and verify commands, open decisions. It also checks each phase's model tier and the
     final-review tier against the model rules.
   - Findings go back to the planner (medium tier) for up to two fix rounds. If findings remain
     (from the renderer, the manifest validator or the reviewer), the plan is still published, with
     them under "Unresolved validation findings" in its "Risks and open questions". When only
     reviewer findings remain, it carries a warning under its title, as before. When the renderer or
     the validator still rejects it, it carries the "Incomplete plan" warning instead, and its
     `devflow-run-<slug>` workflow is withheld (and an earlier one on the plans branch is removed)
     until devflow-refine fixes it. Only a plan without a usable manifest fails with nothing
     published (`test-findings.md` in the run's artifacts).
   - A decision the reviewer finds open is made by the planner and listed under `## Assumptions`
     in the plan and in `published.md`.
5. **Publish**: the plan and the workflow are pushed to the `plans` branch (never forced) under
   `plans/<slug>/` and `plans/workflows/`. `published.md` in the run's artifacts says what went
   where and how to start the workflow. The run does not run `archon workflow sync`; you do.

**Incomplete plans.** The warning's text says why the plan is incomplete. If the workflow was
published, running it accepts the defaults, and devflow-refine can no longer continue the plan.
Continue with `archon workflow run tkcs-lab/devflow:devflow-refine "refine <slug>" --detach` (the
bare slug is enough): it asks the open questions again and fixes the remaining findings.

Then run `devflow-run-<slug>`. It implements the phases up to three at a time, each as a
`mod-devflow-phase` child run in its own worktree on the phase's model tier, merged by SHA; then `mod-devflow-deliver` runs the
fast-check fixes and the build gate, and the shared tail (review on the plan's final-review tier, fixes, definition of done, one PR,
a watch every 10 minutes that hands conflicts, red checks and review threads to a steward session)
follows. The run ends when a person merges or closes the PR. It never merges.

Concurrent phase children each fetch tags in worktrees of one repository, so one can fail with
"cannot lock ref". Resume the parent run: Archon re-drives the failed child.

## devflow-refine, step by step

Use it to change a plan `devflow-plan` published, before anyone implements it:

```bash
archon workflow run tkcs-lab/devflow:devflow-refine "refine plans/<slug>: <what to change>" --detach
```

1. **Name the plan**: put its slug, `plans/<slug>` or its plan URL on the `plans` branch in the
   message, or pass `--input plan=<slug>`. Say what to change in the message or with
   `--input work=<change>`; for a plan marked incomplete the change may be left out.
2. **Refuse a started or merged plan**: it stops with a reason (for example `Not refined: the plan
   <slug> is already being implemented (its branch <branch> exists on origin). devflow-refine only
   changes plans whose implementation has not started.`) when the implementation branch is on
   origin, the plan is merged into the main branch, or a pull request from it was merged.
   The check runs again right before publishing.
3. **Interview**: it starts from the published plan and asks only what the change leaves open, in
   the same rounds and words as `devflow-plan` (and re-asks an incomplete plan's open questions
   first), then revises the plan with the same method as `devflow-plan`. It uses the same tiers and validation as
   `devflow-plan`, and adds phase and review tiers to an older plan that has none.
4. **Publish**: the slug, the branch and the workflow name stay the same. The refined plan and
   `devflow-run-<slug>.yaml` are republished in place on the `plans` branch in a
   `Refine <slug>: <title>` commit (never forced). A refine that still has
   blocking findings publishes the plan without its workflow.

Then run `archon workflow sync` and start `devflow-run-<slug>`. A `devflow-run-<slug>` run that is
already going keeps the plan it started with.

## Enable plan workflows in a project

This needs Archon 0.13.4 or later from `tkcs-lab/Archon` (`bootstrap.sh`'s default `ARCHON_REPO`) for `extraWorkflowSources`; upstream `coleam00/Archon` does not have it.

1. Run `devflow-plan` once in the project, so the `plans` branch exists.
2. On the default branch, add this to `.archon/config.yaml`, then run `archon workflow sync`:

   ```yaml
   extraWorkflowSources:
     - ref: plans
       path: plans
   ```

**Warning:** a configured source that was never synced fails every run in that project, so add the
config only after the branch exists. The `plans` branch is as public as the repository: keep
confidential work to `devflow-audit`, which never publishes.

Limits: a folder project has no worktree isolation, so the parallel phases need a git repository.
The generated workflow uses the pack the plan run was started from; pass `--input pack=<owner>/devflow` to target another installed pack.

## Where it differs from the toolkit commands

- Plans are published to the `plans` branch, not `plan/<slug>`. The retirement phase still writes the
  ADRs, docs and changelog line, but there is no plan document to delete.
- Phases run in parallel worktrees, as child runs of `devflow-run-<slug>`, rather than one after another.
- Questions for the user go through the attention queue instead of `AskUserQuestion`, and manual steps
  are written into the plan instead of an HTML artifact.
- Non-blocking findings are fixed or declined, rather than only listed in the PR body.
- The PR is watched until it merges, not only until it is green.

## The other workflows

- **devflow-quick** writes a short `work.md` instead of a plan, makes the edit in one session with
  `verify.fast`, then runs the tail. Its scoping agent refuses a change that needs a design decision,
  touches authentication, authorization, secrets or other security controls, meets the profile's ADR
  bar, adds an outside integration or bumps a dependency, and says to use `devflow-plan`.
- **devflow-docs** has a reviewer apply the `docs-review` checklist and measure (website build if
  there is one, documented commands, links, changelog coverage). The fixes become `work.md`; what is a
  product or wording decision goes to the PR's "Needs a person" section instead of into edits.
- **devflow-audit** runs an auditor, then a fresh verifier that tries to disprove every finding and
  decides fix, not doing or needs a decision, then includes `mod-devflow-audit-fix`, a confidential
  one-run plan and implementation, with the surviving findings as the work. The findings never leave the run's artifacts: no issue, and the PR names the class of
  fix, not how to attack it.
- **devflow-config** snapshots the repository's configuration through the GitHub API (read-only, with
  the agent's token; each endpoint records whether this token could read it, and a 404 for a non-admin
  token counts as unknown, not off), then a reviewer compares it with the repo's documented intent, its
  workflow files, its `.archon/config.yaml` and, if `reference` is given, that repository. The review
  is read-only. File fixes (workflow files, which need the `workflow` scope on the agent's token,
  `dependabot.yml`, `CODEOWNERS`, `SECURITY.md`, `.archon/config.yaml`) go through a PR and the shared
  tail. Settings gaps are listed in `config-review.md` for the admin user's `gh-baseline` (root README
  §3 "Admin GitHub identity").
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

`scripts/test-render-run.sh` also tests the plan test's scripts (`render-run.ts`, `test-plan.ts`, `check-plan.ts`) and `publish-plan.ts`.

Adapted from the PrivacyFence pack ([privacyfence/privacyfence `.archon/`](https://github.com/privacyfence/privacyfence/tree/chore/archon-devflow-workflow/.archon)).
Its `devflow-release` is not here: it drives that project's own release script and build workflows.
