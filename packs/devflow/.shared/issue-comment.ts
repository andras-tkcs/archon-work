// The one marked comment per issue: a state block (machine) and a table (people), edited in place.
// Every writer merges its patch into the state and re-renders the whole body.
import { repoSlug } from "./gh.ts";
import { commentMarker, fileOf, PLAN_KINDS, workflowName, type Kind } from "./layout.ts";
import { fail, plansConfig } from "./util.ts";

export type State = Record<string, any>;

export const BUILD_STATES = ["not_started", "building", "pr_open", "merged", "closed", "stopped"] as const;
const STATE_RE = /<!-- devflow-state: (.*) -->/;

const isObj = (v: unknown): v is State => typeof v === "object" && v !== null && !Array.isArray(v);

// Objects merge recursively; arrays and scalars are replaced; a null patch value deletes the key.
export function mergeState(base: State, patch: State): State {
  const out: State = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (isObj(v) && isObj(out[k])) out[k] = mergeState(out[k], v);
    else out[k] = isObj(v) ? mergeState({}, v) : v;
  }
  return out;
}

const planStale = (s: State) => s.design && s.plan && Number(s.plan.design_revision) < Number(s.design.revision);

function buildState(s: State): (typeof BUILD_STATES)[number] {
  const st = s.build?.state ?? "not_started";
  if (!(BUILD_STATES as readonly string[]).includes(st)) fail(`unknown build state '${st}' in the issue comment`);
  return st;
}

// Exactly one line: what the person does next. needs_refine wins over the others.
export function nextLine(n: number, s: State): string {
  if (s.needs_refine) return `Answer the open question with \`devflow-refine #${n}: <answer>\``;
  if (!s.design) return `Run \`devflow-refine #${n}\``;
  if (!s.plan || planStale(s)) return `Review \`design.md\`, then run \`devflow-plan #${n}\``;
  switch (buildState(s)) {
    case "building":
      return `Build running (run ${s.build.run})`;
    case "pr_open":
      if (s.build.ci_local === "red") return `Local CI is red: run \`devflow-follow-up #${s.build.pr?.number} "fix local CI: ${s.build.ci_failed_job || "<job>"}"\``;
      return `Read deviations.md, then review and merge PR #${s.build.pr?.number} (or run \`devflow-follow-up #${s.build.pr?.number} "<task>"\`)`;
    case "stopped":
      return `Read deviations.md, then run \`devflow-follow-up #${n} "<task>"\``;
    case "merged":
    case "closed":
      return "Done.";
    default:
      return `Review the plan, then run \`archon workflow sync\` and \`archon workflow run ${workflowName(n)} --detach\``;
  }
}

// Pure and deterministic: the same (n, state) gives the same body. The time and run of the last
// write are part of the state (updated_at, updated_by), set by upsertComment.
export function renderComment(n: number, s: State): string {
  const blob = (kind: Kind) => `https://github.com/${s.repo}/blob/${s.plans.ref}/${fileOf(s.plans.dir, n, kind)}`;
  const link = (kind: Kind) => `[${kind}.md](${blob(kind)})`;
  // `<` and `>` are escaped so that the JSON can never close the HTML comment.
  const json = JSON.stringify(s).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  const rows = ["| Step | State | Revision | Files |", "|---|---|---|---|"];
  rows.push(s.design ? `| Design | ready | r${s.design.revision} | ${link("design")} |` : "| Design | not started | — | — |");
  if (s.plan) {
    const stale = planStale(s) ? ` · **stale: built from design r${s.plan.design_revision}**` : "";
    const links = PLAN_KINDS.map(link).join(" · ");
    rows.push(`| Plan | ready${stale} | r${s.plan.revision} | ${links} |`);
  } else rows.push("| Plan | not started | — | — |");
  const pr = s.build?.pr;
  const prLink = pr ? ` · [PR #${pr.number}](${pr.url})` : "";
  const text = {
    not_started: "not started",
    building: `building (run ${s.build?.run})`,
    pr_open: `PR #${pr?.number} open`,
    merged: "merged",
    closed: "closed without merge",
    stopped: "**stopped**",
  }[buildState(s)];
  const ci = s.build?.ci_local === "red" ? " · local CI red" : "";
  const dev = s.build?.deviations_url ? ` · [deviations.md](${s.build.deviations_url})` : "";
  rows.push(`| Build | ${text}${ci} | — | \`${workflowName(n)}\`${prLink}${dev} |`);

  const out = [commentMarker(n), `<!-- devflow-state: ${json} -->`, `### devflow · issue #${n}`, "", ...rows, "", `**Next:** ${nextLine(n, s)}`, ""];
  const rulings: string[] = s.proposed_rulings ?? [];
  if (rulings.length) {
    out.push("**Proposed rulings** (copy the ones you agree with into `.archon/devflow/policy/rulings.md`):", "", ...rulings, "");
  }
  if (s.needs_refine) out.push(`**Open question for refine:** ${s.needs_refine.question} Why: ${s.needs_refine.why} (run ${s.needs_refine.run})`, "");
  out.push(`_Updated ${s.updated_at} by run ${s.updated_by}._`);
  return out.join("\n") + "\n";
}

function gh(args: string[], stdin?: string) {
  const p = Bun.spawnSync(["gh", ...args], { stdin: stdin === undefined ? undefined : new TextEncoder().encode(stdin), stdout: "pipe", stderr: "pipe", env: process.env });
  return { code: p.exitCode ?? 1, out: p.stdout.toString(), err: p.stderr.toString() };
}

interface Comment {
  id: number;
  body: string;
  html_url: string;
}

function markedComments(n: number, die: (msg: string) => never): Comment[] {
  const r = gh(["api", "--paginate", `repos/{owner}/{repo}/issues/${n}/comments`, "--jq", ".[] | {id, body, html_url}"]);
  if (r.code !== 0) die(`cannot list the comments of issue #${n}: ${r.err.trim().split("\n")[0]}`);
  const all = r.out.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Comment);
  return all.filter((c) => typeof c.body === "string" && c.body.startsWith(commentMarker(n)));
}

function stateOf(c: Comment | undefined): State | null {
  const m = c?.body.match(STATE_RE);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

// Merges `patch` into the issue's state and writes the comment: created once, edited afterwards.
// The repository and the plans location default to this checkout's; the state keeps the first values.
// `pushed` names a commit the caller already pushed, so every failure message says nothing was lost.
export function upsertComment(n: number, patch: State, pushed = ""): { url: string; id: number; state: State } {
  const die = (msg: string): never => fail(pushed ? `${msg}\nThe files are already pushed in commit ${pushed}.` : msg);
  const found = markedComments(n, die);
  const defaults: State = { repo: "", plans: plansConfig() };
  try {
    defaults.repo = repoSlug();
  } catch (e) {
    die((e as Error).message);
  }
  const stamp = { updated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"), updated_by: process.env.WORKFLOW_ID || "run" };
  const prior = found[0] ? stateOf(found[0]) : {};
  // A hand-edited comment whose state no longer parses: rewriting it would drop the design and plan rows.
  if (prior === null) die(`the devflow comment on issue #${n} has no readable state; restore its devflow-state line or delete the comment: ${found[0].html_url}`);
  const state = mergeState(mergeState(mergeState(defaults, prior), patch), stamp);
  const payload = JSON.stringify({ body: renderComment(n, state) });
  const w = found[0]
    ? gh(["api", "--method", "PATCH", `repos/{owner}/{repo}/issues/comments/${found[0].id}`, "--input", "-"], payload)
    : gh(["api", "--method", "POST", `repos/{owner}/{repo}/issues/${n}/comments`, "--input", "-"], payload);
  if (w.code !== 0) die(`the issue comment was not written: ${w.err.trim().split("\n")[0]}`);
  const back = markedComments(n, die);
  const parsed = stateOf(back[0]);
  if (!back[0] || !parsed) die("the issue comment was not written: the marker or the state is missing on read-back");
  if (back.length > 1) die(`more than one devflow comment on issue #${n}; updated the first, remove the duplicate: ${back[1].html_url}`);
  return { url: back[0].html_url, id: back[0].id, state: parsed };
}
