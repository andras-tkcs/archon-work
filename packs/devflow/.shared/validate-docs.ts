// The one structure check of the issue-folder documents (no AI, no network). The step that writes a
// file and the step that reads it run this same check, so a reader never rejects what a writer published.
//
//   bun validate-docs.ts --issue <n> (--dir <folder> | --ref <commit-or-branch> [--plans-dir <dir>])
//       [--kinds design,plan,plan-test,before,after | all] [--with-design] [--warn]
//
// Prints one JSON line { ok, checked, errors: [{ file, line, rule, message }], warnings } and exits 1
// when there are errors, unless --warn. Every error is listed, never only the first.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACCEPTANCE_RE,
  DESIGN_ASSUMPTION_RE,
  DESIGN_LINE,
  DOC_KINDS,
  LEFTOVER_RE,
  LINK_RE,
  LEVELS,
  LINK_TARGETS,
  NONE,
  NO_MANUAL_STEPS,
  PLAN_LINE,
  RELATED_RE,
  REVISION_RE,
  RULING_RE,
  SCHEMA,
  SOURCE_FORMS,
  WARNING_LINE,
  type DocKind,
} from "./doc-schema.ts";
import { parse as parseFrontMatter, validate as validateFrontMatter, type FrontMatter } from "./frontmatter.ts";
import { fileOf, slugOf, workflowFile } from "./layout.ts";
import { extractManifest, type Manifest } from "./render-run.ts";
import { PROFILE_PATH, run } from "./util.ts";

export interface DocError {
  file: string;
  line: number;
  rule: string;
  message: string;
}

export interface Result {
  ok: boolean;
  checked: string[];
  errors: DocError[];
  warnings: string[];
}

export interface Options {
  issue: number;
  dir?: string; // a folder holding <kind>.md files
  ref?: string; // a commit or branch of the plans branch
  plansDir?: string; // with ref: the plans_dir (default plans)
  kinds: DocKind[];
  withDesign?: boolean; // also read design.md for the cross-file rules (its own rules are not run)
}

interface Line {
  no: number; // 1-based line number in the file
  text: string;
  fence: boolean; // inside a fenced code block (or a fence line)
}

interface Section {
  title: string;
  line: number;
  lines: Line[]; // the lines between this H2 and the next
}

interface Doc {
  kind: DocKind;
  file: string;
  fm: FrontMatter;
  lines: Line[]; // the body
  sections: Section[];
  manifest?: Manifest;
  manifestLine?: number;
  items?: number; // before/after: number of items
  acceptance?: { id: string; line: number }[];
  decisions?: string[];
  cases?: { id: string; line: number; covers: string[]; phase: string }[];
}

const KIND_RULE: Record<DocKind, string> = { design: "DESIGN", plan: "PLAN", "plan-test": "PLAN-TEST", before: "BEFORE", after: "AFTER" };
const nonBlank = (ls: Line[]) => ls.filter((l) => l.text.trim() !== "");
const isContinuation = (l: Line) => /^\s+\S/.test(l.text);

export function validateDocs(opts: Options): Result {
  const errors: DocError[] = [];
  const warnings: string[] = [];
  const checked: string[] = [];
  const add = (file: string, line: number, rule: string, message: string) => errors.push({ file, line, rule, message });
  const plansDir = opts.plansDir || "plans";
  const pathOf = (kind: DocKind) => (opts.ref !== undefined ? fileOf(plansDir, opts.issue, kind) : join(opts.dir ?? ".", `${kind}.md`));
  const read = (path: string): string | null => {
    if (opts.ref !== undefined) {
      const r = run(["git", "show", `${opts.ref}:${path}`]);
      return r.code === 0 ? r.out : null;
    }
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  };

  const own = [...new Set(opts.kinds)];
  const load = [...own];
  if (opts.withDesign && !load.includes("design")) load.unshift("design");
  const cross = own.length > 1 || !!opts.withDesign;
  const docs = new Map<DocKind, Doc>();

  for (const kind of load) {
    const file = pathOf(kind);
    const text = read(file);
    if (text === null) {
      add(file, 1, "V1", `${kind}.md is missing`);
      continue;
    }
    if (own.includes(kind)) checked.push(file);
    const doc = parseDoc(kind, file, text, own.includes(kind) ? add : () => {});
    if (!doc) continue;
    docs.set(kind, doc);
    if (!own.includes(kind)) continue;
    if (!cross && doc.fm.issue !== opts.issue) add(file, 1, "V1", `front matter issue ${doc.fm.issue} is not issue ${opts.issue}`);
    checkKind(doc, opts.issue, add, warnings);
  }

  if (cross) crossRules(docs, opts, plansDir, add, read);
  return { ok: errors.length === 0, checked, errors, warnings };
}

type Add = (file: string, line: number, rule: string, message: string) => void;

// Rules V1–V7 for any file; returns the parsed document, or null when its front matter is unreadable.
function parseDoc(kind: DocKind, file: string, text: string, add: Add): Doc | null {
  const cr = text.indexOf("\r");
  if (cr >= 0) add(file, text.slice(0, cr).split("\n").length, "V6", "the file has CR line endings; use LF only");
  if (!text.endsWith("\n")) add(file, text.split("\n").length, "V6", "the file does not end with a newline");

  let fm: FrontMatter;
  let body: string;
  try {
    ({ fm, body } = parseFrontMatter(text));
  } catch (e) {
    add(file, 1, "V1", (e as Error).message);
    return null;
  }
  for (const m of validateFrontMatter(fm, kind)) add(file, 1, "V1", m);

  const offset = text.slice(0, text.length - body.length).split("\n").length;
  let fence = false;
  const lines: Line[] = body.split("\n").map((t, i) => {
    const isFence = t.startsWith("```");
    if (isFence) fence = !fence;
    return { no: offset + i, text: t.replace(/\r$/, ""), fence: fence || isFence };
  });
  if (lines.length && lines[lines.length - 1].text === "") lines.pop();

  for (const l of lines) {
    const m = LEFTOVER_RE.exec(l.text);
    if (m) add(file, l.no, "V2", `leftover '${m[0]}' from the template or a draft`);
  }

  const schema = SCHEMA[kind];
  const h1s = lines.filter((l) => !l.fence && /^# /.test(l.text));
  const first = lines[0];
  if (!first || !first.text.startsWith("# ")) add(file, first?.no ?? offset, "V3", "the first line after the front matter must be the H1");
  else if (!first.text.startsWith(`# ${schema.h1}`) || first.text.slice(2 + schema.h1.length).trim() === "") {
    add(file, first.no, "V3", `the H1 must be '# ${schema.h1}<title>'`);
  }
  for (const h of h1s.slice(1)) add(file, h.no, "V3", "only one H1 is allowed");

  const sections: Section[] = [];
  for (const l of lines) {
    if (!l.fence && /^## /.test(l.text)) sections.push({ title: l.text.slice(3).trim(), line: l.no, lines: [] });
    else if (sections.length) sections[sections.length - 1].lines.push(l);
  }

  if (!schema.items) {
    const known = schema.sections.map((s) => s.title);
    let last = -1;
    const seen = new Set<string>();
    for (const s of sections) {
      const k = known.indexOf(s.title);
      if (k < 0) add(file, s.line, "V4", `'## ${s.title}' is not a ${kind} section`);
      else if (seen.has(s.title)) add(file, s.line, "V4", `'## ${s.title}' appears twice`);
      else if (k < last) add(file, s.line, "V4", `'## ${s.title}' is out of order (the order is: ${known.join(", ")})`);
      if (k >= 0) {
        seen.add(s.title);
        last = Math.max(last, k);
      }
    }
    for (const s of schema.sections) if (s.required && !seen.has(s.title)) add(file, first?.no ?? offset, "V4", `'## ${s.title}' is missing`);
    for (const s of sections) {
      const def = schema.sections.find((d) => d.title === s.title);
      const content = nonBlank(s.lines);
      if (content.length === 0) add(file, s.line, "V5", `'## ${s.title}' is empty`);
      else if (def && !def.none && content.length === 1 && content[0].text.trim() === NONE) {
        add(file, content[0].no, "V5", `'## ${s.title}' cannot be '${NONE}'`);
      }
    }
  }

  for (const l of lines) {
    if (l.fence) continue;
    for (const m of l.text.matchAll(LINK_RE)) {
      const target = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
      const name = target.replace(/#.*$/, "").replace(/^\.\//, "");
      if (!LINK_TARGETS.includes(name)) add(file, l.no, "V7", `the relative link '${target}' points outside the issue folder (allowed: ${LINK_TARGETS.join(", ")})`);
    }
  }

  return { kind, file, fm, lines, sections };
}

function section(doc: Doc, title: string): Section | undefined {
  return doc.sections.find((s) => s.title === title);
}

function checkRevisionLog(doc: Doc, add: Add) {
  const rule = KIND_RULE[doc.kind];
  const s = section(doc, "Revision log");
  if (!s) return;
  const entries = nonBlank(s.lines);
  let expect = 1;
  for (const l of entries) {
    const m = REVISION_RE.exec(l.text);
    if (!m) {
      add(doc.file, l.no, rule, "a Revision log line must be '- r<N> (<YYYY-MM-DD>, run <id>): <what changed>'");
      continue;
    }
    if (Number(m[1]) !== expect) add(doc.file, l.no, rule, `the Revision log line r${m[1]} should be r${expect}`);
    expect = Number(m[1]) + 1;
  }
  const lastNo = expect - 1;
  if (entries.length && lastNo !== doc.fm.revision) add(doc.file, s.line, rule, `the last Revision log line is r${lastNo}, the front matter says revision ${doc.fm.revision}`);
}

// `### <prefix><n>. <title>` blocks, each with exactly the labels in order.
function checkBlocks(doc: Doc, add: Add): { id: string; line: number; values: string[] }[] {
  const rule = KIND_RULE[doc.kind];
  const def = SCHEMA[doc.kind].blocks!;
  const s = section(doc, def.section);
  if (!s) return [];
  const out: { id: string; line: number; values: string[] }[] = [];
  let cur: { id: string; line: number; labels: Line[] } | null = null;
  const close = () => {
    if (!cur) return;
    const values: string[] = [];
    const got = cur.labels.map((l) => def.labels.find((lab) => l.text.startsWith(lab)) ?? l.text);
    if (got.join("|") !== def.labels.join("|")) {
      add(doc.file, cur.line, rule, `${cur.id} must have exactly the lines ${def.labels.map((x) => `'${x}'`).join(", ")} in this order`);
    } else {
      cur.labels.forEach((l, k) => {
        const v = l.text.slice(def.labels[k].length).trim();
        if (!v) add(doc.file, l.no, rule, `${cur!.id}: '${def.labels[k]}' is empty`);
        values.push(v);
      });
    }
    out.push({ id: cur.id, line: cur.line, values });
  };
  for (const l of nonBlank(s.lines)) {
    if (l.text.startsWith("### ")) {
      close();
      const m = new RegExp(`^### ${def.prefix}(\\d+)\\. \\S`).exec(l.text);
      const n = out.length + 1;
      if (!m) add(doc.file, l.no, rule, `a block heading must be '### ${def.prefix}<n>. <title>'`);
      else if (Number(m[1]) !== n) add(doc.file, l.no, rule, `${def.prefix}${m[1]} should be ${def.prefix}${n} (numbered from 1 without gaps)`);
      cur = { id: `${def.prefix}${m ? m[1] : n}`, line: l.no, labels: [] };
    } else if (!cur) add(doc.file, l.no, rule, `'## ${def.section}' holds only '### ${def.prefix}<n>.' blocks`);
    else if (!isContinuation(l)) cur.labels.push(l);
  }
  close();
  if (out.length === 0) add(doc.file, s.line, rule, `'## ${def.section}' needs at least one '### ${def.prefix}1.' block`);
  return out;
}

function checkDesign(doc: Doc, add: Add) {
  const rule = "DESIGN";
  const goal = section(doc, "Goal and non-goals");
  if (goal) {
    const labels = SCHEMA.design.sections.find((s) => s.title === goal.title)!.labels!;
    const got = nonBlank(goal.lines).filter((l) => labels.some((x) => l.text.startsWith(x)));
    if (got.map((l) => labels.find((x) => l.text.startsWith(x))).join("|") !== labels.join("|")) {
      add(doc.file, goal.line, rule, `'## Goal and non-goals' must have the lines ${labels.join(" and ")}, in this order`);
    } else {
      got.forEach((l, k) => {
        if (!l.text.slice(labels[k].length).trim()) add(doc.file, l.no, rule, `'${labels[k]}' is empty`);
      });
    }
  }

  const blocks = checkBlocks(doc, add);
  doc.decisions = blocks.map((b) => b.id);
  for (const b of blocks) {
    const source = b.values[3];
    if (source && !SOURCE_FORMS.some((re) => re.test(source))) {
      add(doc.file, b.line, rule, `${b.id}: Source '${source}' must be one of: answer Q<id> round <1|2>, ADR <id>, code <path>, rulings.md, issue comment <url>`);
    }
  }

  const acc = section(doc, "Acceptance");
  doc.acceptance = [];
  if (acc) {
    for (const l of nonBlank(acc.lines)) {
      if (isContinuation(l)) continue;
      const m = ACCEPTANCE_RE.exec(l.text);
      if (!m) {
        add(doc.file, l.no, rule, "an Acceptance line must be '- A<n>. <statement>'");
        continue;
      }
      const n = doc.acceptance.length + 1;
      if (Number(m[1]) !== n) add(doc.file, l.no, rule, `A${m[1]} should be A${n} (numbered from 1 without gaps)`);
      doc.acceptance.push({ id: `A${m[1]}`, line: l.no });
    }
    if (doc.acceptance.length === 0 && nonBlank(acc.lines).length) add(doc.file, acc.line, rule, "'## Acceptance' needs at least one '- A1. …' line");
  }

  const lineRule = (title: string, re: RegExp, shape: string) => {
    const s = section(doc, title);
    if (!s) return;
    const content = nonBlank(s.lines);
    if (content.length === 1 && content[0].text.trim() === NONE) return;
    for (const l of content) if (!isContinuation(l) && !re.test(l.text)) add(doc.file, l.no, rule, `a '## ${title}' line must be ${shape}, or the section is '${NONE}'`);
  };
  lineRule("Assumptions", DESIGN_ASSUMPTION_RE, `'- **<decision>**: <choice>. Why: <reason>. Change it by running devflow-refine with: "<example>".'`);
  lineRule("Related work", RELATED_RE, "'- <url> — <relation>'");
  const rulings = section(doc, "Proposed rulings");
  if (rulings) {
    for (const l of nonBlank(rulings.lines)) if (!RULING_RE.test(l.text)) add(doc.file, l.no, rule, "a Proposed rulings line must be '- **Q:** <question> **A:** <answer> **Source:** <source>'");
  }
  checkRevisionLog(doc, add);
}

// The lines under the H1 and before the first H2.
function headLines(doc: Doc): Line[] {
  const end = doc.sections[0]?.line ?? Number.MAX_SAFE_INTEGER;
  return nonBlank(doc.lines.slice(1)).filter((l) => l.no < end);
}

function checkPlan(doc: Doc, issue: number, add: Add, warnings: string[]) {
  const rule = "PLAN";
  const head = headLines(doc);
  const m = head[0] ? DESIGN_LINE.exec(head[0].text) : null;
  if (!m) add(doc.file, head[0]?.no ?? doc.lines[0]?.no ?? 1, rule, "the line under the H1 must be 'Design: design.md r<n>'");
  else if (Number(m[1]) !== doc.fm.design_revision) add(doc.file, head[0].no, rule, `'Design: design.md r${m[1]}' differs from design_revision ${doc.fm.design_revision}`);
  for (const l of head.slice(1)) if (!WARNING_LINE.test(l.text)) add(doc.file, l.no, rule, "only the 'Design:' line and a '> ' note may stand between the H1 and the first section");

  const ms = section(doc, "Implementation manifest");
  const text = doc.lines.map((l) => l.text).join("\n");
  if (ms) {
    doc.manifestLine = ms.line;
    try {
      doc.manifest = extractManifest(text);
    } catch (e) {
      add(doc.file, ms.line, rule, (e as Error).message);
    }
  }
  if (doc.manifest) {
    if (doc.manifest.plan_slug !== slugOf(issue)) add(doc.file, ms!.line, rule, `the manifest's plan_slug is '${doc.manifest.plan_slug}', it must be '${slugOf(issue)}'`);
    const tmp = mkdtempSync(join(tmpdir(), "devflow-docs-"));
    try {
      writeFileSync(join(tmp, "plan.md"), text + "\n");
      const args = ["python3", join(import.meta.dir, "validate-manifest.py"), join(tmp, "plan.md")];
      if (existsSync(PROFILE_PATH)) args.push("--profile", PROFILE_PATH);
      const r = run(args);
      for (const l of (r.err + (r.code !== 0 ? r.out : "")).split("\n").map((x) => x.trim()).filter(Boolean)) {
        if (/^manifest: warning: /.test(l)) warnings.push(`${doc.file}: ${l.replace(/^manifest: /, "")}`);
        else if (r.code !== 0) add(doc.file, ms!.line, "MANIFEST", l.replace(/^manifest: /, ""));
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  checkRevisionLog(doc, add);
}

function checkPlanTest(doc: Doc, add: Add) {
  const rule = "PLAN-TEST";
  const head = headLines(doc);
  const d = head[0] ? DESIGN_LINE.exec(head[0].text) : null;
  const p = head[1] ? PLAN_LINE.exec(head[1].text) : null;
  if (!d || !p || head.length !== 2) add(doc.file, head[0]?.no ?? 1, rule, "the lines under the H1 must be exactly 'Design: design.md r<n>' and 'Plan: plan.md r<m>'");
  if (d && Number(d[1]) !== doc.fm.design_revision) add(doc.file, head[0].no, rule, `'Design: design.md r${d[1]}' differs from design_revision ${doc.fm.design_revision}`);
  if (p && Number(p[1]) !== doc.fm.revision) add(doc.file, head[1].no, rule, `'Plan: plan.md r${p[1]}' differs from revision ${doc.fm.revision}`);
  const blocks = checkBlocks(doc, add);
  doc.cases = blocks.map((b) => {
    if (b.values[1] && !LEVELS.includes(b.values[1])) add(doc.file, b.line, rule, `${b.id}: Level '${b.values[1]}' must be one of ${LEVELS.join(", ")}`);
    return { id: b.id, line: b.line, covers: (b.values[0] ?? "").split(/[\s,]+/).filter(Boolean), phase: b.values[2] ?? "" };
  });
  checkRevisionLog(doc, add);
}

function checkItems(doc: Doc, add: Add) {
  const rule = KIND_RULE[doc.kind];
  const labels = SCHEMA[doc.kind].items!.labels;
  const body = nonBlank(doc.lines.slice(1));
  if (body.length === 1 && body[0].text === NO_MANUAL_STEPS) {
    doc.items = 0;
    return;
  }
  if (body.length === 0) add(doc.file, doc.lines[0]?.no ?? 1, "V5", `the body is empty: write the items or '${NO_MANUAL_STEPS}'`);
  for (const l of headLines(doc)) add(doc.file, l.no, rule, `text before the first item: the body is either '${NO_MANUAL_STEPS}' or '## <n>. <title>' items`);
  doc.items = doc.sections.length;
  doc.sections.forEach((s, k) => {
    const m = /^(\d+)\. \S/.exec(s.title);
    if (!m) add(doc.file, s.line, "V4", `an item heading must be '## <n>. <title>'`);
    else if (Number(m[1]) !== k + 1) add(doc.file, s.line, rule, `item ${m[1]} should be item ${k + 1} (numbered from 1 without gaps)`);
    const content = nonBlank(s.lines);
    if (content.length === 0) return add(doc.file, s.line, "V5", `item '${s.title}' is empty`);
    const labelled = content.filter((l) => labels.some((x) => l.text.startsWith(x)));
    const got = labelled.map((l) => labels.find((x) => l.text.startsWith(x)));
    if (got.join("|") !== labels.join("|")) {
      add(doc.file, s.line, rule, `item '${s.title}' must have the lines ${labels.map((x) => `'${x}'`).join(", ")} in this order`);
      return;
    }
    if (content[content.length - 1] !== labelled[labelled.length - 1]) add(doc.file, s.line, rule, `item '${s.title}' must end with its '${labels[labels.length - 1]}' line`);
    labelled.forEach((l, i) => {
      if (labels[i] !== "Steps:" && !l.text.slice(labels[i].length).trim()) add(doc.file, l.no, rule, `'${labels[i]}' is empty`);
    });
    const steps = content.slice(content.indexOf(labelled[1]) + 1, content.indexOf(labelled[2]));
    if (steps.length === 0) add(doc.file, labelled[1].no, rule, `item '${s.title}' has no steps under 'Steps:'`);
    for (const l of steps) if (!/^\d+\. \S/.test(l.text) && !isContinuation(l)) add(doc.file, l.no, rule, "a step must be a numbered line '<n>. <step>'");
  });
}

function checkKind(doc: Doc, issue: number, add: Add, warnings: string[]) {
  if (doc.kind === "design") checkDesign(doc, add);
  else if (doc.kind === "plan") checkPlan(doc, issue, add, warnings);
  else if (doc.kind === "plan-test") checkPlanTest(doc, add);
  else checkItems(doc, add);
}

function dependsOnAll(m: Manifest, id: string): string[] {
  const deps = new Map(m.phases.map((p) => [p.id, p.depends_on ?? []]));
  const reach = new Set<string>();
  const walk = (x: string) => {
    for (const d of deps.get(x) ?? []) if (!reach.has(d)) (reach.add(d), walk(d));
  };
  walk(id);
  return m.phases.map((p) => p.id).filter((p) => p !== id && !reach.has(p));
}

function crossRules(docs: Map<DocKind, Doc>, opts: Options, plansDir: string, add: Add, read: (p: string) => string | null) {
  const own = new Set(opts.kinds);
  const design = docs.get("design");
  const plan = docs.get("plan");
  const planTest = docs.get("plan-test");
  for (const d of docs.values()) {
    if (own.has(d.kind) && d.fm.issue !== opts.issue) add(d.file, 1, "X1", `front matter issue ${d.fm.issue} is not issue ${opts.issue}`);
  }
  for (const d of docs.values()) {
    if (d.kind === "design" || !own.has(d.kind)) continue;
    if (design && d.fm.design_revision !== design.fm.revision) add(d.file, 1, "X2", `design_revision ${d.fm.design_revision} is not the design's revision ${design.fm.revision}`);
    if (plan && d.kind !== "plan" && d.fm.revision !== plan.fm.revision) add(d.file, 1, "X3", `revision ${d.fm.revision} is not the plan's revision ${plan.fm.revision}`);
  }

  if (design && planTest?.cases) {
    if (!design.acceptance) checkDesign(design, () => {});
    const known = new Set([...(design.acceptance ?? []).map((a) => a.id), ...(design.decisions ?? [])]);
    const covered = new Set(planTest.cases.flatMap((c) => c.covers));
    for (const c of planTest.cases) for (const id of c.covers) if (!known.has(id)) add(planTest.file, c.line, "X4", `${c.id} covers ${id}, which is not an Acceptance item or Decision of the design`);
    const cases = section(planTest, "Cases");
    for (const a of design.acceptance ?? []) if (!covered.has(a.id)) add(planTest.file, cases?.line ?? 1, "X4", `the design's ${a.id} is covered by no case`);
  }

  if (plan?.manifest) {
    const m = plan.manifest;
    const ids = m.phases.map((p) => p.id);
    const line = plan.manifestLine ?? 1;
    for (const p of ids) {
      if (p === "verify" || p.endsWith("-tests")) continue;
      if (!ids.includes(`${p}-tests`)) add(plan.file, line, "X5", `implementation phase ${p} has no test phase ${p}-tests`);
    }
    if (!ids.includes("verify")) add(plan.file, line, "X5", "the manifest has no 'verify' phase");
    else {
      const missing = dependsOnAll(m, "verify");
      if (missing.length) add(plan.file, line, "X5", `the 'verify' phase does not depend on ${missing.join(", ")}`);
    }
    if (planTest?.cases) {
      for (const c of planTest.cases) if (!ids.includes(c.phase)) add(planTest.file, c.line, "X5", `${c.id}'s phase '${c.phase}' is not a manifest phase`);
      for (const p of ids) {
        if (p.endsWith("-tests") && !planTest.cases.some((c) => c.phase === p)) add(planTest.file, section(planTest, "Cases")?.line ?? 1, "X5", `test phase ${p} has no case`);
      }
    }
    for (const [kind, key] of [["before", "manual_before"], ["after", "manual_after"]] as const) {
      const d = docs.get(kind);
      if (!d || d.items === undefined) continue;
      const listed = (m[key] ?? []).length > 0;
      if (listed !== d.items > 0) {
        add(d.file, 1, "X6", listed ? `the manifest lists ${key} steps, ${kind}.md has none` : `${kind}.md has items, the manifest's ${key} is empty`);
      }
    }
  }

  if (opts.ref !== undefined && plan && own.has("plan")) {
    const wf = workflowFile(plansDir, opts.issue);
    const text = read(wf);
    if (text === null) add(wf, 1, "X8", `${wf} does not exist at ${opts.ref}`);
    else {
      let description = "";
      try {
        description = String((Bun.YAML.parse(text) as any)?.description ?? "");
      } catch {}
      if (!new RegExp(`\\bplan r${plan.fm.revision}\\b`).test(description)) add(wf, 1, "X8", `the workflow's description does not name plan r${plan.fm.revision}`);
    }
  }
}

function parseArgs(argv: string[]): { opts: Options; warn: boolean } {
  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--with-design" || a === "--warn") bools.add(a.slice(2));
    else if (a.startsWith("--")) flags[a.slice(2)] = argv[++i] ?? "";
    else throw new Error(`unexpected argument '${a}'`);
  }
  const issue = Number(flags.issue);
  if (!Number.isInteger(issue) || issue < 1) throw new Error("--issue <n> is required");
  if ((flags.dir === undefined) === (flags.ref === undefined)) throw new Error("pass exactly one of --dir <folder> and --ref <commit>");
  const k = flags.kinds ?? "all";
  const kinds = (k === "all" ? DOC_KINDS : k.split(",").map((x) => x.trim())) as DocKind[];
  for (const x of kinds) if (!DOC_KINDS.includes(x)) throw new Error(`unknown kind '${x}' (known: ${DOC_KINDS.join(", ")})`);
  return { opts: { issue, dir: flags.dir, ref: flags.ref, plansDir: flags["plans-dir"], kinds, withDesign: bools.has("with-design") }, warn: bools.has("warn") };
}

// One line per error, for fail() messages: file:line [rule] message.
export function formatErrors(errors: DocError[]): string {
  return errors.map((e) => `${e.file}:${e.line} [${e.rule}] ${e.message}`).join("\n");
}

if (import.meta.main) {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`devflow: ${(e as Error).message}`);
    process.exit(2);
  }
  const r = validateDocs(parsed.opts);
  console.log(JSON.stringify(r));
  if (!r.ok) console.error(formatErrors(r.errors));
  process.exit(r.ok || parsed.warn ? 0 : 1);
}
