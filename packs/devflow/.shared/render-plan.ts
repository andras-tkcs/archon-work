// Renders the devflow-run-<slug> workflow from the final plan and validates it with `archon validate`.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractManifest, renderRunWorkflow, waves } from "./render-run.ts";
import { artifactsDir, fail, input, must, run, tail } from "./util.ts";

const art = artifactsDir();
const slug = input("slug");
const branch = input("branch");
const title = input("title");
const mainBranch = input("main_branch");
const branchRegex = input("branch_regex");
const plansRef = input("plans_ref");
const plansDir = input("plans_dir");

const planFile = join(art, "plan.md");
if (!existsSync(planFile)) fail(`${planFile} does not exist: finalize did not write the plan`);
let manifest;
try {
  manifest = extractManifest(readFileSync(planFile, "utf8"));
} catch (e) {
  fail((e as Error).message);
}
if (manifest.plan_slug !== slug) fail(`the manifest's plan_slug '${manifest.plan_slug}' differs from the slug '${slug}'`);
if (manifest.feature_branch !== branch) fail(`the manifest's feature_branch '${manifest.feature_branch}' differs from the branch '${branch}'`);
if (!new RegExp(branchRegex).test(branch)) fail(`the branch '${branch}' does not match ${branchRegex}`);

// Pack identity: the input, else the one installed pack that has devflow-plan.
let pack = input("pack", false);
if (!pack) {
  const r = run(["archon", "workflow", "list", "--json"]);
  const names: string[] = [];
  if (r.code === 0) {
    try {
      const j = JSON.parse(r.out);
      for (const w of j.workflows ?? []) names.push(String(w.name ?? ""));
    } catch {}
  }
  const found = [...new Set(names.map((n) => n.match(/^([^/]+\/[^:]+):devflow-plan$/)?.[1]).filter(Boolean))] as string[];
  if (found.length !== 1) {
    fail(`cannot tell which installed devflow pack to use (${found.join(", ") || "none found"}); start the workflow with --input pack=<owner>/devflow`);
  }
  pack = found[0];
}

const read = (f: string) => (existsSync(join(art, f)) ? readFileSync(join(art, f), "utf8") : null);
const name = `devflow-run-${slug}`;
let yaml: string;
try {
  yaml = renderRunWorkflow({
    manifest,
    slug,
    branch,
    title,
    mainBranch,
    pack,
    plansRef,
    plansDir,
    prerequisites: read("prerequisites.md"),
    after: read("after.md"),
    sourceRun: process.env.WORKFLOW_ID ?? "",
  });
} catch (e) {
  fail((e as Error).message);
}
const file = join(art, `${name}.yaml`);
writeFileSync(file, yaml);

// Validate in a scratch git repo, as Archon sees a project workflow.
const tmp = mkdtempSync(join(tmpdir(), "devflow-render-"));
try {
  mkdirSync(join(tmp, ".archon", "workflows"), { recursive: true });
  writeFileSync(join(tmp, ".archon", "workflows", `${name}.yaml`), yaml);
  must(["git", "init", "-q", "-b", "main"], { cwd: tmp });
  must(["git", "add", "-A"], { cwd: tmp });
  must(["git", "-c", "user.name=devflow", "-c", "user.email=devflow@example.invalid", "commit", "-qm", "rendered"], { cwd: tmp });
  const v = run(["archon", "validate", "workflows", name, "--json"], { cwd: tmp });
  let errors = 0;
  try {
    errors = Number(JSON.parse(v.out)?.summary?.errors ?? 0);
  } catch {}
  if (v.code !== 0 || errors !== 0) fail(`archon validate rejected ${name}\n${tail(v.out + v.err, 40)}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(JSON.stringify({ workflow: name, file, waves: waves(manifest).length }));
