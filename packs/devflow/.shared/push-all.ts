// Pushes the build's branch and the partial work of stuck phases, never forced:
//   - the branch: on a rejection, fetch, merge origin/<branch> once and push again; still rejected,
//     push to <branch>-stopped-<run> so the work is not lost;
//   - <branch>-partial-<id> for every stuck or failed phase with commits (partial_head) and every
//     phase whose merge conflicted.
// Never exits non-zero: the result (also the outcome `push`, or `push-final` with INPUTS_FINAL=true)
// says what reached origin. Env (else context.json): INPUTS_BRANCH, INPUTS_RUN_KEY, INPUTS_FINAL,
// INPUTS_CHANGED ("false": nothing new was committed, nothing to push).
// Prints { ok, pushed, head, problems }.
import { readOutcomes, writeOutcome } from "./outcomes.ts";
import { fact, fail, input, run, tail } from "./util.ts";

const branch = fact("branch");
if (!branch) fail("the branch to push is not known");
const runKey = fact("run_key");
const name = input("final", false) === "true" ? "push-final" : "push";
const pushed: string[] = [];
const problems: string[] = [];
const head = run(["git", "rev-parse", "HEAD"]).out.trim();

const push = (ref: string, target: string) => {
  const r = run(["git", "push", "-q", "origin", `${ref}:refs/heads/${target}`]);
  if (r.code === 0) pushed.push(target);
  return r;
};

let ok = false;
if (input("changed", false) === "false") ok = true;
else {
  let r = push("HEAD", branch);
  if (r.code !== 0) {
    problems.push(`push of ${branch} rejected: ${tail(r.err, 5)}`);
    const f = run(["git", "fetch", "-q", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    const m = f.code === 0 ? run(["git", "merge", "-q", "--no-edit", `origin/${branch}`]) : f;
    if (m.code !== 0) {
      run(["git", "merge", "--abort"]);
      problems.push(`merging origin/${branch} failed: ${tail(m.err + m.out, 5)}`);
    } else r = push("HEAD", branch);
    if (r.code !== 0 || m.code !== 0) {
      const stopped = `${branch}-stopped-${process.env.WORKFLOW_ID || "run"}`;
      const s = push(head, stopped);
      if (s.code !== 0) problems.push(`push of ${stopped} rejected: ${tail(s.err, 5)}`);
    } else ok = true;
  } else ok = true;
}

if (name === "push" && runKey) {
  for (const [key, o] of Object.entries(readOutcomes(runKey))) {
    const conflict = key.startsWith("merge-") && o?.status === "conflict";
    const sha = conflict ? o.head : ["stuck", "failed"].includes(o?.status) ? o.partial_head : "";
    if (!sha) continue;
    const id = conflict ? key.slice("merge-".length) : key;
    const r = push(sha, `${branch}-partial-${id}`);
    if (r.code !== 0) problems.push(`push of ${branch}-partial-${id} rejected: ${tail(r.err, 5)}`);
  }
}

const out = { ok, pushed, head: run(["git", "rev-parse", "HEAD"]).out.trim(), problems };
writeOutcome(name, out, runKey);
if (problems.length) console.error(`devflow: ${problems.join("; ")}`);
console.log(JSON.stringify(out));
