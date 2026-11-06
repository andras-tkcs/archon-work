// Resolves the issue a devflow-refine / devflow-plan run is about and decides whether the run may change
// it. It never writes anything. Env: INPUTS_WORK (free text, else USER_MESSAGE), INPUTS_CHANGE,
// INPUTS_PLANS_REF, INPUTS_PLANS_DIR, INPUTS_MAIN_BRANCH, INPUTS_MODE (refine|plan), INPUTS_PACK.
// User text and issue content are untrusted: they only ever reach git and gh as single argv entries.
import { extractManifest } from "./render-run.ts";
import { parse, validate } from "./frontmatter.ts";
import { fetchPlans, readAt } from "./plans-branch.ts";
import { repoSlug } from "./gh.ts";
import { DOC_KINDS, fileOf, folderOf, slugOf } from "./layout.ts";
import { fail, input, isEntry, plansConfig, run, tail } from "./util.ts";

export const COMMENTS_LIMIT = 200 * 1024;
export const TRUNCATED = "…[truncated]";

const EXAMPLE = "devflow-refine #42";

interface Hit {
  n: string;
  start: number;
  end: number;
}

// Each form, in the order of the spec's step 1. A matched span is consumed, so later forms never see its digits.
const KIND_NAMES = DOC_KINDS.join("|");
const FORMS: RegExp[] = [
  // (b) a URL or path naming the issue folder or the build workflow
  /\S*(?<![\w.-])plans\/issue-([0-9]+)\/\S*/g,
  /\S*(?<![\w.-])workflows\/build-issue-([0-9]+)\.ya?ml\S*/g,
  // (c) issue-<n>, issue-<n>/plan.md (and the other kinds)
  new RegExp(`(?<![\\w-])issue-([0-9]+)(?:\\/(?:${KIND_NAMES})\\.md)?(?![\\w-])`, "g"),
  // (d) #<n>
  /(?<![\w&#])#([0-9]+)(?![\w])/g,
];
const ISSUE_URL = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/([0-9]+)(?![0-9])\S*/g;
const BARE_INT = /(?<![\w.\/#&-])([0-9]+)(?![\w.\/-])/g;
const KIND_FILE = new RegExp(`(?<![\\w-])(?:${KIND_NAMES})\\.md(?![\\w-])`);
const COMMAND_WORDS = /^(?:[\s:;,]*(?:devflow-refine|devflow-plan|refine|plan)(?![\w-]))+/i;

function blank(text: string, h: Hit): string {
  return text.slice(0, h.start) + " ".repeat(h.end - h.start) + text.slice(h.end);
}

function collect(text: string, re: RegExp, group: number): Hit[] {
  return [...text.matchAll(re)].map((m) => ({ n: m[group], start: m.index!, end: m.index! + m[0].length }));
}

function toIssue(raw: string): number {
  const n = Number(raw);
  if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(n) || n < 1) throw new Error(`'${raw}' is not a valid issue number (a positive integer)`);
  return n;
}

// Finds the issue reference(s) in the text: explicit references (issue URL, plan/workflow URL or path,
// issue-<n>, #<n>) win; a bare integer counts only when there is none. Throws with the user-facing texts.
export function scan(text: string, repo: string): { issue: number; rest: string } {
  let rest = text;
  const hits: Hit[] = [];
  for (const h of collect(rest, ISSUE_URL, 3)) {
    const m = new RegExp(ISSUE_URL.source).exec(text.slice(h.start, h.end))!;
    const slug = `${m[1]}/${m[2]}`;
    if (slug.toLowerCase() !== repo.toLowerCase()) throw new Error(`issue URL is for ${slug}, not this repository`);
    hits.push(h);
    rest = blank(rest, h);
  }
  for (const re of FORMS) {
    for (const h of collect(rest, re, 1)) {
      hits.push(h);
      rest = blank(rest, h);
    }
  }
  if (!hits.length) {
    for (const h of collect(rest, BARE_INT, 1)) {
      hits.push(h);
      rest = blank(rest, h);
    }
  }
  if (!hits.length) {
    if (KIND_FILE.test(text)) {
      throw new Error(`name the issue: a file name alone does not say which issue. Pass for example issue-42/plan.md or #42`);
    }
    throw new Error(`no issue named. Pass an issue number or URL, or a plan URL, for example: ${EXAMPLE}`);
  }
  const numbers = [...new Set(hits.sort((x, y) => x.start - y.start).map((h) => toIssue(h.n)))];
  if (numbers.length > 1) throw new Error(`more than one issue named (${numbers.map((n) => `#${n}`).join(", ")}); name one`);
  return { issue: numbers[0], rest };
}

export function findIssue(text: string, repo: string): number {
  return scan(text, repo).issue;
}

// The text without the issue reference and without leading command words (refine, plan).
export function changeOf(rest: string): string {
  return rest.replace(COMMAND_WORDS, "").replace(/^[\s:;,—–-]+/, "").replace(/[ \t]{2,}/g, " ").trim();
}

// Truncates to at most `limit` UTF-8 bytes including the marker, never splitting a character.
export function bound(text: string, limit = COMMENTS_LIMIT): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= limit) return text;
  let cut = limit - Buffer.byteLength(TRUNCATED, "utf8");
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--;
  return bytes.subarray(0, cut).toString("utf8") + TRUNCATED;
}

export function renderComments(comments: unknown): string {
  if (!Array.isArray(comments)) return "";
  const blocks = comments.map((c: any) => {
    const login = String(c?.author?.login ?? "ghost");
    const date = String(c?.createdAt ?? "").slice(0, 10);
    return `**@${login} ${date}:** ${String(c?.body ?? "")}`;
  });
  return bound(blocks.join("\n\n"));
}

function refName(value: string, what: string): string {
  if (value.startsWith("-") || run(["git", "check-ref-format", "--branch", value]).code !== 0) {
    fail(`${what} '${value}' is not a valid branch name`);
  }
  return value;
}

function plansDirName(value: string): string {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.\/-]*$/.test(value) || value.split("/").some((p) => p === ".." || p === "." || p === "")) {
    fail(`plans_dir '${value}' is not a relative directory path`);
  }
  return value;
}

// 0 = the branch exists on origin, 2 = it does not; anything else is a failure to check.
function remoteHas(branch: string, why: string): boolean {
  const r = run(["git", "ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`]);
  if (r.code === 0) return true;
  if (r.code === 2) return false;
  return fail(`cannot check ${why}: git ls-remote origin failed\n${tail(r.err + r.out, 20)}`);
}

// The revision in the file's front matter. An unreadable block fails when `strict`, else counts as 0:
// devflow-plan's load-design step then lists every error of a hand-edited design.
function revisionOf(text: string, kind: "design" | "plan", where: string, strict: boolean): number {
  let errs: string[];
  let fm: Record<string, unknown> = {};
  try {
    fm = parse(text).fm;
    errs = validate(fm, kind);
  } catch (e) {
    errs = [(e as Error).message];
  }
  if (errs.length === 0) return fm.revision as number;
  if (strict) fail(`${where}: ${errs.join("; ")}`);
  return 0;
}

function main(): void {
  const mode = input("mode", false);
  if (mode !== "refine" && mode !== "plan") fail("mode must be refine or plan");
  const plans = plansConfig();
  const plansRef = refName(plans.ref, "plans_ref");
  const plansDir = plansDirName(plans.dir);
  const mainBranch = refName(input("main_branch"), "main_branch");
  const pack = input("pack", false) || "tkcs-lab/devflow";

  // 1. the issue
  const text = input("work", false) || process.env.USER_MESSAGE || "";
  let repo: string;
  try {
    repo = repoSlug();
  } catch (e) {
    return fail((e as Error).message);
  }
  let found: { issue: number; rest: string };
  try {
    found = scan(text, repo);
  } catch (e) {
    return fail((e as Error).message);
  }
  const n = found.issue;

  // 2. the change request
  const change = input("change", false) || changeOf(found.rest);

  // 3. the issue itself (untrusted)
  const view = run(["gh", "issue", "view", String(n), "--json", "number,title,body,state,url,comments"]);
  if (view.code !== 0) fail(`cannot read issue #${n}: ${(view.err.trim() || view.out.trim()).split("\n")[0]}`);
  let issue: any;
  try {
    issue = JSON.parse(view.out);
  } catch {
    return fail(`cannot read issue #${n}: gh printed no JSON`);
  }
  if (Number(issue?.number) !== n) fail(`cannot read issue #${n}: gh returned issue '${issue?.number}'`);
  const state = String(issue.state ?? "").toLowerCase();

  // 4. closed
  let refusal = state === "closed" ? `Issue #${n} is closed.` : "";

  // 5. plan state on the plans branch
  let plansCommit = "";
  let designRevision = 0;
  let planRevision = 0;
  let designPresent = false;
  let planPresent = false;
  let existingBranch = "";
  plansCommit = fetchPlans(plansRef);
  if (plansCommit) {
    const designPath = fileOf(plansDir, n, "design");
    const planPath = fileOf(plansDir, n, "plan");
    const design = readAt(plansCommit, designPath);
    if (design !== null) {
      designPresent = true;
      designRevision = revisionOf(design, "design", `${designPath} on ${plansRef}`, mode === "refine");
    }
    const plan = readAt(plansCommit, planPath);
    if (plan !== null) {
      planPresent = true;
      planRevision = revisionOf(plan, "plan", `${planPath} on ${plansRef}`, false);
      let branch: unknown;
      try {
        branch = extractManifest(plan).feature_branch;
      } catch (e) {
        return fail(`${planPath} on ${plansRef}: ${(e as Error).message}`);
      }
      if (typeof branch === "string" && branch !== "") existingBranch = refName(branch, `the plan's feature_branch`);
    }
  }

  // 6. started check
  let started = false;
  if (existingBranch !== "") {
    const why = `whether the build of issue #${n} has started`;
    let reason = "";
    if (remoteHas(existingBranch, why)) reason = `branch ${existingBranch} exists on origin`;
    if (!reason) {
      const f = run(["git", "fetch", "origin", `refs/heads/${mainBranch}`]);
      if (f.code !== 0) fail(`cannot check ${why}: git fetch origin ${mainBranch} failed\n${tail(f.err + f.out, 20)}`);
      const head = run(["git", "rev-parse", "FETCH_HEAD"]);
      if (head.code !== 0) fail(`cannot check ${why}: ${head.err.trim()}`);
      const grep = `Plan-Phase: ${slugOf(n)}/`;
      const log = run(["git", "log", head.out.trim(), "--fixed-strings", "--grep", grep, "--format=%h", "-n", "1"]);
      if (log.code !== 0) fail(`cannot check ${why}: git log failed\n${tail(log.err, 20)}`);
      if (log.out.trim()) reason = `${mainBranch} has commit ${log.out.trim()} with '${grep}'`;
    }
    if (!reason) {
      const prs = run(["gh", "pr", "list", "--head", existingBranch, "--state", "merged", "--json", "number,url", "--limit", "1"]);
      if (prs.code !== 0) fail(`cannot check ${why}: gh pr list failed: ${(prs.err.trim() || prs.out.trim()).split("\n")[0]}`);
      let list: any;
      try {
        list = JSON.parse(prs.out || "[]");
      } catch {
        return fail(`cannot check ${why}: gh pr list printed no JSON`);
      }
      if (!Array.isArray(list)) fail(`cannot check ${why}: gh pr list printed no list`);
      if (list.length) reason = `PR #${list[0]?.number} from ${existingBranch} is merged`;
    }
    if (reason) {
      started = true;
      refusal ||= `Not changed: the build of issue #${n} has started (${reason}). devflow-refine and devflow-plan only change issues whose build has not started.`;
    }
  }

  // 7. plan needs a design
  if (mode === "plan" && !designPresent) {
    refusal ||= `Not planned: issue #${n} has no design. Run: archon workflow run ${pack}:devflow-refine "#${n}"`;
  }

  console.log(
    JSON.stringify({
      issue: n,
      slug: slugOf(n),
      folder: folderOf(plansDir, n),
      title: String(issue.title ?? ""),
      body: String(issue.body ?? ""),
      comments: renderComments(issue.comments),
      url: String(issue.url ?? ""),
      state,
      design_revision: designRevision,
      plan_revision: planRevision,
      design_present: designPresent,
      plan_present: planPresent,
      existing_branch: existingBranch,
      plans_commit: plansCommit,
      change,
      started,
      refusal,
    }),
  );
}

if (isEntry(import.meta)) main();
