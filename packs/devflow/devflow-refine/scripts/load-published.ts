// Loads a plan that devflow-plan published to the plans branch, checks that its implementation has not started,
// and writes the originals to $ARTIFACTS_DIR/original/. Prints one JSON line on stdout; diagnostics go to stderr.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactsDir, fail, input, must, run, tail } from "../../.shared/util.ts";
import { extractManifest } from "../../.shared/render-run.ts";

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG = "([a-z0-9]+(?:-[a-z0-9]+)*)";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const planIn = input("plan", false);
const workIn = input("work", false);
const plansRef = input("plans_ref");
const plansDir = input("plans_dir");
const mainBranch = input("main_branch");
const checkOnly = input("check_only", false) === "true";
const message = process.env.USER_MESSAGE ?? "";

// 1. Plans branch.
if (run(["git", "ls-remote", "--exit-code", "--heads", "origin", plansRef]).code !== 0) {
  fail(`the ${plansRef} branch does not exist on origin: there is no published plan to refine`);
}
must(["git", "fetch", "origin", plansRef]);
const planCommit = must(["git", "rev-parse", "FETCH_HEAD"]);
const ls = run(["git", "ls-tree", "--name-only", `${planCommit}:${plansDir}/`]);
const known = ls.code === 0
  ? ls.out.split("\n").map((l) => l.trim()).filter((l) => l !== "" && l !== "workflows" && KEBAB.test(l))
  : [];

const reUrl = () => new RegExp("/" + escapeRe(plansDir) + "/" + SLUG + "/plan\\.md", "g");
const rePath = () => new RegExp("(^|[^A-Za-z0-9_/.-])" + escapeRe(plansDir) + "/" + SLUG, "g");

let slug = "";
if (planIn !== "") {
  // 2. Slug from --input plan.
  if (KEBAB.test(planIn)) slug = planIn;
  else {
    const m = new RegExp("/" + escapeRe(plansDir) + "/([a-z0-9]+(?:-[a-z0-9]+)*)/plan\\.md").exec(planIn);
    if (!m) fail(`'${planIn}' is neither a plan slug nor a plan URL`);
    slug = m[1];
  }
} else {
  // 3. Slug from the message.
  const found = new Set<string>();
  for (const m of message.matchAll(reUrl())) found.add(m[1]);
  for (const m of message.matchAll(rePath())) found.add(m[2]);
  for (const t of message.split(/[^A-Za-z0-9_\/-]+/)) if (known.includes(t)) found.add(t);
  if (found.size === 0) {
    fail(`Not refined: no plan named. Start devflow-refine with a message that names the plan (its slug, ${plansDir}/<slug>, or its plan.md URL on the ${plansRef} branch), or with --input plan=<slug>.`);
  }
  if (found.size > 1) {
    fail(`Not refined: the message names more than one plan (${[...found].sort().join(", ")}). Name one, or start devflow-refine with --input plan=<slug>.`);
  }
  slug = [...found][0];
}

// 4. The plan file.
const planPath = `${plansDir}/${slug}/plan.md`;
const shown = run(["git", "show", `${planCommit}:${planPath}`]);
if (shown.code !== 0) fail(`no plan '${slug}' on ${plansRef} (${planPath})`);
const planText = shown.out;

// 5. The manifest.
let manifest: any;
try {
  manifest = extractManifest(planText);
} catch (e) {
  fail((e as Error).message);
}
if (manifest.plan_slug !== slug) {
  fail(`the published plan's plan_slug '${manifest.plan_slug}' differs from its directory '${slug}'`);
}
const branch = String(manifest.feature_branch ?? "");
if (branch === "") fail(`the published plan ${slug} has no feature_branch`);
const titleLine = planText.split("\n").find((l) => l.startsWith("# "));
const title = titleLine ? titleLine.slice(2).trim() : slug;

// 6. The change.
// The note outside code fences only (a plan may quote the note in a fenced example).
let incomplete = false;
{
  let inFence = false;
  for (const l of planText.split("\n")) {
    if (l.startsWith("```")) inFence = !inFence;
    else if (!inFence && l.startsWith("> Incomplete plan:")) incomplete = true;
  }
}
const work = workIn !== "" ? workIn : message;
let rest = work;
rest = rest.replace(reUrl(), (all, s) => (s === slug ? "" : all));
rest = rest.replace(rePath(), (all, pre, s) => (s === slug ? pre : all));
rest = rest.replace(new RegExp("(?<![A-Za-z0-9_-])" + escapeRe(slug) + "(?![A-Za-z0-9_-])", "g"), "");
rest = rest.replace(/\brefine\b/gi, "");
let workOut = work;
if (!/[A-Za-z]/.test(rest)) {
  if (!incomplete) fail(`Not refined: say what to change in the plan ${slug}, in the message or with --input work=<change>.`);
  workOut = `Continue the incomplete plan ${slug}: ask its open questions again and fix its remaining validation findings.`;
}

// 7. The started check.
let reason = "";
if (run(["git", "ls-remote", "--exit-code", "--heads", "origin", branch]).code === 0) {
  reason = "branch";
} else {
  must(["git", "fetch", "origin", mainBranch]);
  const log = must(["git", "log", `origin/${mainBranch}`, "--format=%H", "--fixed-strings", `--grep=Plan-Phase: ${slug}/`]);
  if (log !== "") reason = "merged";
  else {
    const r = run(["gh", "pr", "list", "--head", branch, "--state", "merged", "--json", "number", "--jq", "length"]);
    const n = r.out.trim();
    if (r.code !== 0 || !/^\d+$/.test(n)) {
      fail(`cannot check for a merged pull request from ${branch}: ${tail(r.out + r.err, 5)}`);
    }
    if (Number(n) > 0) reason = "merged";
  }
}
const started = reason !== "";
const refusal = reason === "branch"
  ? `Not refined: the plan ${slug} is already being implemented (its branch ${branch} exists on origin). devflow-refine only changes plans whose implementation has not started.`
  : reason === "merged"
    ? `Not refined: the plan ${slug} is already implemented (it is merged into ${mainBranch}). devflow-refine only changes plans whose implementation has not started.`
    : "";

// 8. Check-only mode.
if (checkOnly) {
  if (started) fail(refusal);
  console.log(JSON.stringify({ ok: true }));
  process.exit(0);
}

// 9. The originals.
const dir = join(artifactsDir(), "original");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "plan.md"), planText);
for (const f of ["prerequisites.md", "after.md"]) {
  const r = run(["git", "show", `${planCommit}:${plansDir}/${slug}/${f}`]);
  if (r.code === 0) writeFileSync(join(dir, f), r.out);
}
console.log(JSON.stringify({ slug, branch, title, plan_commit: planCommit, started, reason, refusal, work: workOut }));
