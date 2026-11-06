// Records the build's progress in the issue's devflow comment. Env: INPUTS_ISSUE (empty: nothing to
// do), INPUTS_EVENT (building | pr_open | finished | stopped), INPUTS_BRANCH, INPUTS_PR_NUMBER,
// INPUTS_PR_URL, INPUTS_STATE (the PR's final state; MERGED is merged, anything else closed),
// INPUTS_DEVIATIONS_URL, INPUTS_CI_LOCAL, INPUTS_CI_FAILED_JOB. The last three default to what this
// run recorded in $ARTIFACTS_DIR/outcomes (deviations.json, ci-local.json), so the tail's trace
// nodes need no input that a skipped node would have to supply.
// A comment failure never fails the build: it writes trace-error.md and prints ok false.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { upsertComment } from "./issue-comment.ts";
import { readOwnOutcome } from "./outcomes.ts";
import { artifactsDir, input } from "./util.ts";

// A key the event does not know about is left out, so it keeps the value an earlier event wrote.
const known = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function buildPatch(event: string): Record<string, unknown> {
  const pr = { number: Number(input("pr_number", false)), url: input("pr_url", false) };
  const deviations = input("deviations_url", false) || readOwnOutcome("deviations")?.deviations_url || undefined;
  const ci = readOwnOutcome("ci-local");
  const ciLocal = input("ci_local", false) || ci?.status || undefined;
  const ciJob = input("ci_failed_job", false) || ci?.failed?.[0]?.job || (ciLocal === "red" ? undefined : null);
  if (event === "building") return { state: "building", run: process.env.WORKFLOW_ID || "run", branch: input("branch", false), pr: null };
  if (event === "pr_open") return known({ state: "pr_open", pr, ci_local: ciLocal, ci_failed_job: ciJob, deviations_url: deviations });
  if (event === "finished") return known({ state: input("state", false).toUpperCase() === "MERGED" ? "merged" : "closed", pr, deviations_url: deviations });
  if (event === "stopped") return known({ state: "stopped", branch: input("branch", false), deviations_url: deviations });
  throw new Error(`event must be building, pr_open, finished or stopped, not '${event}'`);
}

const issue = input("issue", false);
if (!issue) {
  console.log(JSON.stringify({ ok: true, skipped: true, url: "" }));
  process.exit(0);
}
const realExit = process.exit;
try {
  const n = Number(issue);
  if (!Number.isInteger(n) || n < 1) throw new Error(`issue '${issue}' is not an issue number`);
  const build = buildPatch(input("event", false));
  // upsertComment reports through fail(), which exits; for this call an exit is an error to record.
  (process as any).exit = (code?: number) => {
    throw new Error(`the issue comment was not updated (exit ${code})`);
  };
  const r = upsertComment(n, { build });
  process.exit = realExit;
  console.log(JSON.stringify({ ok: true, skipped: false, url: r.url }));
} catch (e) {
  process.exit = realExit;
  writeFileSync(join(artifactsDir(), "trace-error.md"), `# Trace error\n\nThe devflow comment of issue #${issue} was not updated:\n\n${(e as Error).message}\n`);
  console.error(`devflow: the issue comment was not updated (the build continues): ${(e as Error).message}`);
  console.log(JSON.stringify({ ok: false, skipped: false, url: "" }));
}
