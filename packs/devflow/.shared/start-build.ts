// The start of an unattended build (mod-devflow-start). Never waits for anyone; a refusal changes
// nothing and is printed as `refusal` for the block's cancel node.
//   mode=build      validates the issue's documents at the plans commit, refuses when the feature
//                   branch exists (another worktree or origin), creates it from origin/<main>, commits
//                   and pushes the stub deviations.md (build_outcome running), so the branch always
//                   carries the file even when the run is killed later.
//   mode=follow-up  checks out the build's branch from origin (continue-branch) or creates the
//                   follow-up branch from origin/<main> (new-branch); no stub, no refusal on documents.
// Prints { ok, refusal, branch, head, plan_commit, run_key }. run_key names the build's shared
// outcomes directory (outcomes.ts); a resume replays this output, so it stays the same.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse } from "./frontmatter.ts";
import { DOC_KINDS, fileOf } from "./layout.ts";
import { fetchPlans } from "./plans-branch.ts";
import { fail, input, must, plansConfig, run, tail } from "./util.ts";
import { formatErrors, validateDocs } from "./validate-docs.ts";
import { deviationsPath, renderStub } from "./write-deviations.ts";

const refuse = (refusal: string): never => {
  console.log(JSON.stringify({ ok: false, refusal, branch: input("branch", false), head: "", plan_commit: "", run_key: "" }));
  process.exit(0);
};

// The worktrees other than this one that have <branch> checked out.
export function heldBy(branch: string): string[] {
  const me = must(["git", "rev-parse", "--show-toplevel"]);
  const out: string[] = [];
  let wt = "";
  for (const line of must(["git", "worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) wt = line.slice(9);
    if (line === `branch refs/heads/${branch}` && wt !== me) out.push(wt);
  }
  return out;
}

const onOrigin = (branch: string) => run(["git", "ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`]).code === 0;

const issue = Number(input("issue"));
if (!Number.isInteger(issue) || issue < 1) fail(`issue '${input("issue")}' is not an issue number`);
const mode = input("mode", false) || "build";
const mainBranch = input("main_branch");
const plans = plansConfig();
must(["git", "fetch", "-q", "origin", mainBranch]);
const planCommit = fetchPlans(plans.ref);
if (!planCommit) refuse(`Not started: the plans branch '${plans.ref}' does not exist on origin.`);
const runId = process.env.WORKFLOW_ID || "run";

if (mode === "follow-up") {
  const branch = input("task_branch");
  const followupMode = input("followup_mode");
  must(["git", "worktree", "prune"]);
  const held = heldBy(branch);
  if (held.length) refuse(`Not started: branch ${branch} is checked out in another worktree (${held.join(", ")}). Remove it with git worktree remove when no run uses it.`);
  if (followupMode === "continue-branch") {
    must(["git", "fetch", "-q", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    if (run(["git", "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).code === 0) {
      must(["git", "switch", "-q", branch]);
      must(["git", "merge", "-q", "--ff-only", `origin/${branch}`]);
    } else must(["git", "switch", "-q", "-c", branch, "--track", `origin/${branch}`]);
  } else if (followupMode === "new-branch") {
    if (onOrigin(branch)) refuse(`Not started: branch ${branch} already exists on origin.`);
    must(["git", "switch", "-q", "-c", branch, `origin/${mainBranch}`]);
  } else fail(`followup_mode must be continue-branch or new-branch, not '${followupMode}'`);
  const head = must(["git", "rev-parse", "HEAD"]);
  console.log(JSON.stringify({ ok: true, refusal: "", branch, head, plan_commit: planCommit, run_key: `issue-${issue}-f-${head.slice(0, 12)}` }));
  process.exit(0);
}

if (mode !== "build") fail(`mode must be build or follow-up, not '${mode}'`);
const branch = input("branch");

const docs = validateDocs({ issue, ref: planCommit, plansDir: plans.dir, kinds: [...DOC_KINDS] });
if (!docs.ok) refuse(`Not started: the documents of issue #${issue} do not validate at ${planCommit}:\n${formatErrors(docs.errors)}`);

must(["git", "worktree", "prune"]);
const held = heldBy(branch);
if (held.length) refuse(`Not started: branch ${branch} already exists (another worktree at ${held.join(", ")}). Use devflow-follow-up to continue it.`);
if (onOrigin(branch)) refuse(`Not started: branch ${branch} already exists (on origin). Use devflow-follow-up to continue it.`);

if (run(["git", "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).code === 0) {
  // A local branch left by a run that never pushed: nothing of it reached origin, so start it again.
  const switched = run(["git", "switch", "-q", "-C", branch, `origin/${mainBranch}`]);
  if (switched.code !== 0) fail(`cannot reset the local branch ${branch}: ${tail(switched.err, 10)}`);
} else must(["git", "switch", "-q", "-c", branch, `origin/${mainBranch}`]);

const planText = must(["git", "show", `${planCommit}:${fileOf(plans.dir, issue, "plan")}`]);
const fm = parse(planText + "\n").fm;
const file = deviationsPath(issue);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, renderStub({ issue, title: String(fm.title), branch, planRevision: Number(fm.revision), run: runId }));
const stub = validateDocs({ issue, dir: dirname(file), kinds: ["deviations"] });
if (!stub.ok) fail(`the stub deviations.md does not validate:\n${formatErrors(stub.errors)}`);
must(["git", "add", "--", file]);
must(["git", "commit", "-q", "-m", `Start build issue-${issue} (stub deviations.md)`, "-m", `Issue: #${issue}\nRun: ${runId}`]);
const push = run(["git", "push", "-q", "-u", "origin", `HEAD:refs/heads/${branch}`]);
if (push.code !== 0) fail(`the push of ${branch} was rejected (nothing was built yet):\n${tail(push.err + push.out, 20)}`);
const head = must(["git", "rev-parse", "HEAD"]);
console.log(JSON.stringify({ ok: true, refusal: "", branch, head, plan_commit: planCommit, run_key: `issue-${issue}-${head.slice(0, 12)}` }));
