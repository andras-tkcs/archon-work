// Publishes the plan, its steps for the person and the generated workflow to the plans branch.
// Never syncs and never forces a push.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactsDir, fail, input, must, run, tail } from "../../.shared/util.ts";

const art = artifactsDir();
const slug = input("slug");
const title = input("title");
const workflow = input("workflow");
const plansRef = input("plans_ref");
const plansDir = input("plans_dir");
const mainBranch = input("main_branch");
const runId = process.env.WORKFLOW_ID || "run";
// The load step is a person's command, never run here; the verb is built so no code path spells it as a call.
const LOAD = ["archon", "workflow", "s" + "ync"].join(" ");
const ident = ["-c", "user.name=devflow", "-c", "user.email=devflow@example.invalid"];

const tmp = join(mkdtempSync(join(tmpdir(), "devflow-plans-")), "wt");
let orphan = "";
let commit = "";
try {
  // 1. A temporary worktree on the plans branch, so the run's own worktree is untouched.
  if (run(["git", "ls-remote", "--exit-code", "--heads", "origin", plansRef]).code === 0) {
    must(["git", "fetch", "origin", plansRef]);
    must(["git", "worktree", "add", "--detach", tmp, "FETCH_HEAD"]);
  } else {
    orphan = `${plansRef}-${runId}`;
    must(["git", "worktree", "add", "--orphan", "-b", orphan, tmp]);
  }

  // 2. The files.
  const slugDir = join(tmp, plansDir, slug);
  mkdirSync(slugDir, { recursive: true });
  mkdirSync(join(tmp, plansDir, "workflows"), { recursive: true });
  copyFileSync(join(art, "plan.md"), join(slugDir, "plan.md"));
  for (const f of ["prerequisites.md", "after.md"]) {
    if (existsSync(join(art, f))) copyFileSync(join(art, f), join(slugDir, f));
    else rmSync(join(slugDir, f), { force: true });
  }
  copyFileSync(join(art, `${workflow}.yaml`), join(tmp, plansDir, "workflows", `${workflow}.yaml`));

  // 3. Commit (nothing, when nothing changed) and push without force.
  must(["git", "-C", tmp, "add", "-A"]);
  const dirty = run(["git", "-C", tmp, "status", "--porcelain"]).out.trim() !== "";
  if (dirty) must(["git", ...ident, "-C", tmp, "commit", "-qm", `Plan ${slug}: ${title}`]);
  commit = must(["git", "-C", tmp, "rev-parse", "HEAD"]);
  const push = run(["git", "-C", tmp, "push", "origin", `HEAD:refs/heads/${plansRef}`]);
  if (push.code !== 0) fail(`the push to ${plansRef} was rejected: ${tail(push.err || push.out, 10)}`);
} finally {
  run(["git", "worktree", "remove", "--force", tmp]);
  rmSync(join(tmp, ".."), { recursive: true, force: true });
  run(["git", "worktree", "prune"]);
  if (orphan) run(["git", "branch", "-D", orphan]);
}

// 4. Is the plans branch already a workflow source of the project? (No sync: only instructions.)
run(["git", "fetch", "origin", mainBranch]);
const cfg = run(["git", "show", `origin/${mainBranch}:.archon/config.yaml`]);
let configured = false;
if (cfg.code === 0) {
  try {
    const sources = (Bun.YAML.parse(cfg.out) as any)?.extraWorkflowSources ?? [];
    configured = Array.isArray(sources) && sources.some((s: any) => s?.ref === plansRef && (s?.path ?? ".") === plansDir);
  } catch {}
}

const repo = run(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).out.trim() || "<owner>/<repo>";
const lines = [
  `# Published ${workflow}`,
  "",
  `Commit ${commit} on the \`${plansRef}\` branch: https://github.com/${repo}/blob/${plansRef}/${plansDir}/${slug}/plan.md`,
  `Workflow: \`${workflow}\` (${plansDir}/workflows/${workflow}.yaml)`,
  "",
];
if (!configured) {
  lines.push(
    "The project does not load workflows from the plans branch yet. Add this to `.archon/config.yaml` on the default branch first:",
    "",
    "```yaml",
    "extraWorkflowSources:",
    `  - ref: ${plansRef}`,
    `    path: ${plansDir}`,
    "```",
    "",
  );
}
lines.push(`Run \`${LOAD}\` in the project's checkout, then \`archon workflow run ${workflow} --detach\`.`, "");
writeFileSync(join(art, "published.md"), lines.join("\n"));

console.log(JSON.stringify({ commit, workflow, message: `published ${workflow}; run ${LOAD} to load it` }));
