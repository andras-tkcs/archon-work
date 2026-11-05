# devflow-plan and devflow-refine: batched interview rounds, and an incomplete plan instead of a failed run

## Goal

Today's `devflow-plan` runs ask one question per interview round with a cap of 14 questions, and a
run that reaches a cap ends with nothing published: the interview cap cancels the run, and a plan
test that still has render or `validate_manifest` findings after its fix rounds fails it. This
change makes the interview ask up to **5 questions per round over at most 3 rounds** (the
challenger's questions are merged into the same round), and makes both caps **publish the plan as
far as it got**, with a note at the top of plan.md that says it is incomplete, which questions or
findings are still open, and that `devflow-refine` continues it. `devflow-refine` gets the same
interview and continues an incomplete plan from its bare slug. Source: the run's message (no issue).

## Current state

From today's run logs (`~/.archon/workspaces/tkcs-lab/archon-work/logs/`) and the code at e451275:

- Runs `5bffc65c…` (11 questions) and `dedc460c…` (5 questions) failed in `plan-loop`: "the plan
  still has N findings after 2 fix rounds; nothing was published". Run `ab1555dc…` asked 13
  questions, Q1–Q2 by the planner and Q3–Q13 by the challenger, one per round, one short of the
  14-question cancel.
- Interview loop: `packs/devflow/devflow-plan/devflow-plan.yaml:53-109`, `loop_group`
  `max_iterations: 15`. `draft` returns `status: ask|done|stop` and one `question`; `challenge` runs
  only when `status == 'done'` and returns one `question`; `next` (`.shared/next-question.ts`,
  58 lines, `MAX_QUESTIONS = 14`) appends `## Q<n> (asked by: …)` to `interview.md` and, at the cap,
  writes `## Stopped` and returns `stop: true`. `stop-at-interview` (`devflow-plan.yaml:111-114`)
  cancels "…or 14 questions without converging".
- `packs/devflow/devflow-refine/devflow-refine.yaml:79-141` has the same loop and cancel; both
  workflows reach `.shared/next-question.ts` through the thin entries
  `devflow-plan/scripts/next-question.ts` and `devflow-refine/scripts/next-question.ts`.
- `devflow-plan/commands/draft.md` ("exactly **one** question", "one question at a time, never a
  list") and `challenge.md` ("find one more"), and their refine copies, which differ only in the
  refine-specific lines (`diff` shows the plan input lines, the copy-`original/plan.md` rule, the
  unresolved-warning drop rule and "Never re-open a decision the original plan records").
- Plan-test loop: `.shared/check-plan.ts` (74 lines, `MAX_ROUNDS = 3`). Since 877ee61 (PR #25) it
  publishes when only `review` findings remain: it writes `unresolved.md` and `tested.json` with
  `unresolved`. When any render or `validate_manifest` finding remains it `fail`s
  (`check-plan.ts:54-56`), so `plan-result` has no `tested.json` and nothing is published.
- `.shared/render-plan.ts` (the `render` node) returns `{ok:false, workflow:"", file:""}` on a plan
  error with `soft_errors`, so a blocked plan has no `devflow-run-<slug>.yaml` in the artifacts.
- `.shared/publish-plan.ts` (158 lines): inserts the unresolved block into "Risks and open
  questions" and a `> [!WARNING]` under the title (`:23-54`), copies plan.md, prerequisites.md,
  after.md and `<workflow>.yaml` into a temporary worktree of the plans branch (`:69-78`), commits
  and pushes without force, writes `published.md` (`:105-156`) with the plan's `## Assumptions`.
- `.shared/plan-result.ts` prints `slug, branch, title, workflow` from `tested.json`.
- `devflow-refine/scripts/load-published.ts` (129 lines) needs a parseable manifest
  (`extractManifest`, `:65-70`) whose `plan_slug` equals the directory and a `feature_branch`
  (`:71-75`); it fails a bare slug with "Not refined: say what to change in the plan <slug>…"
  (`:79-88`); it refuses a started plan by branch or merged commits/PRs (`:90-112`), not by the
  workflow file.
- Tests: `scripts/test-devflow-pack.sh` replays the pack's fixtures (`archon workflow test`);
  `scripts/test-render-run.sh` (382 lines) unit-tests the scripts: `d5` check-plan (`:168-197`),
  `f` publish-plan against a bare origin (`:255-318`), `g` load-published (`:322-373`). There is
  no unit test of next-question.ts. Plan fixtures: `scripts/fixtures/render-run/serial.md`
  (`plan_slug: serial`, `feature_branch: feat/serial`).
- Docs: `packs/devflow/README.md` (table row `:19-20`, "devflow-plan, step by step" `:72-110`,
  "devflow-refine, step by step" `:112-138`). The profile has no ADRs and no changelog.

## Design

### Decisions from the interview

- **D1 (the work)**: batch questions: more questions per round, fewer rounds.
- **D2 (the work)**: when the interview cap is reached, do not cancel: finalize and publish the
  plan, with a note at the top of plan.md saying it is incomplete, listing the further questions,
  ready for `devflow-refine` as continuation.
- **D3 (Q1 = a)**: up to **5** questions per round, at most **3** rounds. The challenger adds its
  questions to the planner's batch in the same round (it runs every round, not only after
  `done`), never in a round of its own. Whatever is open after round 3 goes into the incomplete
  plan (D2).
- **D4 (code)**: `devflow-refine` gets the same change: it shares `next-question.ts`, its commands
  mirror devflow-plan's, and it is the continuation path.
- **D5 (code, wording from the work)**: the note is a `> [!WARNING]` block under the plan title,
  inserted by `publish-plan.ts` like the unresolved-findings warning. Exact text: "Incomplete plan"
  below.
- **D6 (Q2 = a)**: both caps publish. (1) Interview out of rounds: open questions are taken at
  their recommended defaults under `## Assumptions`, listed in the note, and the workflow is
  published if the plan renders and validates. (2) Plan-test loop out of fix rounds with render or
  `validate_manifest` findings: plan.md is published with the note, and the workflow is
  **withheld**; `devflow-refine` publishes it once the plan is fixed. Both reasons can appear in
  one note.
- **D7 (code)**: a plan with no usable manifest (no fenced yaml block under
  the implementation-manifest heading, no phases, a `plan_slug` other than the slug, or no
  `feature_branch`) still fails as today, because `load-published.ts` could not load it. A later
  clean refine republishes plan.md without the note and publishes the workflow again
  (publish-plan rebuilds the note from each run's own inputs).
- **D8 (Q7 = a)**: automatic continuation: `load-published.ts` recognises an incomplete plan by the
  note and accepts its bare slug; refine's first round re-asks every open question with its
  original options and recommendation, ranked with any new ones; the remaining blocking findings
  are fixed; Assumptions that came from defaulted open questions are not settled decisions. A
  change in the same message is handled in the same run.
- **D9 (Q3 = c)**: two words. `stop` (also "cancel", "not now", an explicit refusal) abandons the
  run with nothing published; `publish` (also "enough", "finish with what you have") ends the
  interview now and publishes an incomplete plan exactly as the round cap does. Every round's
  prompt names both.
- **D10 (Q4 = a)**: when the workflow is withheld, `publish-plan.ts` also removes an existing
  `<plans_dir>/workflows/devflow-run-<slug>.yaml` from the plans branch in the same commit.
- **D11 (Q5 = a)**: a reply may answer only some questions ("1: a, 3: c"). Each given answer is
  recorded; a skipped question is asked again in a later round (inside that round's 5); after
  round 3 it is defaulted and listed as open.
- **D12 (Q6 = c)**: the planner's new questions, the challenger's and the re-asked ones are ranked
  together by how much their answer would change the plan; the 5 most important are asked; the
  rest are carried over to the next round, and after round 3 are defaulted and listed as open.
  The challenge step ranks; `next-question.ts` cuts at 5.
- **D13 (Q8 = a)**: when the workflow of an incomplete plan is published, the note (in plan.md and
  published.md) adds: "Running `devflow-run-<slug>` now accepts the recommended defaults listed
  under Assumptions. After it starts, `devflow-refine` can no longer continue this plan." No
  confirmation step in the rendered workflow. Omitted when the workflow is withheld.

### Interview loop (both workflows)

Replace the `interview` loop's node schemas in `devflow-plan.yaml` and `devflow-refine.yaml`
(everything else in the loop, `ask` included, stays):

```yaml
  - id: interview
    # (refine keeps its depends_on: [load] and when: "$load.output.started == false")
    loop_group:
      # next-question.ts ends the interview by the 4th iteration (3 asking rounds + 1 that records
      # the last answers); 5 leaves one spare.
      max_iterations: 5
      nodes:
        - id: draft
          command: draft
          model: medium
          context: fresh
          output_format:
            type: object
            properties:
              status: { type: string, enum: [ask, done, stop, publish] }
              questions: { type: array, items: { type: string } }
              why_no_more: { type: string }
            required: [status, questions, why_no_more]

        - id: challenge
          depends_on: [draft]
          when: "$draft.output.status == 'ask' || $draft.output.status == 'done'"
          command: challenge
          model: medium
          context: fresh
          output_format:
            type: object
            properties:
              questions:
                type: array
                items:
                  type: object
                  properties:
                    question: { type: string }
                    by: { type: string, enum: [planner, challenger] }
                  required: [question, by]
              reason: { type: string }
            required: [questions, reason]

        - id: next
          # depends_on, trigger_rule, script, runtime and `with` unchanged
          output_format:
            type: object
            properties:
              done: { type: boolean }
              stop: { type: boolean }
              incomplete: { type: boolean }
              question: { type: string }
            required: [done, stop, incomplete, question]
```

The section comment `# ---- 1. The interview: one question at a time ----` becomes
`# ---- 1. The interview: up to 5 questions a round, at most 3 rounds ----`.

`stop-at-interview` cancel texts:

- devflow-plan: `Stopped while planning: you said stop, so the interview ended without a plan. The questions and answers are interview.md in the run artifacts.`
- devflow-refine: `Stopped while refining: you said stop, so the interview ended without a refined plan. The published plan is unchanged. The questions and answers are interview.md in the run artifacts.`

Workflow `description` first paragraph, devflow-plan: replace "It interviews you one question at a
time (the planner asks the most decisive open question, and before it stops a fresh reviewer tries
to find one more)" with "It interviews you in up to 3 rounds of up to 5 questions (the planner's
and a fresh reviewer's questions, ranked together; say "publish" to stop asking and publish the
plan as it is, or "stop" to abandon it), and when questions are still open at the end it
publishes an incomplete plan that devflow-refine continues". devflow-refine: replace "interviews you
one question at a time about what your request leaves open (a clear request needs no questions)"
with "interviews you about what your request leaves open in up to 3 rounds of up to 5 questions (a
clear request needs no questions; a plan published as incomplete is continued from its slug
alone)". Both `description` fields are `|` block scalars: write the quotes as plain `"`, and
re-wrap the paragraph to the file's line width.

### next-question.ts

`packs/devflow/.shared/next-question.ts` is rewritten. Files in `$ARTIFACTS_DIR`:
`interview.md` (appended), `carried.md` (rewritten or removed every call), `open-questions.md`
(written once, when the interview ends incomplete).

```ts
const MAX_ROUNDS = 3;
const PER_ROUND = 5;
type Q = { question: string; by: string };
```

1. Parse `draft` (required) and `challenge` (optional, `""` when skipped) as today.
2. `text` = interview.md or `"# Interview\n"`. `rounds` = count of `/^## Round \d+\s*$/gm`.
   `asked` = count of `/^### Q\d+ /gm` (global question numbers continue across rounds).
3. `draft.status === "stop"` → print `{done:true, stop:true, incomplete:false, question:""}`, exit
   0, no file touched.
4. `draftQs: Q[]` = `draft.questions` (array, default `[]`), each `String(x).trim()`, empty ones
   dropped, `by: "planner"`. `candidates: Q[]`: when `draft.status === "publish"` or `challenge`
   is null → `draftQs`; otherwise `challenge.questions` mapped to
   `{question: String(q.question ?? "").trim(), by: q.by === "challenger" ? "challenger" : "planner"}`,
   empty ones dropped (the challenger's list is the full ranked list, the planner's included).
5. Remove `carried.md` (`rmSync(..., {force:true})`).
6. `candidates.length === 0` → print `{done:true, stop:false, incomplete:false, question:""}`.
7. `draft.status === "publish" || rounds >= MAX_ROUNDS` → incomplete end:
   - `reason` = `You said "publish"` for publish, else `The interview ended after 3 rounds`.
   - Write `open-questions.md`: for candidate `i` (0-based), the block
     `### Q${asked + i + 1} (asked by: ${by})\n\n${question}\n`, blocks joined with `"\n"`.
   - Append to interview.md: `\n## Interview ended incomplete\n\n${reason} with ${k} open questions. They are in open-questions.md and are taken at their recommended defaults.\n`
     (`k` = `candidates.length`; `text.replace(/\n*$/, "\n")` before appending, as today).
   - Print `{done:true, stop:false, incomplete:true, question:""}`.
8. Otherwise ask round `r = rounds + 1`: `batch = candidates.slice(0, PER_ROUND)`,
   `carried = candidates.slice(PER_ROUND)`.
   - If `carried.length > 0`, write `carried.md`:
     `# Carried over to the next round\n\n` + blocks `### (asked by: ${by})\n\n${question}\n` joined
     with `"\n"`.
   - Append to interview.md `\n## Round ${r}\n` then, per batch item `i`,
     `\n### Q${asked + i + 1} (asked by: ${by})\n\n${question}\n`.
   - `question` output (exact):

     ```
     Round ${r} of 3 of the plan for this run: ${batch.length} question(s).

     **1.** (Q${asked+1})

     <question 1>

     ---

     **2.** (Q${asked+2})
     ...

     Answer in one reply, as "1: a, 2: c, …"; questions you skip are asked again next round. Say "publish" to stop asking and publish the plan as it is, or "stop" to abandon it.
     ```

     where "question(s)" is `question` for 1 and `questions` otherwise, items are separated by
     `\n\n---\n\n`, and when `r === MAX_ROUNDS` this paragraph follows after a blank line:
     `This is the last round: questions still open after it are taken at their recommended defaults, and the plan is published as incomplete, ready for devflow-refine.`
   - Print `{done:false, stop:false, incomplete:false, question}`.

`MAX_QUESTIONS`, the `## Stopped` block and the `## Q<n>` headings are gone.

### The interview commands (draft.md and challenge.md, both workflows)

**draft.md** (devflow-plan; devflow-refine gets the same edits in its copy, keeping its refine-only
lines):

- Intro: "You run once per interview round, and each round ends with one decision: ask the open
  questions, say you are done, publish the plan as it is, or stop."
- Rules bullet "You do not fill gaps…": "A decision that is the user's is asked: every open one,
  in this round's `questions`. The next steps rank them and ask at most 5 per round, in at most 3
  rounds."
- "Each round" step 1 also reads `$ARTIFACTS_DIR/carried.md` if it exists (questions that did not
  fit in the last round).
- Step 2 (replace): the previous round's reply is `$LOOP_PREV.ask.output.text` and the message it
  answers is `$LOOP_PREV.next.output.question`, whose items are `**<k>.** (Q<n>)`. If the reply is
  non-empty:
  - If it says to stop ("stop", "cancel", "not now", or an explicit refusal), return
    `status: stop` with `questions: []`.
  - Otherwise, for every `### Q<n>` block of the last `## Round <r>` block in interview.md, append
    the line `**Answer:** <the answer to item k>` under it, or `**Answer:** (not answered; asked
    again)` when the reply gives none. A reply of the form "1: a, 3: c" answers items 1 and 3; a
    free-form reply answers the items it clearly refers to.
  - If it says to publish now ("publish", "enough", "finish with what you have"), record the
    answers it gives as above, then return `status: publish` with `questions` = every question
    still open (step 4's list).
- Step 3 unchanged, plus: `## Open questions` lists every open question, the skipped and carried
  ones included.
- Step 4 (replace): return `status: ask` with `questions`: every open question whose answer is
  genuinely the user's (make-plan 0.3), most decisive first: each question skipped in the last
  round (its text as asked, options and recommendation unchanged), each question in `carried.md`
  (unchanged), then your new ones. No cap: the challenge step ranks them and the next step asks 5.
  Each question is self-contained markdown: the context in two sentences, the options as a list
  `- **a)** …`, and `**Recommendation: <letter>).**` with the reason. Never ask what reading the
  code or the ADRs settles.
- Step 5: `status: done` only when `## Open questions` is empty and `carried.md` does not exist;
  `questions: []`. The rest unchanged.
- Output: "Return `status` (`ask`, `done`, `publish` or `stop`), `questions` (the list; `[]` on
  `done` and `stop`) and `why_no_more` (the reasoning on `done`, else `""`)."

**challenge.md** (both workflows, refine keeps its extra line):

- Intro: "You are the **challenger** (a fresh session). You run every interview round, after the
  planner. Your job: find the user's decisions the planner missed, and rank all the round's
  questions."
- Inputs: the work, interview.md, plan-draft.md, profile.json, make-plan.md as today, plus the
  planner's questions `$draft.output.questions` (planner status `$draft.output.status`) and
  `$ARTIFACTS_DIR/carried.md` if it exists.
- Keep the "Look for a decision…" and "Check the claims…" paragraphs ("planner's
  `## Why no more questions`" only applies when the status is `done`).
- Output rules (replace the bullet list):
  - Return `questions`: the planner's questions and yours in one list, ranked by how much their
    answer would change the plan, most first; each `{question, by}` with `by: planner` for a
    planner's question (its text unchanged), the `by` that `carried.md` gives for a question
    carried over from the last round, and `by: challenger` for yours (self-contained
    markdown in the same form as the planner's). Drop none of the planner's. Only the first 5 are
    asked this round; the rest are carried over.
  - `reason`: why your questions are the user's to answer, or what you checked when you added
    none.
  - Never repeat a question already answered in interview.md, and never ask what reading the code
    settles. You write no files and change nothing.

### Open questions in the final plan (finalize.md, both workflows)

Add a section "## Open questions from the interview" after "## Inputs from the interview":

> If `$ARTIFACTS_DIR/open-questions.md` exists, the interview ended with questions still open
> (interview.md says why). For each `### Q<n>` block in it, take its recommended option, apply it
> in Design like an answer, and add one bullet to `## Assumptions`:
> `- **<the decision>**: <the recommended option>. Why: recommended default; the interview ended before it was answered (open question Q<n>).`
> Do not write an `## Open questions` section yourself: the publish step inserts one from
> open-questions.md. A plan that ended this way is still a full plan that passes
> `validate_manifest.py`.

And in "## Assumptions", the sentence "It lists every decision made after the interview" becomes
"It lists every decision made after the interview, and every open question's default (above)".

Two existing sentences contradict an incomplete interview and are replaced (both finalize.md files
have them; refine's bullet is at lines 36-37, plan's at lines 31-32):

- Line 2: "The interview is over: every question has been asked and answered." becomes "The
  interview is over: every question has been answered, or is listed in
  `$ARTIFACTS_DIR/open-questions.md` when the interview ended incomplete."
- In "## Inputs from the interview", "There are no questions now, because the interview is over."
  becomes "There are no new questions now, because the interview is over (open-questions.md is
  handled below)." The rest of that bullet ("If you still find one, record it in \"Risks and open
  questions\" with the default you took.") stays.

### Plan-test cap with blocking findings (check-plan.ts)

In `.shared/check-plan.ts`, round `MAX_ROUNDS` with a non-`review` finding no longer fails when
the plan has a usable manifest:

```ts
import { readFileSync } from "node:fs";            // added to the existing import
import { extractManifest } from "./render-run.ts";
// ...
if (findings.some((f: any) => f.source !== "review")) {
  let unusable = "";
  try {
    const m = extractManifest(readFileSync(join(art, "plan.md"), "utf8"));
    if (m.plan_slug !== finalize.slug) unusable = `its plan_slug '${m.plan_slug}' differs from '${finalize.slug}'`;
    else if (String(m.feature_branch ?? "") === "") unusable = "it has no feature_branch";
  } catch (e) {
    unusable = (e as Error).message;
  }
  if (unusable) {
    fail(`the plan still has ${findings.length} findings after 2 fix rounds and no usable manifest (${unusable}), so devflow-refine could not load it; nothing was published. They are in test-findings.md in the run artifacts:\n${lines.join("\n")}`);
  }
  writeFileSync(join(art, "tested.json"), JSON.stringify({ slug: finalize.slug, branch: finalize.branch, title: finalize.title, scope: finalize.scope, workflow: `devflow-run-${finalize.slug}`, waves: 0, unresolved: findings.length, withheld: true }));
  writeFileSync(unresolvedFile, `### Unresolved validation findings

The plan test still reported these after its last fix round. They would break the generated
workflow, so it was not published; \`devflow-refine\` fixes them. The full findings are
\`test-findings.md\` in the planning run's artifacts.

${lines.join("\n")}
`);
  console.log(JSON.stringify({ done: true, round, findings: findings.length }));
  process.exit(0);
}
```

(`existsSync(join(art, "plan.md"))` false → `readFileSync` throws → unusable, so the existing `d5`
test that has no plan.md still fails "after 2 fix rounds".) The two other `tested.json` writes get
`withheld: false`.

### Publishing an incomplete plan (publish-plan.ts)

New reads at the start of `.shared/publish-plan.ts`, after the inputs:

- `withheld` = `tested.json` exists in `$ARTIFACTS_DIR` and its `withheld === true`.
- `openText` = `open-questions.md` trimmed (or `""`); `open` = count of lines matching `/^### Q\d+/`.
- `incomplete` = `open > 0 || withheld`.

plan.md edits, in this order:

0. Remove what an earlier publication of this plan left (so the note is rebuilt from this run's
   inputs only): every non-fenced `> [!WARNING]` line directly followed by a line starting
   `> Incomplete plan:`, together with that line and the `> ` lines right after it; and every
   non-fenced `## Open questions` section (the heading up to the next non-fenced `## ` heading).
1. The unresolved block goes into "Risks and open questions" exactly as today. The existing title
   warning ("This plan was published with N unresolved validation findings…") is inserted only
   when `!withheld`.
2. When `open > 0`: insert, directly before
   the last non-fenced `## Risks and open questions` heading (else before `## Assumptions`, else
   before the implementation-manifest heading, else at the end):

   ```
   ## Open questions

   The interview ended before these were answered. Each is taken at its recommended default under
   `## Assumptions`; `devflow-refine` asks them again.

   <openText>

   ```
3. When `incomplete`: insert directly after the
   `# ` title line (done last, so it sits above the review warning), a blank line then:

   ```
   > [!WARNING]
   > Incomplete plan: <parts>. Ready for `devflow-refine` as continuation: run it with the plan slug `<slug>`; its open questions are asked again.
   > <last>
   ```

   `<parts>` joins with `"; "`: when `open > 0`,
   `<open> interview questions are still open (listed under "Open questions", taken at their recommended defaults under "Assumptions")`;
   when `withheld`,
   `<unresolved> validation findings would break the generated workflow (listed under "Unresolved validation findings" in "Risks and open questions")`.
   `<last>`: when `withheld`,
   ``There is no runnable `<workflow>` workflow until `devflow-refine` fixes the plan; an earlier one on the plans branch is removed.``;
   otherwise
   ``Running `<workflow>` now accepts the recommended defaults listed under Assumptions. After it starts, `devflow-refine` can no longer continue this plan.``
   (`<workflow>` is the `workflow` input, `devflow-run-<slug>`.)

Step 2 (the files): when `withheld`, instead of `copyFileSync` of the workflow:
`const wf = join(tmp, plansDir, "workflows", \`${workflow}.yaml\`); removed = existsSync(wf); rmSync(wf, { force: true });`
(the existing `git add -A` stages the deletion). Otherwise copy as today.

`published.md`:

- When `incomplete`, the three note lines (as inserted) and a blank line follow the `Commit …` line.
- When `withheld`, the `Workflow:` line is `Workflow: none published (withheld until \`devflow-refine\` fixes the plan)`,
  followed by `The previous \`<workflow>.yaml\` was removed from the plans branch.` when `removed`;
  the `extraWorkflowSources` hint is left out; the last line is
  `Continue with devflow-refine on the plan slug \`<slug>\`.` instead of the `archon workflow sync` line.

Output JSON: `workflow` is `""` when `withheld`; add `incomplete` (boolean) and `open` (number)
(extra fields beyond the node's `output_format`, like today's `unresolved`; the yaml is unchanged);
`message`:

- withheld: `published plan <slug> without its workflow: <unresolved> validation findings would break it; continue with devflow-refine <slug>`
- else: today's message, plus `; incomplete: <open> open questions, continue with devflow-refine <slug>` when `open > 0`.

### Continuing an incomplete plan (load-published.ts and refine's commands)

`devflow-refine/scripts/load-published.ts`, step 6:

```ts
// The note outside code fences only (a plan may quote the note in a fenced example).
let incomplete = false;
{
  let inFence = false;
  for (const l of planText.split("\n")) {
    if (l.startsWith("```")) inFence = !inFence;
    else if (!inFence && l.startsWith("> Incomplete plan:")) incomplete = true;
  }
}
// ... rest computed as today ...
let workOut = work;
if (!/[A-Za-z]/.test(rest)) {
  if (!incomplete) fail(`Not refined: say what to change in the plan ${slug}, in the message or with --input work=<change>.`);
  workOut = `Continue the incomplete plan ${slug}: ask its open questions again and fix its remaining validation findings.`;
}
```

and the final `console.log` prints `work: workOut`. Nothing else changes (the started check
already ignores the workflow file).

`devflow-refine/commands/draft.md` gains, in step 3 next to the unresolved-warning rule:

> - If `original/plan.md` has a line starting `> Incomplete plan:` under its title, you are
>   continuing an incomplete plan. Drop that `> [!WARNING]` callout, its `## Open questions`
>   section and every `## Assumptions` bullet ending in `(open question Q<n>).` from the draft:
>   those defaults are not settled decisions. On the first round, every question of its
>   `## Open questions` section is in your `questions`, with its text, options and recommendation
>   unchanged. Its "Unresolved validation findings" are part of the change: the refined plan must
>   fix them.

and the "Never re-open a decision the original plan records unless the change contradicts it" line
gets: "(The defaults of an incomplete plan's open questions are not recorded decisions; see step 3.)"

### Rejected

- A fixed share of the 5 places for the challenger, or an extra challenger round (Q1, Q6).
- Keeping the old workflow next to a plan it no longer matches (Q4 b), and failing refine runs
  with blocking findings (Q4 c).
- A confirmation step in the rendered workflow of an incomplete plan (Q8 b).
- The challenger writing `carried.md` itself: it stays write-free; `next-question.ts` cuts the
  ranked list at 5, which also makes the cap testable without a model.

## Phases and models

| Phase | Title | Complexity | Depends on | Model | Why this model |
| --- | --- | --- | --- | --- | --- |
| p1-next-question | Batched rounds in next-question.ts | M | — | small | default |
| p2-plan-interview | devflow-plan interview loop and commands | M | p1-next-question | medium | Rule 3: prompt prose for draft, challenge and finalize whose full wording the plan does not give |
| p3-refine-interview | devflow-refine interview loop and commands | M | p1-next-question | medium | Rule 3: prompt prose for refine's draft, challenge and finalize, including the continuation rule |
| p4-publish-incomplete | check-plan and publish-plan publish incomplete plans | M | p1-next-question | medium | Rule 3: adapts non-trivial insertion and push logic in publish-plan.ts and check-plan.ts |
| p5-refine-continuation | load-published accepts an incomplete plan's bare slug | S | p4-publish-incomplete | small | default |
| p6-docs | README for batched interviews and incomplete plans | S | p2-plan-interview, p3-refine-interview, p5-refine-continuation | medium | Rule 3: documentation prose whose wording the plan gives only in outline |

Final build review: **medium**. Not security-related, no `large` phase, 6 phases.

## Manual steps

None before implementation. After the merge, as for any pack change, the person running Archon
runs `archon workflow sync` (or `bootstrap.sh`) so the installed pack picks up the new
workflows; the README already documents it, so it is not a `manual_after` item.

## Risks and open questions

- **Archon `when` with `||` on strings** (p2, p3): `devflow-audit.yaml:101` uses `||` with numbers
  and booleans. If `archon validate workflows` rejects
  `"$draft.output.status == 'ask' || $draft.output.status == 'done'"`, stop with `status=blocked`
  and report the validator output; do not change the challenger's run condition yourself.
- **Array outputs in command text** (p2, p3): `$draft.output.questions` substitutes an array into
  challenge.md, as `$snapshot.output.unreadable` does in `devflow-config/commands/review-config.md:11`.
- **Fixture schema** (p2, p3): if `archon workflow test` rejects a stub because of the new required
  fields, the fixtures named in the brief are the ones to update; if another fixture fails, stop
  with `status=blocked`.
- **Interleaving between phases**: after p1 merges and before p2/p3 merge, the workflows' yaml
  still sends a single `question` to next-question.ts. Only the fixture replay runs between merges
  (it stubs `next`), so verify stays green; nobody runs the feature branch's pack in between.
- **Recommended option extraction**: finalize reads the recommendation from each open question's
  markdown. A question without a `**Recommendation:**` line would leave finalize without a
  default; the draft and challenge rules require one, and finalize then records its own choice in
  `## Assumptions` (default taken: the option the plan's Design supports best).
- **Open question carried over from interview.md**: none. Interview's "Why no more questions"
  (final pass): scope is batching and publish-incomplete plus Q1–Q8; behaviour: round cap and
  `publish` finalize with recommended defaults under Assumptions and the incomplete note, skipped
  and overflow questions asked later, defaulted after round 3, `stop` cancels, plan-test cap
  publishes plan.md and withholds and removes the workflow, a plan with no extractable manifest
  still fails, refine continues from the bare slug, the note warns that running the workflow
  forecloses refine; names and strings from Q3, Q5, D5, D8, D13; data and schema internal to the
  pack; security: no credentials, no new pushes, the existing non-forced push; prerequisites:
  none; after merge: `archon workflow sync`; no ADRs or changelog in this project.

## Assumptions

- **d7 test inputs for cases b, c and d**: all three run in dir A with draft `{"status":"ask","questions":["p"],"why_no_more":""}`; challenges carry c6, then c7, then c8 (challenger) and c9 (planner), each with reason "r". Why: a draft with status stop or publish would take another branch of next-question.ts; the worker must not invent inputs. Made after the interview, not asked (round 1, finding F1).
- **Placement of the README's incomplete-plans paragraph**: directly after step 5 and before the "Then run `devflow-run-<slug>`" paragraph, as a paragraph led by `**Incomplete plans.**`. Why: it belongs with the publish step it qualifies, and a bold lead-in matches the README's numbered-step prose without adding a heading. Made after the interview, not asked (round 1, finding F2).

## Implementation manifest

```yaml
plan_slug: devflow-batched-interview
feature_branch: feat/devflow-batched-interview
max_parallel: 3
review_model: medium
review_model_reason: Not security-related, no large phase, and 6 phases (fewer than 7).
manual_before: []
manual_after: []
verify_after_merge:
  - scripts/test-render-run.sh
  - scripts/test-devflow-pack.sh
final_checks:
  - "grep -rn 'MAX_QUESTIONS\\|14 questions\\|one question at a time\\|interviews you one' packs/devflow prints nothing"
  - "scripts/test-render-run.sh prints 'next-question: ok', 'check-plan: ok', 'publish-plan incomplete: ok' and 'load-published incomplete: ok'"
  - "packs/devflow/README.md describes the 5-questions-by-3-rounds interview, the stop and publish words, incomplete plans, the withheld workflow and refine's continuation from the bare slug"
phases:
  - id: p1-next-question
    title: Batched rounds in next-question.ts
    depends_on: []
    complexity: M
    model: small
    touches:
      - packs/devflow/.shared/next-question.ts
      - scripts/test-render-run.sh
    brief: |
      Read the plan's Design, "Interview loop" and "next-question.ts" subsections, first.
      1. Rewrite packs/devflow/.shared/next-question.ts exactly as Design "next-question.ts" says:
         MAX_ROUNDS = 3, PER_ROUND = 5, steps 1-8, the exact message text and the exact
         interview.md, carried.md and open-questions.md formats. Keep the header comment style
         (update it: "reads the planner's questions and the challenger's ranking, appends the
         round to interview.md and says whether the interview is over") and the parse() helper.
         Remove MAX_QUESTIONS and the "## Stopped" block. Inputs stay `draft` and `challenge`.
      2. In scripts/test-render-run.sh add a section "# d7. next-question.ts" after the d6 section
         (before "# e. load-plan"), in a subshell like d5, with
         nq="$repo_root/packs/devflow/.shared/next-question.ts" and
         nq_run() { ARTIFACTS_DIR="$1" INPUTS_DRAFT="$2" INPUTS_CHALLENGE="$3" bun "$nq"; }. Cases:
         a. Fresh dir A. draft {"status":"ask","questions":["p1","p2"],"why_no_more":""},
            challenge with 7 items (p1, p2 by planner; c1..c5 by challenger). Output has
            "done":false, "incomplete":false; the question contains "Round 1 of 3" and "**5.** (Q5)"
            and not "**6.**"; interview.md has "## Round 1" and "### Q5 (asked by: challenger)";
            `grep -c '^### (asked by:' carried.md` prints 2.
         Cases b, c and d all run in dir A with draft {"status":"ask","questions":["p"],"why_no_more":""}.
         b. Round 2, challenge {"questions":[{"question":"c6","by":"challenger"}],"reason":"r"}:
            "Round 2 of 3", "1 question.", "### Q6 (asked by:" in interview.md, carried.md gone.
         c. Round 3, challenge {"questions":[{"question":"c7","by":"challenger"}],"reason":"r"}:
            "Round 3 of 3" and "This is the last round".
         d. Round 4 call, challenge {"questions":[{"question":"c8","by":"challenger"},{"question":"c9","by":"planner"}],"reason":"r"}:
            "done":true, "incomplete":true, "stop":false;
            open-questions.md has "### Q8 (asked by:" and "### Q9 (asked by:"; interview.md has
            "## Interview ended incomplete" and "The interview ended after 3 rounds".
         e. Fresh dir B: draft {"status":"stop","questions":[],"why_no_more":""} and challenge "":
            "stop":true, and dir B stays empty.
         f. Fresh dir C: draft status publish with questions ["x"], challenge "": "incomplete":true;
            interview.md contains 'You said "publish"'; open-questions.md has "### Q1 (asked by: planner)".
         g. Fresh dir D: draft status done, questions [], challenge {"questions":[],"reason":"none"}:
            "done":true, "incomplete":false, no open-questions.md.
         End with echo "next-question: ok".
      3. Run bash -n scripts/test-render-run.sh and scripts/test-render-run.sh.
      Stop condition: if any existing section of scripts/test-render-run.sh fails before your
      change, stop with status=blocked and report it.
    acceptance:
      - "scripts/test-render-run.sh exits 0 and prints 'next-question: ok'"
      - "grep -c 'MAX_QUESTIONS' packs/devflow/.shared/next-question.ts prints 0"
      - "grep -q 'const PER_ROUND = 5' packs/devflow/.shared/next-question.ts && grep -q 'const MAX_ROUNDS = 3' packs/devflow/.shared/next-question.ts"

  - id: p2-plan-interview
    title: devflow-plan interview loop and commands
    depends_on: [p1-next-question]
    complexity: M
    model: medium
    model_reason: Rule 3, prompt prose for draft.md, challenge.md and finalize.md whose full wording the plan gives only in parts.
    touches:
      - packs/devflow/devflow-plan/devflow-plan.yaml
      - packs/devflow/devflow-plan/commands/draft.md
      - packs/devflow/devflow-plan/commands/challenge.md
      - packs/devflow/devflow-plan/commands/finalize.md
      - packs/devflow/devflow-plan/fixtures/happy-path.stubs.yaml
      - packs/devflow/devflow-plan/fixtures/interview-done.stubs.yaml
      - packs/devflow/devflow-plan/fixtures/interview-user-stops.stubs.yaml
      - packs/devflow/devflow-plan/fixtures/plan-test-never-clears.stubs.yaml
      - packs/devflow/devflow-plan/fixtures/interview-publish.stubs.yaml
    brief: |
      Read the plan's Design: "Interview loop", "The interview commands" and "Open questions in
      the final plan".
      1. packs/devflow/devflow-plan/devflow-plan.yaml: replace the interview loop's
         max_iterations and the draft, challenge and next output_format/when exactly as Design
         "Interview loop" shows; the section comment; the stop-at-interview cancel text; the
         description sentence. Nothing else in the file changes.
      2. packs/devflow/devflow-plan/commands/draft.md: apply every edit listed for draft.md in
         Design "The interview commands". Keep the "Models" section and the authority section as
         they are.
      3. packs/devflow/devflow-plan/commands/challenge.md: apply the challenge.md edits.
      4. packs/devflow/devflow-plan/commands/finalize.md: add the "## Open questions from the
         interview" section and the Assumptions sentence from Design "Open questions in the final
         plan", and apply its two sentence replacements: line 2 ("The interview is over: every
         question has been asked and answered.") and the "There are no questions now, because the
         interview is over." bullet (lines 31-32), with the exact new wording given there.
      5. Fixtures: in happy-path, interview-done and plan-test-never-clears, the draft stub becomes
         {status: done, questions: [], why_no_more: all settled}, the challenge stub
         {questions: [], reason: none}, and the next stub gets incomplete: false. In
         interview-user-stops the draft stub becomes {status: stop, questions: [], why_no_more: ""},
         challenge {questions: [], reason: none}, next gets incomplete: false. In
         plan-test-never-clears replace the first comment line with
         "# RED: the manifest validator rejects the plan in the first round; the dry run runs plan-loop once, so plan-result finds no tested.json and the run fails."
         (the round-3 publish without a workflow is tested in scripts/test-render-run.sh d5 and f).
      6. New fixture packs/devflow/devflow-plan/fixtures/interview-publish.stubs.yaml: a copy of
         happy-path.stubs.yaml with the first comment line
         "# Green path: the user says publish; the interview ends incomplete and the plan is still finalized and published.",
         draft {status: publish, questions: ["q"], why_no_more: ""} and next
         {done: true, stop: false, incomplete: true, question: ""}; expect: completed.
      7. Run scripts/test-devflow-pack.sh.
      Stop condition: if archon validate rejects the challenge `when` expression or a fixture
      other than the five named here fails, stop with status=blocked and paste the output.
    acceptance:
      - "scripts/test-devflow-pack.sh exits 0"
      - "grep -q 'enum: \\[ask, done, stop, publish\\]' packs/devflow/devflow-plan/devflow-plan.yaml"
      - "grep -q 'max_iterations: 5' packs/devflow/devflow-plan/devflow-plan.yaml"
      - "grep -c 'interviews you one' packs/devflow/devflow-plan/devflow-plan.yaml prints 0"
      - "grep -c 'exactly \\*\\*one\\*\\* question\\|one question at a time' packs/devflow/devflow-plan/commands/draft.md packs/devflow/devflow-plan/devflow-plan.yaml prints 0 for both files"
      - "grep -q 'open-questions.md' packs/devflow/devflow-plan/commands/finalize.md"
      - "grep -c 'every question has been asked and answered' packs/devflow/devflow-plan/commands/finalize.md prints 0"
      - "grep -q 'There are no new questions now' packs/devflow/devflow-plan/commands/finalize.md"
      - "grep -q 'status: publish' packs/devflow/devflow-plan/commands/draft.md"

  - id: p3-refine-interview
    title: devflow-refine interview loop and commands
    depends_on: [p1-next-question]
    complexity: M
    model: medium
    model_reason: Rule 3, prompt prose for refine's draft.md, challenge.md and finalize.md, including the continuation rule, whose full wording the plan gives only in parts.
    touches:
      - packs/devflow/devflow-refine/devflow-refine.yaml
      - packs/devflow/devflow-refine/commands/draft.md
      - packs/devflow/devflow-refine/commands/challenge.md
      - packs/devflow/devflow-refine/commands/finalize.md
      - packs/devflow/devflow-refine/fixtures/happy-path.stubs.yaml
      - packs/devflow/devflow-refine/fixtures/interview-user-stops.stubs.yaml
      - packs/devflow/devflow-refine/fixtures/plan-test-never-clears.stubs.yaml
      - packs/devflow/devflow-refine/fixtures/refuse-started.stubs.yaml
    brief: |
      Read the plan's Design: "Interview loop", "The interview commands", "Open questions in the
      final plan" and "Continuing an incomplete plan".
      1. packs/devflow/devflow-refine/devflow-refine.yaml: the same interview-loop edits as
         Design "Interview loop" (keep the loop's depends_on: [load] and its when), the section
         comment, the devflow-refine stop-at-interview cancel text and the description sentence.
      2. packs/devflow/devflow-refine/commands/draft.md: the draft.md edits of Design "The
         interview commands", keeping every refine-only line (`diff` it against
         devflow-plan/commands/draft.md at e451275 to see them); then the continuation bullet and
         the "Never re-open" addition from Design "Continuing an incomplete plan".
      3. packs/devflow/devflow-refine/commands/challenge.md: the challenge.md edits, keeping its
         line "Also compare plan-draft.md with original/plan.md…".
      4. packs/devflow/devflow-refine/commands/finalize.md: the same finalize additions as Design
         "Open questions in the final plan", and the same two sentence replacements (line 2 and the
         "There are no questions now" bullet at lines 36-37) as Design "Open questions in the final
         plan" gives for devflow-plan's finalize.md.
      5. Fixtures happy-path, interview-user-stops, plan-test-never-clears: draft stubs get
         `questions: []` instead of `question: ""`, challenge stubs `questions: []` instead of
         `question: ""`, next stubs `incomplete: false`; refuse-started has the same three stubs
         and gets the same change. In refine's plan-test-never-clears, replace its first comment
         line the same way as p2-plan-interview step 5 does for devflow-plan's.
      6. Run scripts/test-devflow-pack.sh.
      Stop condition: as in p2-plan-interview (a rejected `when` or another fixture failing:
      status=blocked).
    acceptance:
      - "scripts/test-devflow-pack.sh exits 0"
      - "grep -q 'enum: \\[ask, done, stop, publish\\]' packs/devflow/devflow-refine/devflow-refine.yaml"
      - "grep -q '> Incomplete plan:' packs/devflow/devflow-refine/commands/draft.md"
      - "grep -q '(open question Q<n>)' packs/devflow/devflow-refine/commands/draft.md"
      - "grep -q 'open-questions.md' packs/devflow/devflow-refine/commands/finalize.md"
      - "grep -c 'every question has been asked and answered' packs/devflow/devflow-refine/commands/finalize.md prints 0"
      - "grep -q 'There are no new questions now' packs/devflow/devflow-refine/commands/finalize.md"
      - "grep -c 'one question at a time\\|14 questions\\|interviews you one' packs/devflow/devflow-refine/devflow-refine.yaml prints 0"
      - "grep -q 'max_iterations: 5' packs/devflow/devflow-refine/devflow-refine.yaml"

  - id: p4-publish-incomplete
    title: check-plan and publish-plan publish incomplete plans
    depends_on: [p1-next-question]
    complexity: M
    model: medium
    model_reason: Rule 3, adapts non-trivial insertion and push logic in publish-plan.ts and the final-round branch of check-plan.ts.
    touches:
      - packs/devflow/.shared/check-plan.ts
      - packs/devflow/.shared/publish-plan.ts
      - scripts/test-render-run.sh
    brief: |
      Read the plan's Design: "Plan-test cap with blocking findings" and "Publishing an incomplete
      plan". The pattern commit is 877ee61 (the review-only publish path).
      1. packs/devflow/.shared/check-plan.ts: implement Design "Plan-test cap with blocking
         findings" exactly (import extractManifest from "./render-run.ts", the unusable check, the
         withheld tested.json, the new unresolved.md text) and add `withheld: false` to the two
         other tested.json writes. Update the comment above the branch.
      2. packs/devflow/.shared/publish-plan.ts: implement Design "Publishing an incomplete plan":
         the withheld/open/incomplete reads, the three plan.md edits in that order, the withheld
         branch in step 2 with `removed`, the published.md lines and the output JSON.
      3. scripts/test-render-run.sh section d5 (check-plan): after the existing manifest-finding
         failure check and before the existing `cp_run "" "" >/dev/null; test ! -e "$chk/unresolved.md"`
         lines, add: cp "$fx/serial.md" "$chk/plan.md"; then, in the prefix form the script
         already uses at its round-3 check (never as plain assignments, so later lines keep the
         original fin and tst),
         fin='{"scope":"large","slug":"serial","branch":"feat/serial","title":"S","prerequisites":false,"after":false}' tst="$vm" cp_run "" 2
         succeeds with "done":true; tested.json contains
         '"withheld":true' and '"workflow":"devflow-run-serial"'; unresolved.md contains
         "would break the generated". Then with the same fin and a plan.md whose plan_slug is wrong
         (sed 's/plan_slug: serial/plan_slug: other/'), the same prefixed call fails and its stderr
         contains "no usable manifest". Then rm -f "$chk/plan.md" so the existing round-1 call and
         `test ! -e "$chk/unresolved.md"` run as before. Keep the existing "check-plan: ok".
      4. Section f (publish-plan), after "publish-plan unresolved: ok", add an incomplete block:
         a. cp "$fx/serial.md" "$pub_art/plan.md"; write "$pub_art/open-questions.md" with two
            blocks "### Q4 (asked by: planner)\n\n**Q?** a or b. **Recommendation: a).**\n" and
            "### Q5 (asked by: challenger)\n\n...". publish. The pushed plan.md
            (git -C "$porigin" show plans:plans/s/plan.md) has line 3 '> [!WARNING]', a line
            starting '> Incomplete plan: 2 interview questions are still open', a line containing
            'Running `devflow-run-s` now accepts the recommended defaults', and one '## Open questions'
            line; plans:plans/workflows/devflow-run-s.yaml still exists; publish output contains
            'incomplete: 2 open questions'. Copy the pushed plan.md back to "$pub_art/plan.md" and
            publish again: still exactly one '> Incomplete plan:' line and one '## Open questions'
            line (step 0 removed the old ones).
         b. rm open-questions.md; cp serial.md to plan.md; write unresolved.md as check-plan's
            blocking text with one '- F1 [validate_manifest, mechanical] plan: bad' line and
            tested.json '{"withheld":true}'. publish. plans:plans/workflows/devflow-run-s.yaml no
            longer exists (git -C "$porigin" cat-file -e fails); the pushed plan.md contains
            '1 validation findings would break the generated workflow' and 'There is no runnable'
            and not 'Running `devflow-run-s`' and not 'This plan was published with';
            published.md contains 'was removed from the plans branch' and 'Continue with devflow-refine';
            output contains '"workflow":""'.
         c. Clean up: rm unresolved.md tested.json; cp serial.md to plan.md; publish (restores
            the workflow file). echo "publish-plan incomplete: ok".
      5. Run bash -n scripts/test-render-run.sh and scripts/test-render-run.sh.
      Stop condition: if the existing publish-plan or check-plan assertions fail after your
      change in a way the Design does not explain, stop with status=blocked.
    acceptance:
      - "scripts/test-render-run.sh exits 0 and prints 'check-plan: ok' and 'publish-plan incomplete: ok'"
      - "grep -q 'no usable manifest' packs/devflow/.shared/check-plan.ts"
      - "grep -q 'Incomplete plan:' packs/devflow/.shared/publish-plan.ts"

  - id: p5-refine-continuation
    title: load-published accepts an incomplete plan's bare slug
    depends_on: [p4-publish-incomplete]
    complexity: S
    model: small
    touches:
      - packs/devflow/devflow-refine/scripts/load-published.ts
      - scripts/test-render-run.sh
    brief: |
      1. packs/devflow/devflow-refine/scripts/load-published.ts step 6: add the fence-aware
         `incomplete` loop from Design "Continuing an incomplete plan" and replace the bare-slug
         failure with the code in Design "Continuing an incomplete plan" (the `workOut` variable
         and its exact text); the final console.log prints `work: workOut`.
      2. scripts/test-render-run.sh section g: after the line
         `grep -q "say what to change in the plan serial" "$scratch/lp2.err"`, add:
         printf '### Q1 (asked by: planner)\n\nA or b? **Recommendation: a).**\n' > "$pub_art/open-questions.md";
         cp "$fx/serial.md" "$pub_art/plan.md"; PSLUG=serial PWF=devflow-run-serial publish >/dev/null;
         out="$(lp2 env USER_MESSAGE="refine serial")"; echo "$out" | grep -q '"slug":"serial"';
         echo "$out" | grep -q 'Continue the incomplete plan serial';
         out="$(lp2 env USER_MESSAGE="refine serial: add a phase")"; echo "$out" | grep -q '"work":"refine serial: add a phase"';
         then rm "$pub_art/open-questions.md"; cp "$fx/serial.md" "$pub_art/plan.md";
         PSLUG=serial PWF=devflow-run-serial publish >/dev/null (republishes the complete plan);
         if lp2 env USER_MESSAGE="refine serial" >/dev/null 2>"$scratch/lp2.err"; then echo "bare slug on a complete plan succeeded" >&2; exit 1; fi;
         echo "load-published incomplete: ok". The later started/merged checks stay as they are.
      3. Run scripts/test-render-run.sh.
      Stop condition: if publish-plan does not insert a '> Incomplete plan:' line for the
      open-questions.md above, p4 is not merged as the Design says: stop with status=blocked.
    acceptance:
      - "scripts/test-render-run.sh exits 0 and prints 'load-published incomplete: ok' and 'load-published: ok'"
      - "grep -q 'Continue the incomplete plan' packs/devflow/devflow-refine/scripts/load-published.ts"

  - id: p6-docs
    title: README for batched interviews and incomplete plans
    depends_on: [p2-plan-interview, p3-refine-interview, p5-refine-continuation]
    complexity: S
    model: medium
    model_reason: Rule 3, documentation prose whose wording the plan gives only in outline.
    touches:
      - packs/devflow/README.md
    brief: |
      Retirement phase (no ADRs and no changelog in this project; the plan is not on this branch).
      Edit packs/devflow/README.md only:
      1. Table rows (lines 19-20): devflow-plan's "Every question of the interview, one at a
         time; …" becomes "Up to 5 questions a round in at most 3 rounds; the run publishes the
         plan (marked incomplete if questions are still open) and you start
         `devflow-run-<slug>` after `archon workflow sync`". devflow-refine's "Every question the
         change leaves open, one at a time; …" becomes "Up to 5 questions a round in at most 3
         rounds about what the change leaves open; it refuses a plan whose branch is on origin or
         that is merged".
      2. "devflow-plan, step by step", step 1 Interview: rewrite to describe: each round shows up
         to 5 numbered questions, the planner's and a fresh challenger's ranked together; answer
         as "1: a, 2: c, …"; skipped questions and those that did not fit come back next round;
         at most 3 rounds; "publish" ends the questions and publishes the plan as it is, "stop"
         abandons the run with nothing published; questions still open at the end are taken at
         their recommended defaults (listed under `## Assumptions` and `## Open questions`) and
         the plan gets an "Incomplete plan" warning under its title.
      3. Step 4 Test, the "If the renderer or the manifest validator still rejects the plan…"
         sentence: replace with: the plan is still published, with the remaining findings under
         "Unresolved validation findings" and the "Incomplete plan" warning, but its
         `devflow-run-<slug>` workflow is withheld (and an earlier one on the plans branch is
         removed) until devflow-refine fixes it; only a plan without a usable manifest fails with
         nothing published.
      4. Directly after step 5 (before the "Then run `devflow-run-<slug>`" paragraph), add a
         paragraph that starts with `**Incomplete plans.**` and says: the warning's text says why; with a
         published workflow, running it accepts the defaults and devflow-refine can no longer
         continue the plan; continue with
         `archon workflow run tkcs-lab/devflow:devflow-refine "refine <slug>" --detach` (the bare
         slug is enough), which asks the open questions again and fixes the remaining findings.
      5. "devflow-refine, step by step": step 1 says the change may be left out for a plan marked
         incomplete; step 3 says the interview uses the same rounds and words as devflow-plan and
         re-asks an incomplete plan's open questions first; step 4 says a refine that still has
         blocking findings publishes the plan without its workflow.
      6. Run scripts/test-devflow-pack.sh and scripts/test-render-run.sh.
    acceptance:
      - "grep -c 'Every question of the interview\\|Every question the change leaves open\\|one at a time,$' packs/devflow/README.md prints 0"
      - "grep -q 'Incomplete plan' packs/devflow/README.md && grep -q '\"publish\"' packs/devflow/README.md && grep -q 'withheld' packs/devflow/README.md"
      - "grep -q '1: a, 2: c' packs/devflow/README.md"
      - "scripts/test-devflow-pack.sh and scripts/test-render-run.sh exit 0"
```
