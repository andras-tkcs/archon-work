// Commits this issue's folder plans/issue-<n>/ on the build's branch, and nothing else, so the PR
// carries exactly design.md, plan.md, plan-test.md, before.md, after.md and deviations.md into main.
// Build mode copies the five documents from the plans commit; any other mode (follow-up, final) only
// stages deviations.md (the others are already on the branch). Never `git add -A` or `.`.
// Env (else context.json): INPUTS_ISSUE (empty: work without an issue, nothing to do),
// INPUTS_PLAN_COMMIT, INPUTS_MODE, INPUTS_PLANS_DIR, INPUTS_CHANGED ("false": the deviations pass
// changed nothing), INPUTS_RUN_KEY. Prints { committed, head } and writes the outcome `stage` (or
// `stage-final`) { ok, committed, head }: written as not ok first, so a failure anywhere leaves it so.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DOC_KINDS, KINDS, fileOf, mainFolderOf } from "./layout.ts";
import { parse, serialize } from "./frontmatter.ts";
import { writeOutcome } from "./outcomes.ts";
import { fact, fail, input, must, plansConfig, run } from "./util.ts";
import { formatErrors, validateDocs } from "./validate-docs.ts";
import { appendBlocks, deviationsPath } from "./write-deviations.ts";

const head = () => must(["git", "rev-parse", "HEAD"]);
const mode = input("mode", false) || "build";
const outcome = mode === "final" ? "stage-final" : "stage";
const runKey = fact("run_key");
writeOutcome(outcome, { ok: false, committed: false, head: "", detail: "stage-docs did not finish: see its node's log" }, runKey);
const done = (committed: boolean) => {
  const out = { committed, head: head() };
  writeOutcome(outcome, { ok: true, ...out }, runKey);
  console.log(JSON.stringify(out));
  process.exit(0);
};

const issueText = fact("issue");
if (issueText === "" || input("changed", false) === "false") done(false);
const issue = Number(issueText);
if (!Number.isInteger(issue) || issue < 1) fail(`issue '${issueText}' is not an issue number`);
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

// Archon's worktrees live under .archon/worktrees; a path of theirs in the index never reaches the
// branch. Removing one is recorded in deviations.md.
const worktreePaths = must(["git", "ls-files", "--", ".archon/worktrees"]);
if (worktreePaths) {
  must(["git", "rm", "-q", "-r", "--cached", "--", ".archon/worktrees"]);
  const file = deviationsPath(issue);
  const { fm, body } = parse(readFileSync(file, "utf8"));
  const block = [
    "Worktree paths were removed from the index",
    "- Phase: wrap",
    "- Planned: only the issue's documents and the code are committed",
    `- Done: git rm --cached ${worktreePaths.split("\n").length} path(s) under .archon/worktrees`,
    "- Why: a worktree never belongs on the branch",
  ];
  writeFileSync(file, serialize(fm, appendBlocks(body, "Deviations from design and plan", "V", [block])));
  must(["git", "add", "--", file]);
}

const staged = must(["git", "diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
const offenders = staged.filter((p) => !allowed.has(p) && !p.startsWith(".archon/worktrees/"));
if (offenders.length) fail(`staged paths outside ${folder}/ (only its six documents may be staged here): ${offenders.join(", ")}`);

const docs = validateDocs({ issue, dir: folder, kinds: [...KINDS] });
if (!docs.ok) fail(`the documents in ${folder}/ do not validate:\n${formatErrors(docs.errors)}`);

if (run(["git", "diff", "--cached", "--quiet"]).code === 0) done(false);
const runId = process.env.WORKFLOW_ID || "run";
must(["git", "commit", "-q", "-m", `Docs issue-${issue}: design, plan, test plan and deviations`, "-m", `Issue: #${issue}\nRun: ${runId}`]);
done(true);
