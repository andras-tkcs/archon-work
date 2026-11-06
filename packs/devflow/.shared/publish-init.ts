// devflow-init's publish step. Creates the plans branch when origin lacks it (one README). Without a
// change in the repository it makes no branch and no PR. Otherwise it commits exactly the files
// init wrote on <type>/devflow-init, pushes (never forced) and opens one PR; it never merges.
// Env: INPUTS_PROVENANCE (JSON key -> source), INPUTS_DOCTOR (doctor's output, JSON),
// INPUTS_LEFTOVERS (JSON list of toolkit leftovers to clean up by hand), INPUTS_BRANCH_TYPE.
// Prints { initialised, changed, files, pr_url, plans_branch_created, doctor: { ok, warn, fail } }.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commitFiles, fetchPlans } from "./plans-branch.ts";
import { ARCHON_CONFIG, RULINGS_PATH } from "./scaffold-repo.ts";
import { LEGACY_PROFILE_PATH, PROFILE_PATH, artifactsDir, fail, input, isEntry, jsonInput, must, plansConfig, profile, run, tail } from "./util.ts";

export const INIT_PATHS = [PROFILE_PATH, RULINGS_PATH, ARCHON_CONFIG, ".gitignore", LEGACY_PROFILE_PATH];
export const PLANS_README = "Managed by the devflow workflows; do not edit by hand.\n";

// The init paths git sees as changed (added, modified or deleted, staged or not).
export function changedPaths(): string[] {
  const out = must(["git", "status", "--porcelain", "--untracked-files=all", "--", ...INIT_PATHS]);
  return out.split("\n").filter((l) => l.trim()).map((l) => l.slice(3).trim());
}

export function branchName(types: string[] | undefined, override = ""): string {
  const t = override || (types?.length ? (types.includes("chore") ? "chore" : types[0]) : "chore");
  return `${t}/devflow-init`;
}

export function prBody(o: { files: string[]; profileText: string; provenance: Record<string, string>; doctorTable: string; leftovers: string[]; runId: string }): string {
  const prov = Object.entries(o.provenance).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `| \`${k}\` | ${v} |`);
  return [
    "Initialises (or updates) devflow for this repository. Written by `devflow-init`; nothing is merged automatically.",
    "",
    "## Changed files",
    ...o.files.map((f) => `- \`${f}\``),
    "",
    "## Profile",
    "```yaml",
    o.profileText.trimEnd(),
    "```",
    "",
    "| key | source |",
    "|---|---|",
    ...prov,
    "",
    "## Doctor",
    o.doctorTable || "Not run.",
    "",
    "## Manual cleanup",
    ...(o.leftovers.length ? o.leftovers.map((l) => `- [ ] Remove the claude-toolkit leftover \`${l}\` by hand.`) : ["None."]),
    "",
    "## Next",
    "1. Review and merge this PR.",
    "2. `archon workflow sync`",
    "3. Optional model aliases: `archon ai alias set @devflow-planner <model>` and `@devflow-reviewer`.",
    '4. `archon workflow run devflow-refine "#<issue>"`',
    "",
    `Run: ${o.runId}`,
    "",
  ].join("\n");
}

if (isEntry(import.meta)) {
  const runId = process.env.WORKFLOW_ID || "run";
  const doc = jsonInput("doctor") ?? {};
  const counts = { ok: Number(doc.ok ?? 0), warn: Number(doc.warn ?? 0), fail: Number(doc.fail ?? 0) };
  const p = profile();
  const plans = plansConfig();

  let plansCreated = false;
  if (!fetchPlans(plans.ref)) {
    commitFiles({ ref: plans.ref, files: { [`${plans.dir}/README.md`]: PLANS_README }, message: "Create the devflow plans branch", trailers: { Run: runId } });
    plansCreated = true;
  }

  const files = changedPaths();
  if (!files.length) {
    console.log(JSON.stringify({ initialised: true, changed: false, files: [], pr_url: "", plans_branch_created: plansCreated, doctor: counts }));
    process.exit(0);
  }
  const branch = branchName(p.git?.branch_types, input("branch_type", false));
  const main = String(p.git?.main_branch ?? "main");
  if (run(["git", "ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`]).code === 0) {
    fail(`branch ${branch} already exists on origin: merge or close its PR, then rerun devflow-init (nothing was pushed)`);
  }
  must(["git", "switch", "-q", "-c", branch]);
  const present = files.filter((f) => run(["git", "ls-files", "--error-unmatch", "--", f]).code === 0 || run(["test", "-e", f]).code === 0);
  must(["git", "add", "--all", "--", ...present]);
  must(["git", "commit", "-q", "-m", "Initialise devflow (.devflow/devflow.yaml)", "-m", `Run: ${runId}`]);
  const push = run(["git", "push", "-q", "-u", "origin", `HEAD:refs/heads/${branch}`]);
  if (push.code !== 0) fail(`the push of ${branch} was rejected:\n${tail(push.err + push.out, 20)}`);
  const bodyFile = join(artifactsDir(), "init-pr.md");
  writeFileSync(bodyFile, prBody({ files, profileText: readFileSync(PROFILE_PATH, "utf8"), provenance: jsonInput("provenance") ?? {}, doctorTable: String(doc.table ?? ""), leftovers: jsonInput("leftovers") ?? [], runId }));
  const pr = run(["gh", "pr", "create", "--base", main, "--head", branch, "--title", "Initialise devflow", "--body-file", bodyFile]);
  if (pr.code !== 0) fail(`gh pr create failed (the branch ${branch} is pushed): ${(pr.err.trim() || pr.out.trim()).split("\n")[0]}`);
  const url = pr.out.trim().split("\n").pop() ?? "";
  console.log(JSON.stringify({ initialised: true, changed: true, files, pr_url: url, plans_branch_created: plansCreated, doctor: counts }));
}
