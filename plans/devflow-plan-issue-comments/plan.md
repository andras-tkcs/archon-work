# devflow-plan: follow the plan run and its implementation run on the issue

## Goal

When `devflow-plan` is started with an issue (`#<n>`, a bare `<n>`, or this repository's issue URL,
in `work` or in the run's message), the issue is where the work can be followed:

- The plan run posts **Planning started** (with a link to the run in the Archon web UI).
- When the plan is published, it posts **Plan ready** with links to open and review the plan,
  the prerequisites ("before"), the after-merge steps ("after") and the generated
  `devflow-run-<slug>` workflow file, plus the start commands.
- If the plan run ends without a published plan, it comments again: **Planning failed** or
  **Planning stopped**.
- The generated `devflow-run-<slug>` posts **Implementation started**. If it fails or stops
  before its PR exists, it posts **Implementation failed** / **Implementation stopped**. Its PR
  always says `Closes #<n>`.

Starting the implementation stays exactly as today (`archon workflow sync`, then
`archon workflow run devflow-run-<slug> --detach`). There is no issue watcher. A run started
without an issue behaves exactly as today and its generated workflow is unchanged.

Source: the run's message ("issue-based plan - implement workflow … if error and no pr comment on
the issue again") and the interview (Q2–Q13), continued by run
`5bffc65c-cd02-4dce-bf80-6dba3988731d` ("finish this plan").

## Current state

- `packs/devflow/devflow-plan/devflow-plan.yaml`: `preflight` (l.36) → `setup` (l.47) →
  `interview` loop (l.54) → `stop-at-interview` (`cancel:`, l.111) or `plan-loop` (l.117:
  finalize, `render` l.139, plan-test, plan-review, plan-check) → `plan-result` (l.223) →
  `publish` (l.236, `returns: publish`). No node touches the issue; only the planner commands read
  it (`gh issue view <n> --comments`).
- `packs/devflow/.shared/publish-plan.ts`: pushes `plans/<slug>/{plan,prerequisites,after}.md`
  and `plans/workflows/devflow-run-<slug>.yaml` to the `plans` branch, then writes
  `$ARTIFACTS_DIR/published.md` (l.99–123: repo from `gh repo view`, the plan URL
  `https://github.com/<repo>/blob/<plans_ref>/<plans_dir>/<slug>/plan.md`, assumptions, the
  `extraWorkflowSources` hint when the project lacks it, the start command).
- `packs/devflow/.shared/render-run.ts`: pure `renderRunWorkflow(o: RenderOpts)` (l.74) building
  the `devflow-run-<slug>` YAML: optional `prerequisites` wait + `stop-at-prerequisites` cancel
  (l.91–109), optional `after-steps` (l.111), `worktree-check` (l.130, gated on prerequisites when
  present), `confirm-worktree-removal`, `stop-at-worktrees` cancel (l.164), `remove-worktrees`,
  `start` (l.183), `phase-*`/`merge-*` per wave, `deliver` (l.257, `workflow:
  <pack>:mod-devflow-deliver`, `with:` plan facts) and `result` (l.271). Returned by
  `Bun.YAML.stringify(doc, null, 2)` (l.279). CLI at l.282–310.
- `packs/devflow/.shared/render-plan.ts` (the `render-run` node of devflow-plan and devflow-refine):
  checks the installed pack has `mod-devflow-phase` and `mod-devflow-deliver` (l.71–76), calls
  `renderRunWorkflow` (l.82–94), validates with `archon validate`. It already calls
  `archon workflow get <WORKFLOW_ID> --json` from inside a node (l.56).
- `packs/devflow/devflow-plan/scripts/test-plan.ts`: dry-runs the rendered workflow; l.70 requires
  every `workflow:` node plus `result` to be `stubbed` in the trace.
- `packs/devflow/devflow-refine/devflow-refine.yaml`: `load` (l.51, `load-published`) and `render`
  (l.161) without an issue; `packs/devflow/devflow-refine/scripts/load-published.ts` prints
  `{slug, branch, title, plan_commit, started, reason, refusal, work}` (l.129).
- `packs/devflow/mod-devflow-deliver/mod-devflow-deliver.yaml`: inputs `plan_ref … head`
  (l.11–32); `load-plan` node (l.54). `packs/devflow/.shared/load-plan.ts` writes
  `context.json` (l.51–63) without an issue.
- `packs/devflow/mod-devflow-tail/commands/open-pr.md` l.23–24: `Closes #<n>` only "if the work
  named one".
- `packs/devflow/archon-plugin.json`: `entrypoints` list every workflow, including the `mod-` ones
  started by `devflow-run-<slug>`.
- `bootstrap.sh`: writes `~agent/.archon/.env` only when absent (l.393–421), `has_env` (l.422);
  section 7 (l.440) restarts Archon when the `.env`/unit checksum changed; section 9 derives
  `TS_URL` from `tailscale status --json` `.Self.DNSName` (l.588); summary at l.602.
- Tests: `scripts/test-render-run.sh` (render-run structure, render-run node, test-plan,
  check-plan, load-plan, publish-plan, load-published), `scripts/test-devflow-pack.sh`
  (`archon validate workflows` + every `fixtures/*.stubs.yaml`), `scripts/test-admin-tools.sh`
  (bootstrap's `fetch_admin_file` by `eval`-ing it out of `bootstrap.sh`).
- Archon facts (checked in `/tmp/archon-src`, Archon 0.13.4):
  - There is no workflow-level failure hook. A node with `trigger_rule: all_done` runs after
    failed or skipped upstreams (`packages/workflows/src/dag/trigger-rule.ts`), and the run is
    still marked failed when any node failed (`dag/run-terminal.ts` `finishRun`).
  - A `cancel:` node ends the run at once (`dag/nodes/halt/halt.ts`), so nothing after it runs.
  - A binding or `when:` that reads a **failed** producer fails the reading node; `if_skipped`
    covers only skipped producers (`dag/references.ts` l.338).
  - `archon workflow get <id> --json --verbose` prints `{ "parent_run_id": …, "nodes": [{
    "nodeId": "…", "state": "completed|failed|skipped|running|…" }, …] }`. Exec nodes get
    `WORKFLOW_ID` and inherit Archon's process environment (which loads `~/.archon/.env`).
  - The run page is `/console/r/<runId>` (`packages/web/src/experiments/console/ConsoleApp.tsx`).
  - A non-`INPUTS_*` `process.env` read in a script is only a load warning.

## Design

### Decisions from the interview

- **D1 Issue detection (Q4 = B, exactly one reference anywhere in the text).** The text is
  `$INPUTS.work`, or the run's message (`USER_MESSAGE`) when `work` is empty. Exactly one
  distinct issue → that issue. None, or two or more distinct ones → no issue: nothing is posted,
  the run behaves as today, and the node's `message` says why.
- **D2 Implementation start unchanged.** The ready comment quotes the same start instructions as
  `published.md`.
- **D3 No issue watcher** in this change.
- **D4 Ready comment** after `publish`, built from the same data as `published.md`.
- **D5 Endings (Q2 = B, both runs; Q5 = A, worded by cause; Q3 = A, minimal detail).** Every
  ending without a PR posts a new comment: "… failed" for a node failure, "… stopped" for a
  deliberate stop (a `cancel:` node). The comment holds only the heading, the node id, the run id,
  where the logs are, and the run link. No error text, stderr, agent output or paths.
  - In `devflow-run-<slug>`, once its PR exists, nothing more is posted on the issue.
- **D6 One new comment per event.** No edited or sticky comment.
- **D7 Out of scope:** interview questions are not mirrored on the issue. `devflow-refine` posts
  nothing on the issue.
- **D8 Credentials:** the agent's existing `gh` login (repo scope) posts and reads the comments.
  No new secret. No prerequisites.
- **D9 Refine keeps the issue (Q6 = A).** The issue number is stored as the first line
  `# devflow-issue: <n>` of the published `devflow-run-<slug>.yaml`. `load-published.ts` reads it
  back and refine's `render` passes it on.
- **D10 PR closes the issue (Q7 = A).** The rendered `deliver` node passes `issue`, `load-plan.ts`
  writes it into `context.json`, and `open-pr.md` always writes `Closes #<issue>`.
- **D11 Archon run link (Q8 = B).** Every comment has an "Open the run in Archon" link
  `<ARCHON_PUBLIC_URL>/console/r/<runId>`. `bootstrap.sh` writes `ARCHON_PUBLIC_URL` into
  `~agent/.archon/.env` from Tailscale.
  - If the URL is missing or invalid, the link line is left out. That never fails a run.
  - The tailnet hostname then appears in issue comments. The user accepted this trade-off.
- **D12 Planning started (Q9 = B).** It holds the heading, the run id and the run link. No work
  text, no interview content.
- **D13 Earlier plan runs (Q10 = B, warn but proceed).** Every comment ends with a hidden marker.
  If the issue already has a `devflow:plan` marker from the agent's own login with another run id,
  the started comment says which run it replaces. Nothing is blocked.
- **D14 Implementation started (Q11 = B).** The rendered workflow posts it from its first node.
  There is no check for earlier implementation runs.
- **D15 A resumed plan run keeps the issue (Q12 = A).** When D1 finds no issue reference at all
  (zero references, not two or more) and the text names exactly one earlier run id (a UUID other
  than the run's own), `issue` reads that run with `archon workflow get <id> --json --verbose` and
  takes the issue from its `issue` node output. That issue then drives everything that follows:
  the started, ready and ending comments, the `# devflow-issue: <n>` header and `Closes #<n>`.
  - The "Planning started" comment says ``Continues the earlier plan run `<id>`.`` instead of the
    D13 "Replaces …" line.
  - This chains: a resumed run's own `issue` output carries the inherited number, so resuming a
    resumed run works too.
- **D16 A run cancelled from outside is corrected the next time the issue is touched (Q13 = B).**
  An external cancel (`archon workflow cancel` or the Archon UI) still posts nothing at the time:
  Archon has no hook for it. When a new plan run's `earlierRun` finds an earlier plan run whose
  last marker is `started`, it reads `archon workflow get <id> --json` and the "Replaces" line
  shows that run's real status: `cancelled`, `failed`, `plan published` or `still running`, or
  `status unknown` when the read fails. No late comment is posted for the cancel itself.
  - The pack README tells users to abandon an issue-linked run through the interview's stop or by
    rejecting an approval, not by cancelling, because a cancel leaves "… started" as the issue's
    last word until the next plan run.

### Decisions made while planning (settled by the code)

- **Mechanics.** No hook exists, so:
  - Endings are a terminal `trigger_rule: all_done` node.
  - Every `cancel:` node gets a comment node in front of it.
  - No binding reads a node that may have failed. The terminal node learns what failed from
    `archon workflow get <run> --json --verbose`, and learns of success from
    `$ARTIFACTS_DIR/published.json`.
- **One helper, one node script.**
  - `packs/devflow/.shared/issue.ts` holds the pure logic (parsing, bodies, markers, link) and the
    `gh` wrappers.
  - `packs/devflow/.shared/issue-node.ts` is the node CLI.
  - Workflows reach it through thin entries named `scripts/issue-comment.ts`, following the
    existing thin-entry pattern (for example `devflow-plan/scripts/publish-plan.ts`).
- **New building block `mod-devflow-issue`.** The rendered `devflow-run-<slug>` lives on the plans
  branch and cannot run pack scripts. It posts through a child run of
  `<pack>:mod-devflow-issue`, the same way it already starts `mod-devflow-phase` and
  `mod-devflow-deliver`. The child finds the run to report on through its own
  `parent_run_id`.
  - Rejected: inline bash in the rendered file. It would freeze the comment logic into every
    published workflow and duplicate `issue.ts` in shell.
- **Plan-run nodes.** devflow-plan gets three script nodes: `issue` (detect and post started),
  `comment-stopped` (in front of `stop-at-interview`) and `comment-end` (terminal, `all_done`).
  `comment-end` posts the ready comment on success and "Planning failed" otherwise. This replaces
  the draft's separate `comment-plan` node: one terminal node cannot disagree with itself about
  success.
- **Issue validity.** A detected number is checked with `gh api repos/<repo>/issues/<n>`. A 404 or
  a pull request (`pull_request` key present) counts as no issue. A closed issue still counts.
- **How D15 reads the earlier run** (from the live `archon workflow get --json --verbose` output
  on this host):
  - Node outputs appear only as `nodes[].outputPreview`, cut at 200 characters plus `...`. The
    `issue` node prints `issue` as its first key, so the prefix `{"issue":"<n>"` always survives
    the cut. The number is read with `^\{"issue":"([1-9][0-9]*)"` and no `JSON.parse`.
  - The earlier run must be a devflow-plan run (`workflow_name` is `devflow-plan` or ends with
    `:devflow-plan`) of the same project (`codebase_id` equal to the own run's, both non-empty),
    and its `issue` node must be `completed`. Otherwise nothing is inherited. This keeps a run id
    pasted from another project from pulling in a foreign issue number.
  - The inherited number still goes through `checkIssue`, like a detected one.
- **Never fail a run.** `issue-node.ts` always exits 0 and prints its JSON, even on bad input or a
  `gh`/`archon` error. Diagnostics go to stderr and into `message`.

### `.shared/issue.ts` (exact contract)

```ts
export type Kind = "plan" | "run";
export type Event = "started" | "ready" | "failed" | "stopped";

// D1. Returns the issue number as a string ("" when none) and why.
export function parseIssue(text: string, repo: string): { issue: string; reason: string };
// D15. Distinct run ids (UUIDs) named in text, lowercased, in order of first appearance, without ownRunId.
export function parseRunRefs(text: string, ownRunId: string): string[];
// D15. The issue of an earlier plan run from its `archon workflow get --json --verbose` JSON; "" when none.
export function inheritedIssue(getJson: any, ownCodebaseId: string): string;
// D11. "" unless url matches /^https:\/\/[^\s\/]+(\/[^\s]*)?$/ and runId matches /^[A-Za-z0-9-]+$/;
// otherwise strip trailing slashes from url and return `${url}/console/r/${runId}`.
export function runLink(url: string | undefined, runId: string): string;
export function marker(kind: Kind, runId: string, event: Event): string;
// D13: comments from `gh issue view <n> --json comments` (.comments), own login, own run id.
export function earlierRun(comments: Array<{ author?: { login?: string }; body?: string }>, login: string, ownRunId: string): { runId: string; event: Event } | null;
// D16: `status` is the earlier run's Archon `status` (`archon workflow get <id> --json`), read only when its last event is "started"; "" when unread or the read failed.
export function startedBody(o: { kind: Kind; runId: string; link: string; earlier: { runId: string; event: Event; status?: string } | null; continues?: string }): string;
export function endedBody(o: { kind: Kind; event: "failed" | "stopped"; node: string; runId: string; link: string }): string;
export interface Published { repo: string; plans_ref: string; plans_dir: string; slug: string; title: string; workflow: string; commit: string; configured: boolean; prerequisites: boolean; after: boolean; assumptions: string[] }
export function readyBody(p: Published, runId: string, link: string): string;
// The first node whose state is "failed", ignoring the ids issue, comment-stopped, comment-end and any id starting with "issue-"; "" when none.
export function firstFailedNode(getJson: any): string;
// gh wrappers: never throw.
export function postComment(issue: string, body: string): { ok: boolean; error: string };   // gh issue comment <n> --body-file - (body on stdin)
export function issueComments(issue: string): Array<{ author?: { login?: string }; body?: string }> | null; // gh issue view <n> --json comments
export function ownLogin(): string;                       // gh api user --jq .login, "" on error
export function checkIssue(repo: string, issue: string): string; // "" when it is an issue; else the reason
export function prCount(branch: string): number | null; // gh pr list --head <branch> --state all --json number --jq length
```

`parseIssue` rules, in order:

1. If the trimmed text matches `^#?([1-9][0-9]*)$`, the result is that number.
2. Otherwise collect references:
   - `#<n>` matched by `(?<![\w/.#-])#([1-9][0-9]*)(?![\w])`. This excludes `owner/repo#5` and
     `x#5`.
   - `https://github.com/<owner>/<repo>/issues/<n>`, where `<owner>/<repo>` matches `repo`
     case-insensitively, `http` or `https`, and an optional `www.`.
   - Ignore other repositories' URLs and `/pull/` URLs. A bare number inside other text never
     counts.
3. Count the distinct numbers:
   - 1 → `{issue: n, reason: "issue #<n>"}`.
   - 0 → `{issue: "", reason: "no issue reference in the work text"}`.
   - 2 or more → `{issue: "", reason: "the work text names issues #a, #b; not commenting"}`, with
     the numbers in ascending numeric order.

`parseRunRefs` matches `[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`
with no hex digit or `-` directly before or after, lowercases each match, drops `ownRunId`
(compared lowercased) and duplicates, and keeps the order of first appearance.

`inheritedIssue(getJson, ownCodebaseId)` returns the number only when all of these hold, else `""`:

1. `String(getJson.workflow_name)` is `devflow-plan` or ends with `:devflow-plan`.
2. `ownCodebaseId` is non-empty and equals `String(getJson.codebase_id)`.
3. `getJson.nodes` has an entry with `nodeId === "issue"` and `state === "completed"` whose
   `outputPreview` matches `^\{"issue":"([1-9][0-9]*)"`. The result is the captured number.

`marker` returns exactly `<!-- devflow:<kind> run=<runId> event=<event> -->`.

`earlierRun`:

1. Keep comments whose `author.login === login` and whose body contains
   `<!-- devflow:plan run=([A-Za-z0-9-]+) event=(started|ready|failed|stopped) -->` with a run id
   other than `ownRunId`.
2. The result is the run of the last such comment, in array order (which is chronological), and
   the event of that run's last marker.
3. If there is none, the result is `null`.

Bodies are paragraphs joined with `"\n\n"`. The marker is always the last line. `<link line>` is
`[Open the run in Archon](<link>)` and is left out entirely when `link` is `""`.

- `startedBody`, `kind: "plan"`:
  1. `### Planning started`
  2. ``Run `<runId>` is planning this issue. Its questions wait in the Archon attention queue.``
  3. When `continues` is non-empty: ``Continues the earlier plan run `<continues>`.`` (D15); the
     "Replaces" line is then left out. Otherwise, only when `earlier` is set:
     ``Replaces the earlier plan run `<id>` (<state>).``
     - `<state>` is `plan published` for `ready`, `failed` for `failed` and `stopped` for
       `stopped`.
     - For `started` (D16), `<state>` comes from `earlier.status`: `cancelled` → `cancelled`,
       `failed` → `failed`, `completed` → `plan published`, `running`, `paused` or `pending` →
       `still running`, and anything else (including `""` or a missing `status`) →
       `status unknown`.
  4. `<link line>`
  5. The marker.
- `startedBody`, `kind: "run"`:
  1. `### Implementation started`
  2. ``Run `<runId>` is implementing the plan for this issue.``
  3. `<link line>`
  4. The marker. (`earlier` is ignored.)
- `endedBody`:
  1. The heading:
     - `### Planning failed` for `plan`/`failed`.
     - `### Planning stopped` for `plan`/`stopped`.
     - `### Implementation failed` for `run`/`failed`.
     - `### Implementation stopped` for `run`/`stopped`.
  2. ``Run `<runId>` failed at node `<node>`.`` or ``Run `<runId>` stopped at node `<node>`.``
     When `node` is `""`, the text is ``Run `<runId>` failed.`` (or `stopped.`).
  3. ``Full logs are on the runner: `archon workflow get <runId>` and `archon workflow artifacts <runId>`.``
  4. `<link line>`
  5. The marker.
- `readyBody` (base `B = https://github.com/<repo>/blob/<plans_ref>/<plans_dir>`):
  1. `### Plan ready: <title>`
  2. A list:
     - `- Plan: <B>/<slug>/plan.md`
     - `- Before you start (prerequisites): <B>/<slug>/prerequisites.md` (only when
       `prerequisites`)
     - `- After implementing: <B>/<slug>/after.md` (only when `after`)
     - ``- Workflow `<workflow>`: <B>/workflows/<workflow>.yaml``
     - ``- Commit `<commit>` on the `<plans_ref>` branch``
  3. The assumptions:
     - When `assumptions` is non-empty: `**Assumptions** (decided after the interview):`,
       followed by the bullets, one per line.
     - Otherwise: `No assumptions: every decision in the plan was made in the interview.`
  4. Only when `configured` is false:
     ``The project does not load workflows from the `<plans_ref>` branch yet. Add this to `.archon/config.yaml` on the default branch first:``,
     then a fenced `yaml` block with `extraWorkflowSources:` / `  - ref: <plans_ref>` /
     `    path: <plans_dir>`.
  5. ``**Start the implementation:** run `archon workflow sync` in the project's checkout, then `archon workflow run <workflow> --detach`.``
  6. ``Run `<runId>` `` followed by `` · [Open the run in Archon](<link>)`` when there is a link.
  7. The marker, with event `ready`.

### `.shared/issue-node.ts` (node CLI contract)

Inputs, all read with `input(name, false)`:

- `mode`: one of `detect-start`, `start`, `stopped`, `end`.
- `kind`: `plan` or `run`.
- `issue`, `node`, `branch`.
- For `detect-start`: the text is `work`, or `process.env.USER_MESSAGE` when `work` is empty.

Stdout is exactly one line: `{"issue":"<n or empty>","posted":<bool>,"message":"<one line>"}`,
with the keys in exactly that order (`issue` first: D15 reads it from a 200-character preview).
The exit code is always 0. `issue.ts` and `issue-node.ts` never call `fail`, `must` or
`artifactsDir` from `util.ts` (they call `process.exit(1)`, which no `try/catch` catches). They
read `process.env.ARTIFACTS_DIR` directly and use only `run` and `input` from `util.ts`. The whole body runs in a `try/catch`; on any exception it prints the
JSON with `posted:false` and the error as the `message`.
The CLI body runs at module top level, like `.shared/publish-plan.ts`, with no
`if (import.meta.main)` guard (unlike `render-run.ts`): the thin entries
`scripts/issue-comment.ts` only import the module, so a guarded body would print nothing in a real
run. The `issue` input is checked first, before any `gh` or `archon` call.

- **Run id.**
  - `kind=plan`: `WORKFLOW_ID`.
  - `kind=run`: the `parent_run_id` from `archon workflow get <WORKFLOW_ID> --json`, read as
    `String(j.parent_run_id ?? "")`, so a `null` or missing key counts as empty. If it is empty or
    the call fails, use `WORKFLOW_ID` and say so on stderr.
- **Link.** `runLink(process.env.ARCHON_PUBLIC_URL, runId)`. When the link is empty, write a note
  to stderr saying why.
- **`issue` input.** Unless the mode is `detect-start`, it must match `^[1-9][0-9]*$`.
  - When it is `""`, print `posted:false`, `message:"no issue"`.
  - When it is anything else, print `posted:false`, `message:"invalid issue '<x>'"`.
- **`detect-start`** (only with `kind=plan`):
  1. Get the repo with `repoSlug()` from `.shared/gh.ts`. If that throws, the result is no issue
     with that reason.
  2. Run `parseIssue`.
  3. D15: only when `parseIssue` found zero references (its reason is
     `no issue reference in the work text`) and `parseRunRefs(text, runId)` returns exactly one
     id `E`:
     - `own` = parsed `archon workflow get <runId> --json` (`{}` on failure);
     - `prev` = parsed `archon workflow get <E> --json --verbose` (`{}` on failure);
     - `n = inheritedIssue(prev, String(own.codebase_id ?? ""))`. When `n` is non-empty, the issue
       is `n`, `continues` is `E`, and the reason is `issue #<n> from the earlier plan run <E>`.
       When it is empty, the reason becomes `no issue reference in the work text, and run <E> has
       no issue`.
  4. Run `checkIssue` on the issue (detected or inherited).
  5. If there is an issue: `earlierRun(issueComments(n) ?? [], ownLogin(), runId)`. D16: when
     the result's event is `started` and `continues` is empty, set `earlier.status` to
     `String(JSON.parse(stdout).status ?? "")` of `archon workflow get <earlier.runId> --json`, or
     `""` when the call or the parse fails (say so on stderr). Then post
     `startedBody({kind: "plan", runId, link, earlier, continues})`.
  6. Output `issue` (the detected or inherited number, or `""`), `posted`, and as `message` the
     reason or the post result.
- **`start`**: post `startedBody({kind, runId, link, earlier: null})`.
- **`stopped`**: post `endedBody({kind, event: "stopped", node, runId, link})`.
- **`end`**: for both kinds, `get` is the parsed `archon workflow get <runId> --json --verbose`,
  where `runId` is the run id resolved above (for `kind=plan` the own `WORKFLOW_ID`; for
  `kind=run` the parent's `parent_run_id`, never the child's own `WORKFLOW_ID`, whose only node is
  the running `comment`), or `{}` when the call fails.
  - `kind=plan`:
    - If `$ARTIFACTS_DIR/published.json` exists, post `readyBody(JSON.parse(it), runId, link)`.
    - Otherwise post `endedBody({event: "failed", node: firstFailedNode(get)})`.
  - `kind=run`:
    1. `node = firstFailedNode(get)`. When it is `""`, print `posted:false`,
       `message:"no failed node"`.
    2. Otherwise, if `prCount(branch)` is greater than 0, print `posted:false`,
       `message:"a pull request exists for <branch>"`.
    3. Otherwise (including when the count is `null`), post the failed body.

### devflow-plan nodes (exact)

```yaml
  - id: issue                      # new, after preflight
    depends_on: [preflight]
    script: issue-comment
    runtime: bun
    with: { mode: detect-start, kind: plan }
    output_format:
      type: object
      properties: { issue: { type: string }, posted: { type: boolean }, message: { type: string } }
      required: [issue, posted, message]
  - id: setup                      # depends_on changes from [preflight] to [issue]
  - id: comment-stopped            # new, in front of the cancel
    depends_on: [interview]
    when: "$interview.output.stop == true"
    script: issue-comment
    runtime: bun
    with: { mode: stopped, kind: plan, issue: "$issue.output.issue", node: interview }
    output_format: <same as issue>
  - id: stop-at-interview          # depends_on becomes [interview, comment-stopped]; when and cancel text unchanged
  - id: comment-end                # new, last node
    depends_on: [publish]
    trigger_rule: all_done
    script: issue-comment
    runtime: bun
    with: { mode: end, kind: plan, issue: { from: "$issue.output.issue", if_skipped: "" } }
    output_format: <same as issue>
```

The `render` node inside `plan-loop` adds `issue: "$issue.output.issue"` to its `with:`.
`returns: publish` stays. The entry `packs/devflow/devflow-plan/scripts/issue-comment.ts` holds
exactly two lines: `// Thin entry point: the logic lives in the pack's .shared/issue-node.ts.` and
`import "../../.shared/issue-node.ts";`. The entry in `mod-devflow-issue/scripts/` is the same.

### publish-plan.ts: `published.json`

After `published.md` is written, write `$ARTIFACTS_DIR/published.json` as
`JSON.stringify(<Published>)`, with these values:

- `repo`: the same `repo` value as `published.md` uses.
- `configured`: the existing `configured` flag.
- `prerequisites` / `after`: whether that file exists in `$ARTIFACTS_DIR`.
- `assumptions`: the parsed bullet lines.
- `commit`, `title`, `slug`, `workflow`, `plans_ref`, `plans_dir`: the existing variables.

`published.md`'s text does not change.

### The rendered `devflow-run-<slug>` with an issue (exact)

`RenderOpts` gets `issue?: string`. `validate()` rejects a non-empty issue that does not match
`^[1-9][0-9]*$` with `invalid issue '<x>': it must be a positive number`. The CLI gets
`--issue <n>`. When `issue` is unset or `""`, the output is byte-identical to today's.

When it is set:

- **Header.** The returned text is `` `# devflow-issue: ${issue}\n` `` + the YAML.
- **`issue-start`** is the first node in `nodes`:
  `{ id: "issue-start", workflow: "<pack>:mod-devflow-issue", with: { mode: "start", kind: "run", issue, branch, node: "" } }`.
  - With prerequisites, `prerequisites` gets `depends_on: ["issue-start"], trigger_rule: "all_done"`.
  - Without them, `worktree-check` gets `depends_on: ["issue-start"], trigger_rule: "all_done"`.
- **`issue-stopped-prerequisites`** (only with prerequisites), placed before
  `stop-at-prerequisites`:
  `{ id, workflow: "<pack>:mod-devflow-issue", depends_on: ["prerequisites"], when: "$prerequisites.output.decision == 'reject'", with: { mode: "stopped", kind: "run", issue, branch, node: "prerequisites" } }`.
  `stop-at-prerequisites.depends_on` becomes `["prerequisites", "issue-stopped-prerequisites"]`.
- **`issue-stopped-worktrees`**, placed before `stop-at-worktrees`:
  `{ id, workflow: …, depends_on: ["confirm-worktree-removal"], when: "$confirm-worktree-removal.output.decision == 'reject'", with: { mode: "stopped", kind: "run", issue, branch, node: "confirm-worktree-removal" } }`.
  `stop-at-worktrees.depends_on` becomes `["confirm-worktree-removal", "issue-stopped-worktrees"]`.
- **`deliver.with`** gets `issue: "<n>"` as its last key (D10).
- **`issue-end`** is the last node:
  `{ id: "issue-end", workflow: "<pack>:mod-devflow-issue", depends_on: ["result"], trigger_rule: "all_done", with: { mode: "end", kind: "run", issue, branch, node: "" } }`.
  `returns: result` stays.

`render-plan.ts` reads `input("issue", false)` and passes it as `issue`. When it is non-empty,
`mod-devflow-issue` joins the installed-pack check, in the same message format.

`test-plan.ts` l.70: `need` becomes the `workflow:` nodes **without a `when:`**, plus `result`.
A `when:`-gated stop comment is legitimately skipped in the approve-everything dry run.

### `mod-devflow-issue` (new building block)

The file is `packs/devflow/mod-devflow-issue/mod-devflow-issue.yaml`:

```yaml
name: mod-devflow-issue
description: |
  Internal building block (mod-), started by a devflow-run-<slug> workflow; never start it yourself.

  Posts one comment about the parent run on the plan's issue (implementation started, stopped, or
  failed before its pull request exists). It never fails the parent: a failed post is reported in
  its output only.
worktree:
  enabled: true
inputs:
  mode: { default: "", description: "start, stopped or end." }
  kind: { default: "run", description: "Always run here." }
  issue: { default: "", description: "The issue number." }
  branch: { default: "", description: "The feature branch, to see whether its pull request exists." }
  node: { default: "", description: "The node a stop happened at." }
returns: comment
nodes:
  - id: comment
    script: issue-comment
    runtime: bun
    output_format:
      type: object
      properties: { issue: { type: string }, posted: { type: boolean }, message: { type: string } }
      required: [issue, posted, message]
```

Write it in the pack's block style: each input as a two-line `default:` / `description:` mapping,
as in `mod-devflow-deliver.yaml`. Also:

- Add `scripts/issue-comment.ts` (the thin entry).
- Add `fixtures/happy-path.stubs.yaml` with `fixture: { expect: completed }` and the stub
  `comment: { issue: "42", posted: true, message: ok }`.
- Add `"mod-devflow-issue": "mod-devflow-issue/mod-devflow-issue.yaml"` to the `entrypoints` in
  `packs/devflow/archon-plugin.json`, after `mod-devflow-deliver`.

### PR closes the issue (D10)

- `mod-devflow-deliver.yaml` gets the input
  `issue: { default: "", description: "The plan's issue number; the PR closes it. Empty: none." }`,
  in block style, after `head`.
- `load-plan.ts`: in `mode === "deliver"` only, read `issue = input("issue", false)`.
  - A non-empty value that does not match `^[1-9][0-9]*$` fails with
    `invalid issue '<x>': it must be a positive number`.
  - `context.json` gets `issue` only when non-empty (spread
    `...(issue ? { issue } : {})` after `devflow_root`).
- `open-pr.md`:
  - l.1–2: the run facts add `issue` (optional; the plan's issue number).
  - l.23–24 become: `- **What this changes**: the plan's Goal, and the issue it closes: when
    \`context.json\` has \`issue\`, always \`Closes #<issue>\`, whatever the plan says; otherwise
    \`Closes #<n>\` if the work named one. Read <work order>.`

### Refine keeps the issue (D9)

- `load-published.ts`:
  1. After step 5, run `git show <planCommit>:<plansDir>/workflows/devflow-run-<slug>.yaml`.
  2. If it succeeds and its first line matches `^# devflow-issue: ([1-9][0-9]*)\s*$`, `issue` is
     that number. Otherwise `issue` is `""`.
  3. Add `issue` to the final JSON, after `work`. The `check_only` output stays `{"ok":true}`.
- `devflow-refine.yaml`:
  - `load.output_format` adds `issue: { type: string }` to `properties` and to `required`.
  - The `render` node's `with:` adds `issue: "$load.output.issue"`.
- The three refine fixtures add `issue: ""` to their `load` stub.

### `ARCHON_PUBLIC_URL` in bootstrap.sh (D11)

Directly after `has_env() { … }` (l.422), add:

```bash
# env_default <file> <key> <value>: appends KEY=value when the file has no KEY= line yet; a line
# already there (set by hand or by an earlier run) is never changed.
env_default() { grep -q "^$2=" "$1" || printf '%s=%s\n' "$2" "$3" >> "$1"; }

# devflow's issue comments link to runs at this address (the tailnet name; it opens only on the tailnet).
ts_dns=""
if tailscale status >/dev/null 2>&1; then
  ts_dns="$(tailscale status --json 2>/dev/null | jq -r '.Self.DNSName // ""' | sed 's/\.$//' || true)"
fi
if [[ -n "$ts_dns" ]]; then
  env_default "$ENV_FILE" ARCHON_PUBLIC_URL "https://$ts_dns"
else
  warn "Tailscale is not up: ARCHON_PUBLIC_URL is not in $ENV_FILE, so devflow issue comments carry no Archon run link (re-run once Tailscale is up)"
fi
```

Also:

- In the `.env` template, after the Slack block and before `EOF`, add:
  `# --- devflow issue comments link to runs at ARCHON_PUBLIC_URL (bootstrap.sh adds it from Tailscale; edit it to override)`.
- In the summary, after the `Web UI` line, add:
  `  Run links   : $(sed -n 's/^ARCHON_PUBLIC_URL=//p' "$ENV_FILE" | head -1)`.
- The existing `env_sum` check in section 7 restarts Archon when the line was added.

## Manual steps

There is no HTML artifact (this run is unattended); `after.md` in the run's artifacts carries the
same steps with direct links.

- **Before:** none. The agent's existing `gh` login (README §3, `gh auth login`, which includes
  `repo` scope) covers reading and posting issue comments. No new secret.
- **After** (once the PR has merged; `manual_after` ma1 and ma2):
  1. **ma1: re-run the bootstrap on each runner** while no workflow is running:
     1. Check that nothing is running: `sudo -iu agent archon workflow runs --json` shows no run with
        status `running` or `paused` (or open the Archon web UI, `https://<machine>.<tailnet>.ts.net`).
     2. Re-run `bootstrap.sh` the way the root README's "2. Run the bootstrap" section says, with
        `UPGRADE=1` (the default; https://github.com/tkcs-lab/archon-work/blob/main/README.md#2-run-the-bootstrap).
     3. `sudo -iu agent grep ^ARCHON_PUBLIC_URL= ~/.archon/.env` prints
        `ARCHON_PUBLIC_URL=https://<machine>.<tailnet>.ts.net`; the summary shows a `Run links` line.
     4. `sudo -iu agent archon workflow list | grep mod-devflow-issue` finds the new building block.
  2. **ma2: end-to-end check on a throwaway issue:**
     1. Open a new issue at https://github.com/tkcs-lab/archon-work/issues/new (title
        "devflow issue comment test").
     2. As `agent`, in the archon-work checkout:
        `archon workflow run tkcs-lab/devflow:devflow-plan "#<that number>" --detach`.
     3. The issue gets a "### Planning started" comment whose "Open the run in Archon" link opens the
        run on a tailnet device.
     4. Answer the first interview question with "stop". The issue gets "### Planning stopped" with
        `at node \`interview\`` and a working run link. Close the issue.

## Risks and open questions

- **A wrong Archon fact.** The plan relies on several Archon details, all checked in the source:
  - `all_done` runs after failed upstreams.
  - `{from, if_skipped}` covers a skipped `issue`.
  - Transitive bindings are allowed.
  - The `archon workflow get --json --verbose` shape (including `codebase_id`, `workflow_name`
    and the 200-character `nodes[].outputPreview` that D15 reads).
  - `parent_run_id` is set on a child run.

  If `archon validate workflows` rejects a new node, if a fixture's outcome changes (for example
  `plan-test-never-clears` stops failing at `plan-result`), or if the dry run in `test-plan.ts`
  does not stub `issue-end`, the worker stops with `status=blocked` and quotes the error. The
  worker does not reshape the graph.
- **A run cancelled from outside** (`archon workflow cancel`, or the Archon UI) posts no ending
  comment at the time; no hook exists for that. D16 corrects the status in the next plan run's
  "Replaces" line, and the pack README tells users to stop through the workflow. An abandoned
  implementation run, or a cancelled plan run never followed by another, still leaves
  "… started" as the issue's last comment (Q13 = B accepts this).
- **A `mod-devflow-issue` child run that fails as a run.** The script always exits 0, but the
  child itself can still fail (for example, if Archon cannot create its worktree). Then the parent
  `devflow-run-<slug>` is marked failed: a failed `issue-end` marks an otherwise green run failed,
  and a failed `issue-stopped-*` skips its `stop-at-*` cancel, so the run ends failed rather than
  cancelled. It never goes on unsafely, because `start` and `remove-worktrees` stay gated on the
  approval. The block keeps `worktree: enabled: true` like `mod-devflow-deliver`, because
  `gh issue comment <n>` (no `-R`) needs a checkout of the repository as its working directory.
  If this shows up in practice, a follow-up can pass `-R <repo>` and drop the worktree.
- **Branch-relative links.** The ready comment links `blob/<plans_ref>/…`, so after a refine the
  links show the refined plan. That is intended (D7). The commit SHA in the comment pins the
  version that was announced.
- **The plan-test that never clears** ends today as a *failure* at `plan-result`, not as a cancel.
  So it posts "Planning failed (plan-result)", not "stopped" (see Assumptions).
- **Older pack installed.** A `devflow-run-<slug>` rendered with an issue needs
  `mod-devflow-issue` in the installed pack. `render-plan.ts` checks this before publishing, with
  the existing "update the pack" message.
- **Plan review (round 0).** The reviewer's sizing findings were applied: the old p1 is now
  p1 (pure helper) + p2 (node CLI), and the old p5 is now p6 (PR closes) + p7 (refine); the
  plan-run phase (p4) is now complexity M because it touches 8 files.
- **Why no more questions** (from the interview; Q13 = B adds D16 and nothing else open):
  - Scope: the ask fixes the flow: an issue goes in, a plan comes out, the ready-plan comment is
    posted, and any ending without a PR comments again. There is no watcher, and the
    implementation starts as today (D2/D3). Both runs before the PR are covered (Q2 = B).
    Interview mirroring and refine comments are out (D7). Refine keeps the issue link (Q6 = A,
    D9). The PR always closes the issue (Q7 = A, D10). Comments link the Archon run (Q8 = B,
    D11). There are start comments for the plan run (Q9 = B, D12) and the implementation run
    (Q11 = B, D14). A repeated plan run warns but proceeds (Q10 = B, D13). A resumed plan run
    keeps the issue of the run it continues (Q12 = A, D15). An externally cancelled plan run is
    reported with its real status in the next plan run's "Replaces" line, with no late comment
    (Q13 = B, D16).
  - Behaviour: every comment is settled:
    - started (plan D12 / implementation D14);
    - ready plan (D4);
    - failed or stopped, worded by cause (Q5 = A), with minimal detail (Q3 = A);
    - one new comment per event (D6);
    - issue detection (Q4 = B, D1), and inheritance on resume (Q12 = A, D15).

    Once the PR exists, failures show on the PR. Posting or reading comments never fails a run.
  - Names and strings come from existing code: `devflow-run-<slug>`, `plans/<slug>/*.md`, the
    publish-plan.ts links, `context.json`, `mod-devflow-deliver`. The headings come from
    Q3/Q5/Q9/Q11. `Closes #<n>` is already in open-pr.md, `/console/r/<runId>` is Archon's route,
    and `ARCHON_PUBLIC_URL` comes from Q8.
  - Data and schema:
    - an optional `issue` in render-run;
    - the `# devflow-issue: <n>` header;
    - `issue` on deliver and in `context.json`;
    - one new `.env` key.

    All of these are absent when there is no issue.
  - Security: comments use the agent's own gh login. They hold no error text, stderr, paths, work
    text or interview content. The earlier-run check reads only the agent's own comments. `issue`
    is validated as numeric and the URL is validated. The tailnet hostname appearing in comments
    is the user's accepted trade-off.
  - Prerequisites: none. After merge: re-run `bootstrap.sh` while no workflow runs, then update
    the pack.
  - Archon mechanics: there is no failure hook, so endings use an `all_done` terminal node plus a
    node in front of each cancel.

## Assumptions

- **A plan test that never clears counts as "Planning failed"**: the run fails at `plan-result` today, so the ending comment says "failed" at that node, not "stopped". Why: Q5 = A words the comment by the actual cause, and in the code this ending is a node failure, not a `cancel:`. Made after the interview, not asked (round 0, finding none).
- **A detected number must be a real issue of this repo**: a 404 or a pull request number counts as no issue, and nothing is posted; a closed issue still counts. Why: posting on a PR or failing on a typo is not what Q4 = B asked for. Made after the interview, not asked (round 0, finding none).
- **The implementation run posts through a child workflow `mod-devflow-issue`**: the rendered workflow starts it the same way it starts `mod-devflow-phase` and `mod-devflow-deliver`. Why: a workflow on the plans branch cannot run pack scripts, and inline bash would freeze the comment logic into every published plan. Made after the interview, not asked (round 0, finding none).
- **"Before the PR exists" means no PR (open, merged or closed) from the feature branch at the moment of the ending**: checked with `gh pr list --head <branch> --state all`; if the check fails, the comment is posted. Why: this is the only state the ending node can observe. Made after the interview, not asked (round 0, finding none).
- **The env_default tests run with their own temp dir**: the block in scripts/test-admin-tools.sh starts with `unset TMPDIR; envd=$(mktemp -d)` after the file's final cleanup line. Why: the fetch_admin_file block exports TMPDIR and then removes it, so `mktemp` after it would fail. Made after the interview, not asked (round 2, finding F1).
- **issue-node.ts runs its CLI at module top level and checks `issue` first**: no `import.meta.main` guard; the `issue` input is checked before any gh/archon call. Why: the workflows reach it only through two-line thin entries that import it, as `.shared/publish-plan.ts` is reached; checking `issue` first keeps the no-issue path free of side effects and testable through the thin entries (p4/p5 acceptance). Made after the interview, not asked (round 3, finding F1).
- **A resumed run inherits only from one earlier devflow-plan run of the same project, read from the `issue` node's output preview**: zero issue references and exactly one other run id in the text; the number comes from the `{"issue":"<n>"` prefix of the 200-character `outputPreview`. Why: Q12 = A asked for inheritance through the `issue` node output, and `archon workflow get --json --verbose` exposes node outputs only as a truncated `outputPreview`. Made after the interview, not asked (round 0, finding none).

## Implementation manifest

```yaml
plan_slug: devflow-plan-issue-comments
feature_branch: feat/devflow-plan-issue-comments
max_parallel: 3
manual_after:
  - id: ma1-rerun-bootstrap
    title: Re-run bootstrap.sh on each runner and check ARCHON_PUBLIC_URL
    why: Writes ARCHON_PUBLIC_URL from the live Tailscale name, restarts Archon so script nodes see it, and installs the merged pack; CI has no runner or tailnet.
  - id: ma2-issue-end-to-end
    title: Plan a throwaway issue and check the Planning started / stopped comments and their run links
    why: Only a real runner, a real issue and the real Archon UI show that comments are posted with the agent's login and that the run link opens over the tailnet.
verify_after_merge:
  - scripts/test-issue.sh
  - scripts/test-render-run.sh
  - scripts/test-devflow-pack.sh
  - scripts/test-admin-tools.sh
final_checks:
  - "grep -q 'mod-devflow-issue' packs/devflow/archon-plugin.json"
  - "grep -q 'ARCHON_PUBLIC_URL' README.md && grep -q 'devflow-issue' packs/devflow/README.md"
  - "scripts/test-issue.sh && scripts/test-render-run.sh && scripts/test-devflow-pack.sh && scripts/test-admin-tools.sh"
phases:
  - id: p1-issue-helper
    title: The pure issue helper (.shared/issue.ts) and its unit tests
    depends_on: []
    complexity: M
    touches:
      - packs/devflow/.shared/issue.ts
      - scripts/test-issue.sh
      - .claude/toolkit.yaml
    brief: |
      Read the plan's Design section ".shared/issue.ts (exact contract)" first; every name, regex and string
      is there. The node CLI (issue-node.ts) is phase p2, not this one.
      1. Create packs/devflow/.shared/issue.ts with exactly the exported functions and types of the contract.
         Pure functions first (parseIssue, parseRunRefs, inheritedIssue, runLink, marker, earlierRun,
         startedBody, endedBody, readyBody, firstFailedNode), then the gh wrappers. postComment spawns `gh issue comment <n> --body-file -`
         with the body on stdin via Bun.spawnSync (copy the stdin pattern of api() in .shared/gh.ts);
         checkIssue uses api("GET", `repos/${repo}/issues/${n}`) from .shared/gh.ts: status not_found ->
         "#<n> does not exist in <repo>", data.pull_request present -> "#<n> is a pull request", other
         non-ok -> "cannot read #<n>: <message>", ok -> "". None of the wrappers throws.
      2. Create scripts/test-issue.sh (bash, `set -euo pipefail`, executable, header comment like
         scripts/test-render-run.sh, unset INPUTS_* first as that file does). It must:
         a. Run a `bun -e` block importing packs/devflow/.shared/issue.ts that asserts, printing FAIL and
            exiting 1 on any mismatch:
            - parseIssue with repo "o/r": "#42" -> 42; " 42 " -> 42; "Fix https://github.com/o/r/issues/42"
              -> 42; "plan #42 please" -> 42; "#42 and https://github.com/O/R/issues/42" -> 42;
              "#42 see also #17" -> "" with reason containing "#17, #42"; "https://github.com/x/y/issues/5"
              -> ""; "https://github.com/o/r/pull/5" -> ""; "other/repo#5" -> ""; "fix 3 bugs" -> "".
            - runLink: ("https://h.ts.net", "abc-1") -> "https://h.ts.net/console/r/abc-1";
              ("https://h.ts.net/", "abc") has no "//console"; undefined, "", "http://h", "https://h x" and
              runId "" each give "".
            - startedBody plan without link has no "Open the run in Archon" and ends with
              "<!-- devflow:plan run=R event=started -->"; with earlier {runId:"E",event:"started"} it
              contains "Replaces the earlier plan run `E` (status unknown)."; with earlier
              {runId:"E",event:"started",status:S} it contains "(cancelled)" for S "cancelled", "(failed)" for
              "failed", "(plan published)" for "completed", "(still running)" for "running", "paused" and
              "pending", and "(status unknown)" for "weird"; with event "ready" and status "cancelled" it
              still says "(plan published)"; startedBody run has
              "### Implementation started" and a devflow:run marker.
            - endedBody for the four kind/event pairs has the four headings, contains "at node `n`", and
              with node "" contains "Run `R` failed." ; no body contains the string "stderr".
            - readyBody: contains the plan, prerequisites, after and workflow URLs under
              https://github.com/o/r/blob/plans/plans/, omits prerequisites/after lines when false, shows
              the extraWorkflowSources block only when configured is false, the "No assumptions" line
              when assumptions is empty, and ends with event=ready.
            - parseRunRefs("finish this plan, archon id: 11111111-2222-3333-4444-555555555555", "R") ->
              ["11111111-2222-3333-4444-555555555555"]; the same id twice plus the own id -> one entry;
              uppercase input comes back lowercased; "no ids" -> [].
            - inheritedIssue with {workflow_name:"o/devflow:devflow-plan", codebase_id:"C", nodes:[{nodeId:
              "issue", state:"completed", outputPreview:"{\"issue\":\"42\",\"posted\":true,\"message\":\"x"}]}
              and "C" -> "42"; with "D" -> ""; with "" -> ""; workflow_name "o/devflow:devflow-run-s" -> "";
              issue node state "failed" -> ""; outputPreview "{\"issue\":\"\",..." -> "".
            - startedBody plan with continues "E" contains "Continues the earlier plan run `E`." and no
              "Replaces", even when earlier is set.
            - earlierRun ignores other authors and the own run id, picks the last earlier run, returns its
              last event.
            - firstFailedNode({nodes:[{nodeId:"a",state:"completed"},{nodeId:"comment-end",state:"failed"},
              {nodeId:"b",state:"failed"}]}) -> "b"; ({}) -> "".
         End with `echo "test-issue: all ok"`. Phase p2 adds the end-to-end node-script checks just
         before that line, so keep the unit checks in one `bun -e` block above it.
      3. In .claude/toolkit.yaml add `- bash -n scripts/test-issue.sh` to verify.fast (after the
         test-admin-tools bash -n line) and `- scripts/test-issue.sh` to verify.dod.
      Stop with status=blocked if .shared/gh.ts has no `api()` that writes a request body to the child's
      stdin, or no `repoSlug()`, since postComment and checkIssue copy them.
    acceptance:
      - 'scripts/test-issue.sh prints "test-issue: all ok" and exits 0'
      - "grep -c 'export function' packs/devflow/.shared/issue.ts prints 15"
      - "bun -e 'import(\"./packs/devflow/.shared/issue.ts\")' exits 0"
      - "grep -q 'scripts/test-issue.sh' .claude/toolkit.yaml"

  - id: p2-issue-node
    title: The node CLI (.shared/issue-node.ts), published.json and their end-to-end tests
    depends_on: [p1-issue-helper]
    complexity: M
    touches:
      - packs/devflow/.shared/issue-node.ts
      - packs/devflow/.shared/publish-plan.ts
      - scripts/test-issue.sh
      - scripts/test-render-run.sh
    brief: |
      Read the plan's Design sections ".shared/issue-node.ts (node CLI contract)" and "publish-plan.ts:
      published.json" first. packs/devflow/.shared/issue.ts exists from phase p1; do not change its exports.
      1. Create packs/devflow/.shared/issue-node.ts implementing the node CLI contract (modes detect-start,
         start, stopped, end; kinds plan, run). Use input() from .shared/util.ts with required=false for
         every input, read the run's own data with `archon workflow get <id> --json` / `--json --verbose`
         through run() from util.ts (never fail, must or artifactsDir: they exit 1; read process.env.ARTIFACTS_DIR
         directly), and wrap everything so the script always exits 0 and prints exactly one
         JSON line {"issue","posted","message"} on stdout; diagnostics go to stderr.
         Run the CLI body at module top level, like .shared/publish-plan.ts (no `import.meta.main` guard):
         the thin entries only import it. Check the `issue` input before any gh or archon call.
      2. In packs/devflow/.shared/publish-plan.ts, after writeFileSync(... "published.md" ...), write
         $ARTIFACTS_DIR/published.json as described in the Design (import the Published type from
         ./issue.ts). Do not change published.md's text or the node's stdout.
      3. In scripts/test-issue.sh, before the final `echo "test-issue: all ok"`, add end-to-end runs of packs/devflow/.shared/issue-node.ts with stub `gh` and `archon` scripts
            first on PATH (written into a mktemp dir, as scripts/test-render-run.sh d3 does) that append
            their argv and stdin to a log file and print canned output, matching on the whole argv with `case "$*" in` patterns
            because api() calls `gh api -X GET -H "Accept: ..." <endpoint>` (gh repo view -> o/r;
            *repos/o/r/issues/42* -> {"number":42}; gh api user -> bot; gh issue view -> a canned comments
            JSON with one earlier bot comment ending in `<!-- devflow:plan run=E0 event=started -->`;
            archon workflow get E0 --json -> {"status":"cancelled"}, or exit 1 when $E0_FAIL is set;
            archon workflow get P --json --verbose -> canned JSON with one failed node "phase-p1";
            any other archon workflow get <id> --json or --json --verbose (the child's own WORKFLOW_ID) ->
            {"parent_run_id":"P","nodes":[{"nodeId":"comment","state":"running"}]};
            gh pr list -> value of $PRS, default 0; put the specific E0, P, R and D15 patterns before the
            catch-all `archon workflow get` pattern):
            - detect-start/plan with USER_MESSAGE="Fix #42" and ARCHON_PUBLIC_URL=https://h.ts.net
              WORKFLOW_ID=R: stdout has "issue":"42" and "posted":true; the logged comment body has
              "### Planning started", "https://h.ts.net/console/r/R",
              "Replaces the earlier plan run `E0` (cancelled).", and not "Fix"; with E0_FAIL=1 the body has
              "Replaces the earlier plan run `E0` (status unknown)." and stdout still has "posted":true.
            - detect-start with USER_MESSAGE="no reference here": "issue":"" , "posted":false, no
              `issue comment` call in the log.
            - D15: the archon stub also answers `workflow get 11111111-2222-3333-4444-555555555555 --json
              --verbose` with a devflow-plan run of codebase_id "C" whose issue node completed with preview
              {"issue":"42",...}, and `workflow get R --json` with codebase_id "C" (codebase_id "D" when
              $OTHER_CB is set). detect-start with USER_MESSAGE="finish this plan, archon id:
              11111111-2222-3333-4444-555555555555" -> "issue":"42", "posted":true, and the body has
              "Continues the earlier plan run `11111111-2222-3333-4444-555555555555`." and no "Replaces";
              with OTHER_CB=1 -> "issue":"" and no `issue comment` call.
            - Every stdout line starts with {"issue":.
            - end/plan with WORKFLOW_ID=P and $ARTIFACTS_DIR/published.json present -> body has "### Plan
              ready"; without it -> body has "### Planning failed" and "at node `phase-p1`".
            - end/run with WORKFLOW_ID=K (the child) and PRS=1 -> posted false and message contains "a pull request exists"; PRS=0 ->
              "### Implementation failed", "at node `phase-p1`", and the link uses run id P (so the
              failed node is read from the parent P, not from the child's own run).
            - stopped/plan node=interview -> "### Planning stopped" and "at node `interview`".
            - a failing `gh issue comment` (stub exits 1 when $GH_FAIL is set) still exits 0 with
              "posted":false.
            - issue "abc" -> "posted":false, message "invalid issue 'abc'".
      4. In scripts/test-render-run.sh section f, after the first `publish > "$scratch/publish1.json"`,
         assert $pub_art/published.json exists and contains "\"slug\":\"s\"", "\"after\":true",
         "\"prerequisites\":false" and "\"configured\":false".
      Stop with status=blocked if `archon workflow get <id> --json --verbose` on this host prints no
      `nodes[].nodeId`/`nodes[].state`/`nodes[].outputPreview`, or no `parent_run_id`, `workflow_name` or
      `codebase_id` key (check with any id from
      `archon workflow runs --json`), since the contract depends on that shape.
    acceptance:
      - 'scripts/test-issue.sh prints "test-issue: all ok" and exits 0'
      - 'scripts/test-render-run.sh prints "publish-plan: ok" and "test-render-run: all ok"'
      - 'INPUTS_MODE=start INPUTS_KIND=plan INPUTS_ISSUE= WORKFLOW_ID=R bun packs/devflow/.shared/issue-node.ts prints {"issue":"","posted":false,"message":"no issue"} and exits 0'

  - id: p3-archon-public-url
    title: bootstrap.sh writes ARCHON_PUBLIC_URL from Tailscale; root README documents it
    depends_on: []
    complexity: S
    touches:
      - bootstrap.sh
      - scripts/test-admin-tools.sh
      - README.md
    brief: |
      Read the plan's Design section "ARCHON_PUBLIC_URL in bootstrap.sh (D11)"; the code to add is there verbatim.
      1. bootstrap.sh: add the env_default function and the ts_dns block directly after the line
         `has_env() { grep -q "^$1=.\+" "$ENV_FILE"; }` (before the Slack block and before section 7, so the
         env_sum check restarts Archon when the line was added). Add the commented template line inside the
         .env heredoc after `# SLACK_STREAMING_MODE=batch`, and the `Run links` line in the summary after
         the `Web UI` line.
      2. scripts/test-admin-tools.sh: update its header comment to mention env_default. Append a block in the
         style of the fetch_admin_file tests; put it after the final `rm -rf "$work" "$TMPDIR"` line and begin
         it with `unset TMPDIR; envd=$(mktemp -d)`, create the test files under "$envd" and end the block with
         `rm -rf "$envd"` (the fetch_admin_file block exported TMPDIR to a directory it has already removed,
         so a bare `mktemp` after it fails under `set -euo pipefail`). The block: `eval "$(sed -n '/^env_default() {/p' bootstrap.sh)"` (env_default
         is a one-line function), fail if `declare -F env_default` finds nothing, then:
         - absent: an empty temp file gets `ARCHON_PUBLIC_URL=https://a.ts.net` -> exactly that one line;
         - present: a file with `ARCHON_PUBLIC_URL=https://custom` keeps it and has one such line after a
           second call with another value;
         - other keys untouched: a file with `PORT=1` keeps `PORT=1`;
         - ordering: the line number of `env_default "$ENV_FILE" ARCHON_PUBLIC_URL` in bootstrap.sh is
           lower than that of `# ---------------------------------------------------------------- 7. service`.
         They print exactly, in this order: `ok - env_default appends a missing key`,
         `ok - env_default keeps an existing key`, `ok - env_default leaves other keys alone`,
         `ok - ARCHON_PUBLIC_URL is written before the service section`.
      3. README.md: in "## 3. After: one-time logins on the VM" (l.137-156, the section that lists the
         `.env` keys), after the paragraph at l.154-156 that ends "`~/.archon/.env` with the new `gh auth token`." and
         before the paragraph "Then re-run the bootstrap (same command as above).", add a short paragraph: bootstrap.sh adds
         `ARCHON_PUBLIC_URL=https://<machine>.<tailnet>.ts.net` to `~agent/.archon/.env` when Tailscale is
         up; devflow's issue comments link each run there (`<ARCHON_PUBLIC_URL>/console/r/<run id>`), so the
         tailnet hostname is visible to everyone who can read the repository's issues, while the link only
         opens on the tailnet; to use another address, edit the line and `sudo systemctl restart archon`;
         delete the line to drop the links; runners set up earlier get it by re-running bootstrap.sh.
         Add one bullet to "## Security notes" saying the same about the hostname in issue comments.
      Stop with status=blocked if bootstrap.sh no longer has `has_env()` right after the .env heredoc or the
      `7. service` header, since the placement depends on both.
    acceptance:
      - "bash -n bootstrap.sh exits 0"
      - 'scripts/test-admin-tools.sh exits 0 and prints "ok - env_default appends a missing key", "ok - env_default keeps an existing key", "ok - env_default leaves other keys alone" and "ok - ARCHON_PUBLIC_URL is written before the service section"'
      - "grep -q 'env_default \"$ENV_FILE\" ARCHON_PUBLIC_URL' bootstrap.sh"
      - "grep -q 'ARCHON_PUBLIC_URL' README.md"

  - id: p4-plan-run-comments
    title: devflow-plan detects the issue and posts started, stopped, ready and failed comments
    depends_on: [p2-issue-node]
    complexity: M
    touches:
      - packs/devflow/devflow-plan/devflow-plan.yaml
      - packs/devflow/devflow-plan/scripts/issue-comment.ts
      - packs/devflow/devflow-plan/fixtures/*.stubs.yaml
    brief: |
      Read the plan's Design section "devflow-plan nodes (exact)".
      1. Create packs/devflow/devflow-plan/scripts/issue-comment.ts with exactly the two lines given in the
         Design (thin entry importing ../../.shared/issue-node.ts).
      2. packs/devflow/devflow-plan/devflow-plan.yaml: add node `issue` after `preflight`; change `setup`
         depends_on to [issue]; add `comment-stopped` before `stop-at-interview` and change
         `stop-at-interview` depends_on to [interview, comment-stopped] (keep its when and cancel text);
         add `issue: "$issue.output.issue"` to the `render` node's with: inside plan-loop; add
         `comment-end` as the last node. Write output_format in the file's block style (as `plan-result`).
         Add one sentence to the workflow description: "When the work names one issue of this repository,
         the run comments on it: planning started, plan ready (with the links), or planning failed/stopped."
      3. Fixtures in packs/devflow/devflow-plan/fixtures/:
         - happy-path, interview-done, plan-test-never-clears: add stubs
           `issue: {issue: "", posted: false, message: "no issue"}` and
           `comment-end: {issue: "", posted: false, message: "no issue"}` (block style).
         - interview-user-stops: add the `issue` stub and
           `comment-stopped: {issue: "", posted: false, message: "no issue"}`.
         - new happy-path-issue.stubs.yaml: a copy of happy-path.stubs.yaml with the first comment line
           "# Green path with an issue: started, then the ready plan is commented." and stubs
           `issue: {issue: "42", posted: true, message: "posted"}` and
           `comment-end: {issue: "42", posted: true, message: "posted"}`.
         - new issue-user-stops.stubs.yaml: a copy of interview-user-stops.stubs.yaml with first comment line
           "# RED: an issue run whose answer says stop; the stop is commented, then the run is cancelled."
           and stubs issue (42, posted true) and comment-stopped (42, posted true); expect: cancelled.
         Every existing fixture gets the stubs above, including plan-test-never-clears (it has
         `exec-code: true`; a stubbed node still uses its stub, so the real script never runs there).
      4. Run scripts/test-devflow-pack.sh; every fixture must keep its expected outcome
         (plan-test-never-clears still `failed` at `plan-result`).
      Stop with status=blocked if `archon validate workflows` rejects the `{ from, if_skipped }` binding on
      comment-end or the transitive `$issue.output.issue` bindings, or if plan-test-never-clears no longer
      fails at plan-result; quote the error, do not reshape the graph.
    acceptance:
      - 'scripts/test-devflow-pack.sh exits 0 (validate plus every fixture, including happy-path-issue and issue-user-stops)'
      - "grep -q 'trigger_rule: all_done' packs/devflow/devflow-plan/devflow-plan.yaml && grep -q 'id: comment-end' packs/devflow/devflow-plan/devflow-plan.yaml"
      - "grep -A3 'id: setup' packs/devflow/devflow-plan/devflow-plan.yaml | grep -q 'depends_on: \\[issue\\]'"
      - 'INPUTS_MODE=start INPUTS_KIND=plan INPUTS_ISSUE= WORKFLOW_ID=R bun packs/devflow/devflow-plan/scripts/issue-comment.ts prints {"issue":"","posted":false,"message":"no issue"} and exits 0'

  - id: p5-run-workflow-comments
    title: render-run emits the issue header and mod-devflow-issue nodes; the new building block
    depends_on: [p2-issue-node]
    complexity: M
    touches:
      - packs/devflow/.shared/render-run.ts
      - packs/devflow/.shared/render-plan.ts
      - packs/devflow/devflow-plan/scripts/test-plan.ts
      - packs/devflow/mod-devflow-issue/**
      - packs/devflow/archon-plugin.json
      - scripts/test-render-run.sh
    brief: |
      Read the plan's Design sections "The rendered devflow-run-<slug> with an issue (exact)" and
      "mod-devflow-issue (new building block)". Leave `deliver.with.issue` to phase p6.
      1. packs/devflow/.shared/render-run.ts: add `issue?: string` to RenderOpts; validate it in validate();
         when non-empty, add the nodes issue-start, issue-stopped-prerequisites (only with prerequisites),
         issue-stopped-worktrees and issue-end exactly as the Design says, change the depends_on/trigger_rule
         of prerequisites or worktree-check and of the two stop-at-* nodes as described, and prefix the
         returned text with `# devflow-issue: <n>\n`. With issue unset or "" every code path must produce
         exactly today's output (guard every addition with one `const iss = o.issue ?? ""; if (iss) …`).
         CLI: accept `--issue <n>` and pass `issue: flag.issue ?? ""`; add `[--issue n]` to the usage text.
      2. packs/devflow/.shared/render-plan.ts: `const issue = input("issue", false);` pass `issue` to
         renderRunWorkflow; when non-empty add "mod-devflow-issue" to the list checked at the
         `const missing = [...]` line (same message format).
      3. packs/devflow/devflow-plan/scripts/test-plan.ts: change `need` to
         `[...(doc.nodes ?? []).filter((n: any) => n.workflow !== undefined && n.when === undefined).map((n: any) => n.id), "result"]`.
      4. Create packs/devflow/mod-devflow-issue/mod-devflow-issue.yaml (Design text, block style),
         packs/devflow/mod-devflow-issue/scripts/issue-comment.ts (thin entry, same two lines as in the
         Design) and packs/devflow/mod-devflow-issue/fixtures/happy-path.stubs.yaml. Add the entrypoint
         `"mod-devflow-issue": "mod-devflow-issue/mod-devflow-issue.yaml"` to packs/devflow/archon-plugin.json
         after mod-devflow-deliver; the plugin description stays as it is.
      5. scripts/test-render-run.sh:
         - section a: also render three-wide with `--issue 42` to "$scratch/three-wide-issue.yaml" and
           serial with `--issue 7` to "$scratch/serial-issue.yaml";
         - section b: copy both into the scratch repo as devflow-run-three-wide-issue / devflow-run-serial-issue
           after changing their `name:` lines accordingly (sed on the second line, since line 1 is the header),
           and validate them like the others;
         - section c: add assertions: line 1 of three-wide-issue.yaml is `# devflow-issue: 42`; its node ids
           are the old three-wide ids plus issue-start, issue-stopped-prerequisites, issue-stopped-worktrees,
           issue-end; issue-start is nodes[0]; prerequisites.depends_on == ["issue-start"] and trigger_rule
           all_done; stop-at-prerequisites.depends_on == ["prerequisites","issue-stopped-prerequisites"];
           stop-at-worktrees.depends_on == ["confirm-worktree-removal","issue-stopped-worktrees"];
           issue-end.depends_on == ["result"], trigger_rule all_done, with.mode "end";
           every issue-* node's workflow is "test/devflow:mod-devflow-issue"; in serial-issue.yaml
           worktree-check.depends_on == ["issue-start"]; and `grep -q issue` finds nothing in
           "$scratch/serial.yaml" and "$scratch/three-wide.yaml" (no-issue output unchanged);
         - section d2: `--issue 4x` fails with "invalid issue";
         - section d3: with INPUTS_ISSUE=42 and $list_ok (no mod-devflow-issue) the node fails with
           "has no test/devflow:mod-devflow-issue"; with a list that adds test/devflow:mod-devflow-issue it
           prints "ok":true and the rendered file's first line is `# devflow-issue: 42`;
         - section d4: render serial with `--issue 7` to "$scratch/t-serial-issue.yaml" and assert
           tp_run on it prints "ok":true (the dry run stubs issue-start and issue-end).
      Stop with status=blocked if the dry run in test-plan.ts reports issue-end or result as not stubbed,
      or `archon validate` rejects a workflow node whose `with:` has an empty string value; quote the output.
    acceptance:
      - 'scripts/test-render-run.sh prints "structure: ok", "render-run node: ok", "test-plan: ok" and "test-render-run: all ok"'
      - 'scripts/test-devflow-pack.sh exits 0 (mod-devflow-issue validates and its fixture passes)'
      - "grep -q '\"mod-devflow-issue\"' packs/devflow/archon-plugin.json"
      - 'INPUTS_MODE=start INPUTS_KIND=run INPUTS_ISSUE= WORKFLOW_ID=R bun packs/devflow/mod-devflow-issue/scripts/issue-comment.ts prints {"issue":"","posted":false,"message":"no issue"} and exits 0'

  - id: p6-pr-closes-issue
    title: The rendered deliver node passes the issue and the PR always says Closes #<n>
    depends_on: [p5-run-workflow-comments]
    complexity: S
    touches:
      - packs/devflow/.shared/render-run.ts
      - packs/devflow/.shared/load-plan.ts
      - packs/devflow/mod-devflow-deliver/mod-devflow-deliver.yaml
      - packs/devflow/mod-devflow-tail/commands/open-pr.md
      - scripts/test-render-run.sh
    brief: |
      Read the plan's Design section "PR closes the issue (D10)".
      1. packs/devflow/.shared/render-run.ts: when issue is non-empty, add `issue: <n>` (string) as the last
         key of the deliver node's `with:`. Nothing changes without an issue.
      2. packs/devflow/mod-devflow-deliver/mod-devflow-deliver.yaml: add the `issue` input after `head`.
      3. packs/devflow/.shared/load-plan.ts: in the deliver branch read and validate issue; add it to
         context.json only when non-empty, as the Design says.
      4. packs/devflow/mod-devflow-tail/commands/open-pr.md: the two edits of the Design (run facts list;
         the "What this changes" bullet).
      5. scripts/test-render-run.sh:
         - section c: the three-wide-issue deliver node has with.issue == "42"; the no-issue deliver has no
           `issue` key.
         - section e: after "load-plan deliver: ok" (the clone is then on feat/other), run
           `git switch -q feat/serial`, then
           `INPUTS_MODE=deliver INPUTS_ISSUE=42 lp env` and assert context.json contains "\"issue\":\"42\"";
           without INPUTS_ISSUE assert context.json has no "issue"; with INPUTS_ISSUE=4x the loader fails
           with "invalid issue".
      Stop with status=blocked if the no-issue renders in section c gain an `issue` key, or load-plan's
      existing "load-plan deliver: ok" check fails after the change; quote the output.
    acceptance:
      - 'scripts/test-render-run.sh prints "structure: ok", "load-plan deliver: ok" and "test-render-run: all ok"'
      - 'scripts/test-devflow-pack.sh exits 0'
      - "grep -q 'Closes #<issue>' packs/devflow/mod-devflow-tail/commands/open-pr.md"

  - id: p7-refine-keeps-issue
    title: devflow-refine reads the issue header back and re-renders with it
    depends_on: [p6-pr-closes-issue]
    complexity: S
    touches:
      - packs/devflow/devflow-refine/scripts/load-published.ts
      - packs/devflow/devflow-refine/devflow-refine.yaml
      - packs/devflow/devflow-refine/fixtures/*.stubs.yaml
      - scripts/test-render-run.sh
    brief: |
      Read the plan's Design section "Refine keeps the issue (D9)".
      1. packs/devflow/devflow-refine/scripts/load-published.ts: read the header and add `issue` to the
         final JSON (after `work`).
      2. packs/devflow/devflow-refine/devflow-refine.yaml: load.output_format gets `issue` in properties and
         required; the render node's with: gets `issue: "$load.output.issue"`. Add `issue: ""` to the load
         stub of happy-path, interview-user-stops and refuse-started fixtures.
      3. scripts/test-render-run.sh:
         - section g: change the existing serial publish line
           `printf 'name: devflow-run-serial\nnodes: []\n' > "$pub_art/devflow-run-serial.yaml"` (right
           after `cp "$fx/serial.md" "$pub_art/plan.md"`) to
           `printf '# devflow-issue: 9\nname: devflow-run-serial\nnodes: []\n' > "$pub_art/devflow-run-serial.yaml"`.
           Then, after the existing first `out="$(lp2 env USER_MESSAGE="$msg1")"` check that greps
           "slug":"serial", also grep that output for "\"issue\":\"9\""; after the three-wide URL check
           (grep "slug":"three-wide"), also grep that output for "\"issue\":\"\"" (three-wide is
           published without a header).
      Stop with status=blocked if lp2 for serial does not print "issue":"9" after the header change, or
      the refine fixtures change outcome.
    acceptance:
      - 'scripts/test-render-run.sh prints "load-published: ok" and "test-render-run: all ok"'
      - 'scripts/test-devflow-pack.sh exits 0'
      - "grep -q 'issue: \"$load.output.issue\"' packs/devflow/devflow-refine/devflow-refine.yaml"

  - id: p8-docs
    title: Retirement - document issue comments in the devflow pack README
    depends_on: [p3-archon-public-url, p4-plan-run-comments, p7-refine-keeps-issue]
    complexity: S
    touches:
      - packs/devflow/README.md
    brief: |
      There is no ADR directory and no changelog in this project's profile, and the plan is not in the
      repository, so this phase only updates the pack's reference doc.
      1. packs/devflow/README.md:
         - Line 3: "Seven workflows (and the building blocks mod-devflow-phase, mod-devflow-deliver and
           mod-devflow-issue)".
         - Line 31-32: add mod-devflow-issue to the building blocks a generated devflow-run-<slug> starts.
         - Step 3 "Render" (l.79-82): add that with an issue it also checks for `mod-devflow-issue`.
         - In "## devflow-plan, step by step", add a paragraph after step 5 titled "**Issue comments**":
           when `work` (or the message) names exactly one issue of this repository (`#<n>`, `<n>` alone,
           or its URL), the run posts "Planning started", then "Plan ready: <title>" with links to
           plan.md, prerequisites.md, after.md and the workflow file plus the start commands, or
           "Planning failed"/"Planning stopped" with the node and run id (never the error text); no issue,
           or several, means no comments; a repeated plan run says which earlier run it replaces; a run
           resumed with "finish this plan, archon id: <run id>" (no issue named) keeps the issue of that
           earlier devflow-plan run of the same project and says it continues it; each
           comment links the run in Archon when ARCHON_PUBLIC_URL is set (root README).
         - In the same paragraph, a note: to abandon an issue-linked run, answer "stop" in the interview
           or reject the approval instead of cancelling it in Archon; a cancel posts nothing, so the
           issue keeps "… started" until the next plan run, whose "Replaces" line then shows the
           earlier run's real status (cancelled, failed, plan published or still running).
         - After the devflow-run paragraph: the generated workflow carries `# devflow-issue: <n>` on its
           first line, posts "Implementation started", posts "Implementation failed/stopped" only while no
           pull request exists from its branch, and its PR says `Closes #<n>`.
         - In "## devflow-refine, step by step" step 4: the refined workflow keeps the plan's issue
           (`# devflow-issue: <n>`); refine itself posts nothing on the issue.
         - In "## Prove changes": `scripts/test-issue.sh` tests the issue helper (detection, comment
           bodies, the node script with stubbed gh and archon).
      2. Check that README.md (root) mentions ARCHON_PUBLIC_URL (phase p3) and that nothing in either README
         contradicts the Design.
    acceptance:
      - "grep -q 'devflow-issue' packs/devflow/README.md"
      - "grep -q 'Planning started' packs/devflow/README.md"
      - "grep -q 'scripts/test-issue.sh' packs/devflow/README.md"
      - "grep -q 'mod-devflow-issue' packs/devflow/README.md"
      - "grep -qi 'instead of cancelling' packs/devflow/README.md"
```

