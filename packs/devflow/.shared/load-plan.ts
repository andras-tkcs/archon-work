// Reads a published plan for mod-devflow-phase (mode=phase) and mod-devflow-deliver (mode=deliver): writes
// $ARTIFACTS_DIR/plan.md, plan-test.md (when the plan has one) and context.json, checks the worktree,
// and says whether the phase is done. A phase with a task (INPUTS_TASK, devflow-follow-up's f<k>
// phases) is not in the manifest: its brief is the task file, copied to $ARTIFACTS_DIR/task.md.
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "./frontmatter.ts";
import { repoSlug } from "./gh.ts";
import { ISSUES_SUBDIR, SLUG_RE } from "./layout.ts";
import { extractManifest, validateModels } from "./render-run.ts";
import { artifactsDir, fail, input, must, profile, run } from "./util.ts";

const mode = input("mode");
if (mode !== "phase" && mode !== "deliver") fail(`mode must be 'phase' or 'deliver', not '${mode}'`);
const planRef = input("plan_ref");
const planPath = input("plan_path");
const planCommit = input("plan_commit", false);
const dir = artifactsDir();

const shown = planCommit
  ? run(["git", "show", `${planCommit}:${planPath}`])
  : (() => {
      const f = run(["git", "fetch", "origin", planRef]);
      return f.code === 0 ? run(["git", "show", `FETCH_HEAD:${planPath}`]) : f;
    })();
if (shown.code !== 0) fail(`cannot read ${planPath} from ${planCommit || planRef}: ${shown.err.trim()}`);
const planText = shown.out;
writeFileSync(join(dir, "plan.md"), planText);
const testPlan = run(["git", "show", `${planCommit || "FETCH_HEAD"}:${dirname(planPath)}/plan-test.md`]);
if (testPlan.code === 0) writeFileSync(join(dir, "plan-test.md"), testPlan.out);

let manifest;
try {
  manifest = extractManifest(planText);
} catch (e) {
  fail((e as Error).message);
}
try {
  validateModels(manifest);
} catch (e) {
  fail((e as Error).message);
}
const slug = manifest.plan_slug ?? "";
const planBranch = manifest.feature_branch ?? "";
if (!slug || !planBranch) fail("the manifest has no plan_slug or feature_branch");
// A follow-up delivers from its own branch (followup/issue-<n>-<k>), not the plan's.
const branch = input("branch", false) || planBranch;
const title = input("title", false) || (planText.match(/^# (.+)$/m)?.[1] ?? slug);

let done = false;
let model = "";
const task = input("task", false);
if (mode === "phase") {
  const phase = input("phase");
  const base = input("base");
  if (task) {
    if (!/^f[0-9]+$/.test(phase)) fail(`a follow-up phase id must be f<k>, not '${phase}'`);
    if (!existsSync(task)) fail(`the task file ${task} does not exist`);
    copyFileSync(task, join(dir, "task.md"));
    model = "medium";
  } else {
    if (!manifest.phases.some((p) => p.id === phase)) fail(`'${phase}' is not a phase of ${slug}: ${manifest.phases.map((p) => p.id).join(", ")}`);
    model = manifest.phases.find((p) => p.id === phase)!.model!;
  }
  must(["git", "cat-file", "-e", `${base}^{commit}`]);
  must(["git", "reset", "--hard", base]);
  done = !task && must(["git", "log", base, "--format=%H", "--fixed-strings", `--grep=Plan-Phase: ${slug}/${phase}`]) !== "";
} else {
  const current = must(["git", "branch", "--show-current"]);
  if (current !== branch) fail(`the worktree is on '${current}', not the branch '${branch}'`);
  const head = input("head", false);
  if (head && must(["git", "rev-parse", "HEAD"]) !== head) fail(`HEAD is not ${head}, the merged head of the phases`);
}

// Traceability facts for the PR body. A plan from before issue folders has none; that is not an error.
const issue = SLUG_RE.exec(slug)?.[1] ?? "";
let designRevision = "";
let planRevision = "";
try {
  const { fm } = parse(planText);
  designRevision = String(fm.design_revision ?? "");
  planRevision = String(fm.revision ?? "");
} catch {}
let designUrl = "";
let planUrl = "";
if (issue) {
  try {
    const base = `https://github.com/${repoSlug()}/blob/${planRef}`;
    planUrl = `${base}/${planPath}`;
    designUrl = `${base}/${dirname(planPath)}/design.md`;
  } catch {}
}

writeFileSync(
  join(dir, "context.json"),
  JSON.stringify({
    proceed: true,
    reason: "published plan",
    scope: manifest.phases.length === 1 ? "small" : "large",
    slug,
    branch,
    title,
    main_branch: profile().git.main_branch,
    shared_dir: input("shared_dir", false),
    issue,
    design_url: designUrl,
    plan_url: planUrl,
    design_revision: designRevision,
    plan_revision: planRevision,
    plans_ref: planRef,
    plans_dir: planPath.split(`/${ISSUES_SUBDIR}/`)[0],
    plan_commit: planCommit,
    run_key: input("run_key", false),
  }),
);
console.log(JSON.stringify({ slug, branch, title, done, model, review_model: manifest.review_model }));
