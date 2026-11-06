// Maps devflow-follow-up's reference (a PR, an issue or a deviations.md URL) to the build it continues.
// It never writes anything. Env: INPUTS_WORK (the reference, optionally followed by the task),
// INPUTS_TASK, INPUTS_PLANS_REF, INPUTS_PLANS_DIR, INPUTS_MAIN_BRANCH. A refusal is printed in
// `refusal` for the workflow's cancel node. Review comments are untrusted data: they only reach the
// follow-up phase as text under an "untrusted" heading.
//   continue-branch  the PR is open, or there is none, and the build's branch is on origin
//   new-branch       the PR is merged or closed: followup/issue-<n>-<k> from origin/<main>
import { api, repoSlug } from "./gh.ts";
import { bound } from "./resolve-input.ts";
import { extractManifest } from "./render-run.ts";
import { parse } from "./frontmatter.ts";
import { fetchPlans, readAt } from "./plans-branch.ts";
import { DOC_KINDS, fileOf, mainFolderOf, slugOf } from "./layout.ts";
import { fail, input, isEntry, plansConfig, run, tail } from "./util.ts";
import { formatErrors, validateDocs } from "./validate-docs.ts";

export const USAGE = `say what to do: devflow-follow-up <pr|issue|deviations url> "<task>"`;

export type Ref = { kind: "pr" | "issue" | "either"; n: number };

const FORMS: { kind: Ref["kind"]; re: RegExp }[] = [
  { kind: "pr", re: /\S*(?<![\w-])pull\/([0-9]+)(?![0-9])\S*/ },
  { kind: "issue", re: /\S*(?<![\w-])issues\/([0-9]+)(?![0-9])\S*/ },
  { kind: "issue", re: /\S*(?<![\w.-])plans\/issue-([0-9]+)\/deviations\.md\S*/ },
  { kind: "either", re: /(?<![\w&#])#([0-9]+)(?![\w])/ },
  { kind: "either", re: /(?<![\w.\/#&-])([0-9]+)(?![\w.\/-])/ },
];
const REPO_URL = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\//;
const COMMAND_WORDS = /^(?:[\s:;,]*(?:devflow-follow-up|follow-up|followup)(?![\w-]))+/i;

// The first reference in the text and the text around it (the task, when INPUTS_TASK is empty).
export function parseRef(text: string, repo: string): { ref: Ref; rest: string } {
  for (const { kind, re } of FORMS) {
    const m = re.exec(text);
    if (!m) continue;
    const url = REPO_URL.exec(m[0]);
    if (url && `${url[1]}/${url[2]}`.toLowerCase() !== repo.toLowerCase()) {
      throw new Error(`the URL is for ${url[1]}/${url[2]}, not this repository`);
    }
    const n = Number(m[1]);
    if (!Number.isSafeInteger(n) || n < 1) throw new Error(`'${m[1]}' is not a PR or issue number`);
    const rest = (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length))
      .replace(COMMAND_WORDS, "")
      .replace(/^[\s:;,—–-]+/, "")
      .trim()
      .replace(/^(["'])(.*)\1$/s, "$2")
      .trim();
    return { ref: { kind, n }, rest };
  }
  throw new Error(`name the build: a PR number or URL, an issue number or URL, or a deviations.md URL. ${USAGE}`);
}

// The issue a PR belongs to: a changed file under plans/issue-<n>/, else `Closes #<n>` in its body.
export function issueOfPr(files: string[], body: string): number | null {
  for (const f of files) {
    const m = /(?:^|\/)plans\/issue-([0-9]+)\//.exec(f);
    if (m) return Number(m[1]);
  }
  const c = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#([0-9]+)\b/i.exec(body);
  return c ? Number(c[1]) : null;
}

export const followUpCount = (deviations: string | null) => (deviations ?? "").split("\n").filter((l) => /^### F[0-9]+\b/.test(l)).length;

interface Pr {
  number: number;
  url: string;
  state: string; // open | closed | merged
  merged: boolean;
  head: string;
}

function ghJson(args: string[], what: string): any {
  const r = run(["gh", ...args]);
  if (r.code !== 0) fail(`cannot read ${what}: ${(r.err.trim() || r.out.trim()).split("\n")[0]}`);
  try {
    return JSON.parse(r.out || "null");
  } catch {
    return fail(`cannot read ${what}: gh printed no JSON`);
  }
}

function prView(n: number): { pr: Pr; files: string[]; body: string } {
  const v = ghJson(["pr", "view", String(n), "--json", "number,url,state,mergedAt,headRefName,body,files"], `PR #${n}`);
  const merged = !!v?.mergedAt || String(v?.state).toUpperCase() === "MERGED";
  const state = merged ? "merged" : String(v?.state ?? "").toLowerCase();
  const files = Array.isArray(v?.files) ? v.files.map((f: any) => String(f?.path ?? "")) : [];
  return { pr: { number: Number(v?.number), url: String(v?.url ?? ""), state, merged, head: String(v?.headRefName ?? "") }, files, body: String(v?.body ?? "") };
}

// The newest PR from <branch>, an open one first.
function prOfBranch(branch: string): Pr | null {
  const list = ghJson(["pr", "list", "--head", branch, "--state", "all", "--json", "number,url,state,mergedAt,headRefName", "--limit", "20"], `the PRs of ${branch}`);
  if (!Array.isArray(list) || !list.length) return null;
  const p = list.find((x: any) => String(x?.state).toUpperCase() === "OPEN") ?? list[0];
  return prView(Number(p.number)).pr;
}

function reviewComments(pr: number): string {
  const blocks: string[] = [];
  for (const [ep, review] of [[`repos/{owner}/{repo}/pulls/${pr}/comments`, true], [`repos/{owner}/{repo}/issues/${pr}/comments`, false]] as const) {
    const r = api("GET", ep);
    if (r.status !== "ok" || !Array.isArray(r.data)) fail(`cannot read the comments of PR #${pr}: ${r.message}`);
    for (const c of r.data as any[]) {
      const body = String(c?.body ?? "");
      if (body.startsWith("<!-- devflow")) continue;
      const where = review && c?.path ? ` (${c.path}${c.line ? `:${c.line}` : ""})` : "";
      blocks.push(`**@${c?.user?.login ?? "ghost"} ${String(c?.created_at ?? "").slice(0, 10)}${where}:** ${body}`);
    }
  }
  return bound(blocks.join("\n\n"));
}

const onOrigin = (branch: string) => {
  const r = run(["git", "ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`]);
  if (r.code === 0) return true;
  if (r.code === 2) return false;
  return fail(`cannot check branch ${branch} on origin: git ls-remote failed\n${tail(r.err + r.out, 20)}`);
};

// deviations.md on origin/<branch>, or null.
function deviationsOn(branch: string, n: number): string | null {
  if (run(["git", "fetch", "-q", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]).code !== 0) return null;
  return readAt(`refs/remotes/origin/${branch}`, `${mainFolderOf(n)}/deviations.md`);
}

function titleOf(plan: string, n: number): string {
  try {
    return String(parse(plan).fm.title ?? "") || slugOf(n);
  } catch {
    return slugOf(n);
  }
}

function main(): void {
  const plans = plansConfig();
  const mainBranch = input("main_branch");
  const work = input("work", false) || process.env.USER_MESSAGE || "";
  let repo: string;
  let parsed: { ref: Ref; rest: string };
  try {
    repo = repoSlug();
    parsed = parseRef(work, repo);
  } catch (e) {
    return fail((e as Error).message);
  }
  const task = input("task", false).trim() || parsed.rest;
  if (!task) fail(USAGE);

  const where = { plans_ref: plans.ref, plans_dir: plans.dir };
  const empty = { issue: 0, slug: "", ...where, plan_path: "", title: "", branch: "", branch_on_origin: false, pr: null, pr_number: "", pr_open: false, plan_commit: "", deviations_present: false, mode: "", task, fk: "", review_comments: "", doc_errors: [] as string[] };
  const refuse = (refusal: string, issue = 0) => {
    console.log(JSON.stringify({ ...empty, issue, slug: issue ? slugOf(issue) : "", refusal }));
    process.exit(0);
  };

  // 1. PR or issue
  let { kind, n } = parsed.ref;
  if (kind === "either") {
    const r = api("GET", `repos/{owner}/{repo}/issues/${n}`);
    if (r.status === "not_found") refuse(`Issue #${n} not found.`);
    if (r.status !== "ok") fail(`cannot read #${n}: ${r.message}`);
    kind = (r.data as any)?.pull_request ? "pr" : "issue";
  }
  let pr: Pr | null = null;
  let issue = n;
  if (kind === "pr") {
    const v = prView(n);
    pr = v.pr;
    const found = issueOfPr(v.files, v.body);
    if (found === null) fail(`PR #${n} is not a devflow build: it changes no plans/issue-<n>/ file and its body has no "Closes #<n>"`);
    issue = found;
  } else {
    const r = api("GET", `repos/{owner}/{repo}/issues/${issue}`);
    if (r.status === "not_found") refuse(`Issue #${issue} not found.`, issue);
    if (r.status !== "ok") fail(`cannot read issue #${issue}: ${r.message}`);
  }

  // 2. the plan and its branch
  const noBuild = `No build to follow up for issue #${issue}. Run: archon workflow run build-issue-${issue}`;
  const planCommit = fetchPlans(plans.ref);
  const plan = planCommit ? readAt(planCommit, fileOf(plans.dir, issue, "plan")) : null;
  if (plan === null) refuse(noBuild, issue);
  let built: string;
  try {
    built = String(extractManifest(plan!).feature_branch ?? "");
  } catch (e) {
    return fail(`${fileOf(plans.dir, issue, "plan")} on ${plans.ref}: ${(e as Error).message}`);
  }
  if (!built) fail(`${fileOf(plans.dir, issue, "plan")} on ${plans.ref} has no feature_branch`);
  pr ??= prOfBranch(built);
  const builtOnOrigin = onOrigin(built);

  // 3. continue the branch, or start a new one after a merged or closed PR
  let mode: string;
  let branch: string;
  let deviations: string | null;
  if (pr && pr.state !== "open") {
    mode = "new-branch";
    deviations = deviationsOn(mainBranch, issue) ?? (builtOnOrigin ? deviationsOn(built, issue) : null);
    branch = `followup/${slugOf(issue)}-${followUpCount(deviations) + 1}`;
  } else {
    if (!builtOnOrigin) refuse(noBuild, issue);
    mode = "continue-branch";
    branch = built;
    deviations = deviationsOn(built, issue);
  }
  const open = pr?.state === "open";
  const docs = validateDocs({ issue, ref: planCommit, plansDir: plans.dir, kinds: [...DOC_KINDS] });

  console.log(
    JSON.stringify({
      issue,
      slug: slugOf(issue),
      ...where,
      plan_path: fileOf(plans.dir, issue, "plan"),
      title: titleOf(plan!, issue),
      branch,
      branch_on_origin: builtOnOrigin,
      pr: pr ? { number: pr.number, url: pr.url, state: pr.state, merged: pr.merged } : null,
      pr_number: open ? String(pr!.number) : "",
      pr_open: open,
      plan_commit: planCommit,
      deviations_present: deviations !== null,
      mode,
      task,
      fk: String(followUpCount(deviations) + 1),
      review_comments: open ? reviewComments(pr!.number) : "",
      doc_errors: docs.ok ? [] : formatErrors(docs.errors).split("\n").filter((l) => l.trim()),
      refusal: "",
    }),
  );
}

if (isEntry(import.meta)) main();
