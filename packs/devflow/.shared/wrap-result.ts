// The output of mod-devflow-wrap, from the build's shared outcomes only (never an upstream node's
// output, which a failed node would make unreadable). Env: INPUTS_STAGE (first | final),
// INPUTS_MODE (build | follow-up), INPUTS_RUN_KEY, INPUTS_BRANCH, INPUTS_PR_NUMBER (an open PR a
// follow-up continues). Prints { complete, deliverable, stuck_phases, branch, head, pr_url,
// deviations_url, pushed }.
//   deliverable  the first pass found every phase done and pushed the branch, and no PR exists yet
//   complete     first stage: deliverable; final stage: a PR exists (and, for a follow-up, its
//                phase is done and its push went through)
import { repoSlug } from "./gh.ts";
import { readOutcomes } from "./outcomes.ts";
import { input, run } from "./util.ts";

const stage = input("stage");
const mode = input("mode", false) || "build";
const runKey = input("run_key", false);
const prNumber = input("pr_number", false);
const o = runKey ? readOutcomes(runKey) : {};
const dev = o.deviations ?? {};
const pushOk = o.push?.ok === true && (o["push-final"] ? o["push-final"].ok === true : true);
const deliverable = dev.complete === true && o.push?.ok === true && prNumber === "";

let prUrl = o.pr?.url ?? "";
if (!prUrl && prNumber) {
  try {
    prUrl = `https://github.com/${repoSlug()}/pull/${prNumber}`;
  } catch {}
}
let complete: boolean;
if (stage === "first") complete = deliverable;
else if (mode === "build") complete = !!o.pr;
else complete = dev.complete === true && pushOk && prUrl !== "";

console.log(
  JSON.stringify({
    complete,
    deliverable,
    stuck_phases: dev.stuck_phases ?? [],
    branch: input("branch", false),
    head: run(["git", "rev-parse", "HEAD"]).out.trim(),
    pr_url: prUrl,
    deviations_url: dev.deviations_url ?? "",
    pushed: [...new Set([...(o.push?.pushed ?? []), ...(o["push-final"]?.pushed ?? [])])],
  }),
);
