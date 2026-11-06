// Writes plans/issue-<n>/deviations.md in the build's checkout, deterministically, from the blocks'
// outcomes (an agent only supplies the text of each decision). Modes:
//   build      the whole file from the phase, merge and before outcomes (mod-devflow-wrap, stage first)
//   final      the PR's facts: where=tail (the PR opened) or where=wrap (deliver opened none)
//   follow-up  appends one ### F<k> entry under ## Follow-ups and leaves every earlier byte as it was
// The stub that mod-devflow-start commits is renderStub(). Every file written passes validate-docs; when
// it would not, a minimal form is written instead, so the file is never absent or invalid.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AFTER_POINTER, defuseQuoted, NONE, OUTCOME_RE, TABLE_HEAD, TABLE_SEP } from "./doc-schema.ts";
import { parse, serialize, type FrontMatter } from "./frontmatter.ts";
import { repoSlug } from "./gh.ts";
import { fileOf, mainFolderOf, slugOf } from "./layout.ts";
import { readOutcomes, readOwnOutcome, writeOutcome } from "./outcomes.ts";
import { render } from "./render-template.ts";
import { extractManifest, type Manifest } from "./render-run.ts";
import { artifactsDir, fact, input, isEntry, run } from "./util.ts";
import { validateDocs } from "./validate-docs.ts";

export interface Ident {
  issue: number;
  title: string;
  branch: string;
  planRevision: number;
  run: string;
}

export interface Decision {
  kind?: string;
  title?: string;
  choice?: string;
  why?: string;
  alternatives?: string;
  planned?: string;
  phase?: string;
}

export const deviationsPath = (n: number) => `${mainFolderOf(n)}/deviations.md`;
const today = () => new Date().toISOString().slice(0, 10);
// Agent text on one line, with nothing a validator rule would trip on.
const clean = (s: unknown) => defuseQuoted(String(s ?? "").replace(/\s+/g, " ").trim()) || "—";
const cell = (s: unknown) => clean(s).replaceAll("|", "/");

function frontMatter(id: Ident, revision: number, outcome: string): FrontMatter {
  return {
    issue: id.issue,
    kind: "deviations",
    title: id.title,
    revision,
    plan_revision: id.planRevision,
    build_outcome: outcome,
    branch: id.branch,
    run: id.run,
    updated: today(),
  };
}

interface Body {
  outcome: string;
  done: number;
  stuck: number;
  skipped: number;
  pr: string;
  rows: string[];
  deviations: Decision[];
  decisions: Decision[];
  tests: string;
  before: string;
  review: string;
  followups: string;
}

function renderBody(id: Ident, b: Body): string {
  return render("deviations", {
    title: id.title,
    outcome: b.outcome,
    done: String(b.done),
    stuck: String(b.stuck),
    skipped: String(b.skipped),
    branch: id.branch,
    pr: b.pr,
    run_link: `run ${id.run}`,
    table: b.rows.length ? [TABLE_HEAD, TABLE_SEP, ...b.rows].join("\n") : NONE,
    deviations: b.deviations.map((d) => ({ title: clean(d.title), phase: clean(d.phase), planned: clean(d.planned ?? d.alternatives), actual: clean(d.choice), why: clean(d.why) })),
    decisions: b.decisions.map((d) => ({ title: clean(d.title), phase: clean(d.phase), choice: clean(d.choice), alternatives: clean(d.alternatives), why: clean(d.why) })),
    tests: b.tests,
    before: b.before,
    review: b.review,
    followups: b.followups,
  });
}

const emptyBody = (): Body => ({
  outcome: "running",
  done: 0,
  stuck: 0,
  skipped: 0,
  pr: "not opened yet",
  rows: [],
  deviations: [],
  decisions: [],
  tests: "No phase has run yet.",
  before: NONE,
  review: NONE,
  followups: NONE,
});

// The file mod-devflow-start commits before any phase runs: build_outcome running, nothing done yet.
export function renderStub(id: Ident): string {
  return serialize(frontMatter(id, 1, "running"), renderBody(id, emptyBody()));
}

function check(n: number, dir: string): string[] {
  const r = validateDocs({ issue: n, dir, kinds: ["deviations"] });
  return r.errors.map((e) => `[${e.rule}] ${e.message}`);
}

// Writes <text>; when it does not validate, writes the minimal form (Outcome and table kept), first
// with a V1 entry naming the errors, then without. Returns the problems that forced a fallback.
function writeChecked(n: number, text: string, minimal: () => { id: Ident; body: Body; revision: number }): string[] {
  const file = deviationsPath(n);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  const errs = check(n, dirname(file));
  if (errs.length === 0) return [];
  const m = minimal();
  const base: Body = { ...emptyBody(), outcome: m.body.outcome, done: m.body.done, stuck: m.body.stuck, skipped: m.body.skipped, pr: m.body.pr, rows: m.body.rows, tests: "See the run's outcomes; this file was regenerated in minimal form." };
  const note: Decision = { title: "deviations.md was regenerated in minimal form", choice: "minimal form", planned: "the full file", why: errs.slice(0, 3).join("; ") };
  for (const body of [{ ...base, deviations: [{ ...note, phase: "wrap" }] }, base]) {
    try {
      writeFileSync(file, serialize(frontMatter(m.id, m.revision, m.body.outcome), renderBody(m.id, body)));
      if (check(n, dirname(file)).length === 0) return errs;
    } catch {}
  }
  return errs;
}

// ---- build mode ---------------------------------------------------------------------------------

export interface PhaseRow {
  id: string;
  state: "done" | "stuck" | "failed" | "skipped" | "conflict";
  reason: string;
  partial: string;
}

const merged = (slug: string, id: string) =>
  run(["git", "log", "HEAD", "--format=%H", "--fixed-strings", `--grep=Plan-Phase: ${slug}/${id}`]).out.trim() !== "";

// Each manifest phase's state, in manifest order. A phase with no outcome whose dependencies are all
// done crashed before it reported (failed); one with an unfinished dependency was skipped.
export function classify(m: Manifest, outcomes: Record<string, any>, branch: string, isMerged = (id: string) => merged(m.plan_slug ?? "", id)): PhaseRow[] {
  const rows = new Map<string, PhaseRow>();
  for (const p of m.phases) {
    const o = outcomes[p.id];
    const conflict = outcomes[`merge-${p.id}`];
    const partial = (head: unknown) => (head ? `${branch}-partial-${p.id}` : "—");
    let row: PhaseRow;
    if (!o) {
      const notDone = (p.depends_on ?? []).find((d) => rows.get(d)?.state !== "done");
      row = notDone
        ? { id: p.id, state: "skipped", reason: `dependency ${notDone} is ${rows.get(notDone)?.state ?? "missing"}`, partial: "—" }
        : { id: p.id, state: "failed", reason: "the phase block stopped before it reported", partial: "—" };
    } else if (o.status === "done" && conflict?.status === "conflict") {
      row = { id: p.id, state: "conflict", reason: `merging it conflicts: ${clean(conflict.detail).slice(0, 200)}`, partial: partial(conflict.head) };
    } else if (o.status === "done" && !isMerged(p.id)) {
      row = { id: p.id, state: "failed", reason: "done, but its merge commit is not on the branch", partial: partial(o.head) };
    } else if (o.status === "done") {
      row = { id: p.id, state: "done", reason: "", partial: "—" };
    } else {
      const state = o.status === "stuck" || o.status === "skipped" ? o.status : "failed";
      row = { id: p.id, state, reason: clean(o.stuck_reason || o.detail || "no reason given"), partial: partial(o.partial_head) };
    }
    rows.set(p.id, row);
  }
  return [...rows.values()];
}

function planAt(commit: string, plansDir: string, n: number): { manifest: Manifest; fm: FrontMatter; text: string; tests: string | null } {
  const shown = run(["git", "show", `${commit}:${fileOf(plansDir, n, "plan")}`]);
  if (shown.code !== 0) throw new Error(`cannot read plan.md at ${commit}: ${shown.err.trim()}`);
  const tests = run(["git", "show", `${commit}:${fileOf(plansDir, n, "plan-test")}`]);
  return { manifest: extractManifest(shown.out), fm: parse(shown.out).fm, text: shown.out, tests: tests.code === 0 ? tests.out : null };
}

function testsText(m: Manifest, outcomes: Record<string, any>, planTest: string | null): string {
  const ids = planTest ? [...planTest.matchAll(/^### (T\d+)\. /gm)].map((x) => x[1]) : [];
  const passing = new Set<string>();
  const lines = m.phases.map((p) => {
    const cases: Array<{ id?: string; result?: string }> = outcomes[p.id]?.cases ?? [];
    for (const c of cases) if (c.result === "pass" && c.id) passing.add(c.id);
    const text = cases.filter((c) => c.id).map((c) => `${clean(c.id)} ${clean(c.result ?? "not_run")}`).join(", ");
    return `- ${p.id}: ${text || "none"}`;
  });
  const open = ids.filter((t) => !passing.has(t));
  return `${lines.join("\n")}\n\nCases of plan-test.md with no passing result: ${open.length ? open.join(", ") : "none"}`;
}

function beforeText(m: Manifest, outcome: any): string {
  const listed = m.manual_before ?? [];
  if (listed.length === 0) return NONE;
  const items: Array<{ n?: number; title?: string; status?: string; evidence?: string }> = outcome?.items ?? [];
  if (items.length === 0) return listed.map((it, k) => `- ${k + 1}. ${clean(it.title ?? it.id)}: unknown — the check did not run`).join("\n");
  return items.map((it, k) => `- ${it.n ?? k + 1}. ${clean(it.title)}: ${["met", "unmet", "unknown"].includes(String(it.status)) ? it.status : "unknown"} — ${clean(it.evidence)}`).join("\n");
}

function existingRevision(n: number): number {
  const file = deviationsPath(n);
  if (!existsSync(file)) return 0;
  try {
    return Number(parse(readFileSync(file, "utf8")).fm.revision) || 0;
  } catch {
    return 0;
  }
}

export interface BuildOpts {
  issue: number;
  branch: string;
  plansDir: string;
  planCommit: string;
  runKey: string;
  run: string;
}

export function writeBuild(o: BuildOpts) {
  const plan = planAt(o.planCommit, o.plansDir, o.issue);
  const outcomes = readOutcomes(o.runKey);
  const rows = classify(plan.manifest, outcomes, o.branch);
  const id: Ident = { issue: o.issue, title: String(plan.fm.title ?? slugOf(o.issue)), branch: o.branch, planRevision: Number(plan.fm.revision), run: o.run };
  const notDone = rows.filter((r) => r.state !== "done");
  const complete = notDone.length === 0;
  const decisions: Decision[] = [];
  const deviations: Decision[] = [];
  for (const p of plan.manifest.phases) {
    for (const d of (outcomes[p.id]?.decisions ?? []) as Decision[]) (d.kind === "deviation" ? deviations : decisions).push({ ...d, phase: p.id });
  }
  const sd = outcomes["stage-deviation"];
  if (sd) deviations.push({ title: sd.title, planned: "only the issue's documents are committed", choice: sd.detail, why: sd.why ?? "worktree paths must never reach the branch", phase: "wrap" });
  const body: Body = {
    ...emptyBody(),
    outcome: complete ? "running" : "stopped",
    done: rows.length - notDone.length,
    stuck: notDone.filter((r) => r.state !== "skipped").length,
    skipped: notDone.filter((r) => r.state === "skipped").length,
    pr: complete ? "not opened yet" : "no PR (stopped)",
    rows: notDone.map((r) => `| ${r.id} | ${r.state} | ${cell(r.reason)} | ${cell(r.partial)} |`),
    deviations,
    decisions,
    tests: testsText(plan.manifest, outcomes, plan.tests),
    before: beforeText(plan.manifest, outcomes.before),
  };
  const revision = existingRevision(o.issue) + 1;
  let text = "";
  try {
    text = serialize(frontMatter(id, revision, body.outcome), renderBody(id, body));
  } catch (e) {
    text = `render failed: ${(e as Error).message}\n`;
  }
  const problems = writeChecked(o.issue, text, () => ({ id, body, revision }));
  return { complete, stuck_phases: notDone.map((r) => r.id), problems };
}

// ---- section edits on an existing file (final and follow-up modes) --------------------------------

// The body lines of `## <title>` (up to the next H2), and where they are.
function sectionRange(lines: string[], title: string): [number, number] {
  const start = lines.indexOf(`## ${title}`);
  if (start < 0) throw new Error(`deviations.md has no '## ${title}'`);
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end++;
  return [start + 1, end];
}

export function setSection(body: string, title: string, content: string): string {
  const lines = body.split("\n");
  const [a, b] = sectionRange(lines, title);
  const tailBlank = b < lines.length ? [""] : [];
  lines.splice(a, b - a, ...content.split("\n"), ...tailBlank);
  return lines.join("\n").replace(/\n*$/, "\n");
}

export function sectionText(body: string, title: string): string {
  const lines = body.split("\n");
  const [a, b] = sectionRange(lines, title);
  return lines.slice(a, b).join("\n").trim();
}

// Appends `### <prefix><n>.` blocks to a section, numbered on from the blocks it already has.
export function appendBlocks(body: string, title: string, prefix: string, blocks: string[][]): string {
  if (blocks.length === 0) return body;
  const current = sectionText(body, title);
  const have = current === NONE ? 0 : [...current.matchAll(new RegExp(`^### ${prefix}\\d+\\. `, "gm"))].length;
  const added = blocks.map((b, k) => b[0].replace(/^/, `### ${prefix}${have + k + 1}. `) + "\n" + b.slice(1).join("\n")).join("\n\n");
  return setSection(body, title, current === NONE ? added : `${current}\n\n${added}`);
}

function readFile(n: number): { fm: FrontMatter; body: string } {
  return parse(readFileSync(deviationsPath(n), "utf8"));
}

function identOf(fm: FrontMatter): Ident {
  return { issue: Number(fm.issue), title: String(fm.title), branch: String(fm.branch), planRevision: Number(fm.plan_revision), run: String(fm.run) };
}

function minimalFrom(fm: FrontMatter, body: string): { id: Ident; body: Body; revision: number } {
  const line = sectionText(body, "Outcome");
  const m = OUTCOME_RE.exec(line);
  const table = sectionText(body, "Stuck and skipped phases");
  return {
    id: identOf(fm),
    revision: Number(fm.revision) || 1,
    body: {
      ...emptyBody(),
      outcome: m?.[1] ?? String(fm.build_outcome),
      done: Number(m?.[2] ?? 0),
      stuck: Number(m?.[3] ?? 0),
      skipped: Number(m?.[4] ?? 0),
      pr: /PR: (.+?)\. Run: /.exec(line)?.[1] ?? "no PR (stopped)",
      rows: table === NONE ? [] : table.split("\n").slice(2),
    },
  };
}

function withOutcome(body: string, outcome: string, pr: string): string {
  const line = sectionText(body, "Outcome").replace(/^(running|completed|stopped) — /, `${outcome} — `).replace(/PR: .+?\. Run: /, `PR: ${pr}. Run: `);
  return setSection(body, "Outcome", line);
}

const readJson = (file: string): any => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

// The local-CI result in one line per job, for Review and CI and the PR body.
export function ciLines(ci: any, fixes: any[]): string[] {
  if (!ci) return ["- Local CI: not run."];
  const jobs = (ci.ran ?? []).map((j: any) => `${clean(j.workflow)}/${clean(j.job)} ${j.status}${j.reason ? ` (${clean(j.reason)})` : ""}`);
  const out = [`- Local CI: ${ci.status}; fix rounds used: ${fixes.length}.`];
  if (jobs.length) out.push(`- Local CI jobs: ${jobs.join(", ")}.`);
  if (ci.reason) out.push(`- Local CI note: ${clean(ci.reason)}.`);
  return out;
}

// The tail's facts after open-pr: the review, the definition of done, local CI and the PR.
function reviewFromTail(art: string, prUrl: string): { text: string; fixes: Decision[]; ciRed: boolean } {
  const review = existsSync(join(art, "review.md")) ? readFileSync(join(art, "review.md"), "utf8") : "";
  const verdict = /REVIEW-REPORT verdict=(\w+)/.exec(review)?.[1] ?? "unknown";
  const rounds = readdirSync(art).filter((f) => /^review(-[0-9a-f]+)?\.md$/.test(f)).length;
  const nb = existsSync(join(art, "non-blocking.md")) ? readFileSync(join(art, "non-blocking.md"), "utf8") : "";
  const fixed = (nb.match(/\|\s*fixed\s*\|/gi) ?? []).length;
  const declined = (nb.match(/\|\s*declined\s*\|/gi) ?? []).length;
  const dod = readOwnOutcome("dod");
  const ci = readOwnOutcome("ci-local");
  const outDir = join(art, "outcomes");
  const fixes = (existsSync(outDir) ? readdirSync(outDir) : []).filter((f) => /^ci-fix-\d+\.json$/.test(f)).sort().map((f) => readJson(join(outDir, f))).filter(Boolean);
  const lines = [
    `- Review: verdict ${verdict} after ${Math.max(rounds, 1)} round(s); no blocking finding is left.`,
    `- Non-blocking findings: ${fixed} fixed, ${declined} declined (non-blocking.md of run ${process.env.WORKFLOW_ID || "run"}).`,
    `- Definition of done: ${dod ? (dod.green ? "green" : "red") : "not recorded"}${dod?.unavailable?.length ? `; not runnable here: ${dod.unavailable.map(clean).join(", ")}` : ""}.`,
    ...ciLines(ci, fixes),
    `- PR: ${prUrl}${ci?.status === "red" ? " (draft: local CI is red)" : ""}.`,
  ];
  const decisions = fixes.flatMap((f: any) => (f.decisions ?? []).map((d: Decision) => ({ ...d, phase: "ci-fix" })));
  return { text: lines.join("\n"), fixes: decisions, ciRed: ci?.status === "red" };
}

const decisionBlock = (d: Decision) => [clean(d.title), `- Phase: ${clean(d.phase)}`, `- Choice: ${clean(d.choice)}`, `- Alternatives: ${clean(d.alternatives)}`, `- Why: ${clean(d.why)}`];

export function writeFinalTail(n: number, prUrl: string) {
  // A build rendered before deviations.md existed delivers through the same tail: nothing to patch.
  if (!existsSync(deviationsPath(n))) return { complete: true, changed: false, problems: [] as string[] };
  const { fm, body } = readFile(n);
  const r = reviewFromTail(artifactsDir(), prUrl);
  let next = withOutcome(body, "completed", prUrl);
  next = setSection(next, "Review and CI", r.text);
  next = appendBlocks(next, "Decisions taken", "K", r.fixes.map(decisionBlock));
  const nfm = { ...fm, build_outcome: "completed", updated: today() };
  const problems = writeChecked(n, serialize(nfm, next), () => {
    const m = minimalFrom(nfm, body);
    return { ...m, body: { ...m.body, outcome: "completed", pr: prUrl } };
  });
  return { complete: true, changed: true, problems };
}

// After deliver: when it ran (every phase done, the push went through, no PR yet) but opened no PR,
// the build is stopped. A PR it opened, or a PR a follow-up continues, leaves the file as it is.
export function writeFinalWrap(n: number, runKey: string, prNumber: string) {
  const o = runKey ? readOutcomes(runKey) : {};
  const delivered = o.deviations?.complete === true && o.push?.ok === true && prNumber === "";
  if (!delivered || o.pr) return { complete: !!o.pr || prNumber !== "", changed: false, problems: [] as string[] };
  const { fm, body } = readFile(n);
  let next = withOutcome(body, "stopped", "no PR (stopped)");
  next = setSection(next, "Review and CI", `Deliver ran but opened no PR; see run ${process.env.WORKFLOW_ID || "run"}.`);
  const nfm = { ...fm, build_outcome: "stopped", updated: today() };
  const problems = writeChecked(n, serialize(nfm, next), () => {
    const m = minimalFrom(nfm, body);
    return { ...m, body: { ...m.body, outcome: "stopped", pr: "no PR (stopped)" } };
  });
  return { complete: false, changed: true, problems };
}

// ---- follow-up mode -----------------------------------------------------------------------------

export function followUpEntry(k: number, task: string, outcome: any, runId: string, date = today()): string {
  const status = outcome?.status === "done" ? "done" : "stuck";
  const lines = [`### F${k} (${date}, run ${runId}): ${clean(task)} → ${status}`];
  lines.push(status === "done" ? `- Summary: ${clean(outcome?.summary)}` : `- Stuck: ${clean(outcome?.stuck_reason || "the follow-up did not finish")}`);
  for (const d of (outcome?.decisions ?? []) as Decision[]) {
    lines.push(d.kind === "deviation" ? `- Deviation: ${clean(d.title)}. Done: ${clean(d.choice)}. Why: ${clean(d.why)}.` : `- Decision: ${clean(d.title)}. Choice: ${clean(d.choice)}. Why: ${clean(d.why)}.`);
  }
  return lines.join("\n");
}

export interface FollowUpOpts {
  issue: number;
  branch: string;
  mainBranch: string;
  plansDir: string;
  planCommit: string;
  runKey: string;
  run: string;
  task: string;
  fk: number;
}

export function writeFollowUp(o: FollowUpOpts) {
  const file = deviationsPath(o.issue);
  if (!existsSync(file)) {
    const onMain = run(["git", "show", `origin/${o.mainBranch}:${file}`]);
    mkdirSync(dirname(file), { recursive: true });
    if (onMain.code === 0) writeFileSync(file, onMain.out);
    else {
      const plan = planAt(o.planCommit, o.plansDir, o.issue);
      writeFileSync(file, renderStub({ issue: o.issue, title: String(plan.fm.title), branch: o.branch, planRevision: Number(plan.fm.revision), run: o.run }));
    }
  }
  const text = readFileSync(file, "utf8");
  const { fm, body } = parse(text);
  const outcome = readOutcomes(o.runKey)[`f${o.fk}`] ?? null;
  const entry = followUpEntry(o.fk, o.task, outcome, o.run);
  const current = sectionText(body, "Follow-ups");
  const done = outcome?.status === "done";
  const nfm = { ...fm, revision: (Number(fm.revision) || 0) + 1, build_outcome: done ? fm.build_outcome : "stopped", branch: o.branch, run: o.run, updated: today() };
  // Earlier text stays byte-identical: the entry goes at the end, replacing only a lone None.
  const nextBody = current === NONE ? setSection(body, "Follow-ups", entry) : `${body.replace(/\n*$/, "")}\n\n${entry}\n`;
  const problems = writeChecked(o.issue, serialize(nfm, nextBody), () => minimalFrom(nfm, body));
  return { complete: done, stuck_phases: done ? [] : [`f${o.fk}`], problems };
}

// ---- CLI ----------------------------------------------------------------------------------------

if (isEntry(import.meta)) {
  const mode = input("mode");
  const where = fact("where");
  const issueText = fact("issue");
  const branch = fact("branch");
  const runKey = fact("run_key");
  const runId = process.env.WORKFLOW_ID || "run";
  // Work without an issue (devflow-quick and the other tail includers) has no deviations.md.
  if (issueText === "") {
    console.log(JSON.stringify({ complete: false, changed: false, stuck_phases: [], deviations_url: "", problems: [], skipped: true }));
    process.exit(0);
  }
  const n = Number(issueText);
  let result: { complete: boolean; changed?: boolean; stuck_phases?: string[]; problems: string[] };
  try {
    if (!Number.isInteger(n) || n < 1) throw new Error(`issue '${issueText}' is not an issue number`);
    if (mode === "build") result = writeBuild({ issue: n, branch, plansDir: fact("plans_dir") || "plans", planCommit: fact("plan_commit"), runKey, run: runId });
    else if (mode === "follow-up") {
      result = writeFollowUp({ issue: n, branch, mainBranch: fact("main_branch") || "main", plansDir: fact("plans_dir") || "plans", planCommit: fact("plan_commit"), runKey, run: runId, task: fact("task"), fk: Number(fact("fk")) || 1 });
    } else if (mode === "final" && where === "tail") result = writeFinalTail(n, fact("pr_url"));
    else if (mode === "final") result = writeFinalWrap(n, runKey, fact("pr_number"));
    else throw new Error(`mode must be build, follow-up or final, not '${mode}'`);
  } catch (e) {
    // The file must exist whatever failed: keep what is there, else write the stub.
    const file = deviationsPath(n);
    if (mode !== "final" && Number.isInteger(n) && n > 0 && !existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, renderStub({ issue: n, title: slugOf(n), branch: branch || "unknown", planRevision: 1, run: runId }));
    }
    result = { complete: false, changed: true, stuck_phases: [], problems: [(e as Error).message] };
  }
  if (result.problems.length) console.error(`devflow: deviations.md: ${result.problems.join("; ")}`);
  let url = "";
  try {
    url = `https://github.com/${repoSlug()}/blob/${branch}/${deviationsPath(n)}`;
  } catch {}
  const out = { complete: result.complete, changed: result.changed ?? true, stuck_phases: result.stuck_phases ?? [], deviations_url: url, problems: result.problems, skipped: false };
  // wrap's final pass only patches the file; the tail's pass (the PR is open) is the build's last word.
  if (mode !== "final" || where === "tail") writeOutcome("deviations", out, runKey);
  console.log(JSON.stringify(out));
}
