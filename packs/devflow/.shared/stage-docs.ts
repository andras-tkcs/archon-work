// Commits this issue's folder plans/issue-<n>/ on the build's branch, and nothing else, so the PR
// carries exactly design.md, plan.md, plan-test.md, before.md, after.md and deviations.md into main.
// Build mode copies the five documents from the plans commit; any other mode (follow-up, final) only
// stages deviations.md (the others are already on the branch). Never `git add -A` or `.`.
// Env (else context.json): INPUTS_ISSUE (empty: work without an issue, nothing to do),
// INPUTS_PLAN_COMMIT, INPUTS_MODE, INPUTS_PLANS_DIR, INPUTS_CHANGED ("false": the deviations pass
// changed nothing). Prints { committed, head }.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DOC_KINDS, KINDS, fileOf, mainFolderOf } from "./layout.ts";
import { writeOutcome } from "./outcomes.ts";
import { fact, fail, input, must, plansConfig, run } from "./util.ts";
import { formatErrors, validateDocs } from "./validate-docs.ts";

const head = () => must(["git", "rev-parse", "HEAD"]);
const issueText = fact("issue");
if (issueText === "" || input("changed", false) === "false") {
  console.log(JSON.stringify({ committed: false, head: head() }));
  process.exit(0);
}
const issue = Number(issueText);
if (!Number.isInteger(issue) || issue < 1) fail(`issue '${issueText}' is not an issue number`);
const mode = input("mode", false) || "build";
const folder = mainFolderOf(issue);
const allowed = new Set(KINDS.map((k) => `${folder}/${k}.md`));

if (mode === "build") {
  const commit = fact("plan_commit");
  if (!commit) fail("plan_commit is empty");
  const dir = fact("plans_dir") || plansConfig().dir;
  mkdirSync(folder, { recursive: true });
  for (const kind of DOC_KINDS) writeFileSync(join(folder, `${kind}.md`), must(["git", "show", `${commit}:${fileOf(dir, issue, kind)}`]) + "\n");
}
must(["git", "add", "--", mode === "build" ? folder : `${folder}/deviations.md`]);

// Archon's worktrees live under .archon/worktrees; a path of theirs in the index never reaches the branch.
const worktreePaths = must(["git", "ls-files", "--", ".archon/worktrees"]);
if (worktreePaths) {
  must(["git", "rm", "-q", "-r", "--cached", "--", ".archon/worktrees"]);
  writeOutcome("stage-deviation", {
    title: "Worktree paths were removed from the index",
    detail: `git rm --cached ${worktreePaths.split("\n").length} path(s) under .archon/worktrees`,
    why: "the branch carries this issue's documents and the code, never a worktree",
  });
}

const staged = must(["git", "diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
const offenders = staged.filter((p) => !allowed.has(p) && !p.startsWith(".archon/worktrees/"));
if (offenders.length) fail(`staged paths outside ${folder}/ (only its six documents may be staged here): ${offenders.join(", ")}`);

const docs = validateDocs({ issue, dir: folder, kinds: [...KINDS] });
if (!docs.ok) fail(`the documents in ${folder}/ do not validate:\n${formatErrors(docs.errors)}`);

if (run(["git", "diff", "--cached", "--quiet"]).code === 0) {
  console.log(JSON.stringify({ committed: false, head: head() }));
  process.exit(0);
}
const runId = process.env.WORKFLOW_ID || "run";
must(["git", "commit", "-q", "-m", `Docs issue-${issue}: design, plan, test plan and deviations`, "-m", `Issue: #${issue}\nRun: ${runId}`]);
console.log(JSON.stringify({ committed: true, head: head() }));
