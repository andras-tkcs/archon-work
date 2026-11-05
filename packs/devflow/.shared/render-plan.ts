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

// With soft_errors=true (devflow-plan's fix loop) a plan error is output, not a node failure:
// finalize can fix it, so the loop must see it.
const soft = input("soft_errors", false) === "true";
function planError(msg: string): never {
  if (!soft) fail(msg);
  console.log(JSON.stringify({ ok: false, error: msg, workflow: "", file: "", waves: 0 }));
  process.exit(0);
}

const planFile = join(art, "plan.md");
if (!existsSync(planFile)) planError(`${planFile} does not exist: finalize did not write the plan`);
let manifest;
try {
  manifest = extractManifest(readFileSync(planFile, "utf8"));
} catch (e) {
  planError((e as Error).message);
}
if (manifest.plan_slug !== slug) planError(`the manifest's plan_slug '${manifest.plan_slug}' differs from the slug '${slug}'`);
if (manifest.feature_branch !== branch) planError(`the manifest's feature_branch '${manifest.feature_branch}' differs from the branch '${branch}'`);
if (!new RegExp(branchRegex).test(branch)) planError(`the branch '${branch}' does not match ${branchRegex}`);

// The installed catalog, read once: for the building-block check.
const list = run(["archon", "workflow", "list", "--json"]);
if (list.code !== 0) fail(`\`archon workflow list --json\` failed:\n${tail(list.out + list.err, 20)}`);
const names: string[] = [];
try {
  const j = JSON.parse(list.out);
  for (const w of j.workflows ?? []) names.push(String(w.name ?? ""));
} catch {
  fail(`\`archon workflow list --json\` did not print JSON:\n${tail(list.out, 20)}`);
}

// Pack identity: the input, else the pack this run was started from.
let pack = input("pack", false);
if (!pack) {
  const runId = process.env.WORKFLOW_ID ?? "";
  if (!runId) {
    fail("cannot tell which installed devflow pack this run comes from (WORKFLOW_ID is not set); start the workflow with --input pack=<owner>/devflow");
  }
  const got = run(["archon", "workflow", "get", runId, "--json"]);
  if (got.code !== 0) fail(`\`archon workflow get ${runId} --json\` failed:\n${tail(got.out + got.err, 20)}`);
  let wfName = "";
  try {
    const j = JSON.parse(got.out);
    wfName = String(j.workflow_name ?? j.run?.workflow_name ?? "");
  } catch {
    fail(`\`archon workflow get ${runId} --json\` did not print JSON:\n${tail(got.out, 20)}`);
  }
  const m = wfName.match(/^([^/:]+\/[^:]+):[^:]+$/);
  if (!m) {
    fail(`the run's workflow '${wfName}' is not from an installed pack; start the workflow with --input pack=<owner>/devflow`);
  }
  pack = m[1];
}
const missing = ["mod-devflow-phase", "mod-devflow-deliver"].map((n) => `${pack}:${n}`).filter((n) => !names.includes(n));
if (missing.length) {
  fail(
    `the installed pack ${pack} has no ${missing.join(" and ")} in \`archon workflow list\`; update the pack (bootstrap.sh, or archon plugin update <its plugin id>) or start the workflow with --input pack=<owner>/devflow`,
  );
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
  planError((e as Error).message);
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

console.log(JSON.stringify({ ok: true, error: "", workflow: name, file, waves: waves(manifest).length }));
