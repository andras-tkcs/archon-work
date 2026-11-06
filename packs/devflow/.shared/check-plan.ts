// The plan-check loop's decision step. It adds the front matter to the four drafted files
// ($ARTIFACTS_DIR/final/), checks them with validate-docs together with the design, collects the
// test and review findings, and says whether the plan may be published. Only review findings may
// remain after the last round; anything else fails the run, so an invalid plan is never published.
// A draft that ended with needs_refine ends the loop at once and validates nothing.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serialize } from "./frontmatter.ts";
import { artifactsDir, fail, input } from "./util.ts";
import { validateDocs } from "./validate-docs.ts";

const MAX_ROUNDS = 3;
const PLAN_KINDS = ["plan", "plan-test", "before", "after"] as const;

function parse(name: string, required = true): any {
  const text = input(name, required);
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return fail(`input '${name}' is not JSON: ${text.slice(0, 200)}`);
  }
}

const art = artifactsDir();
const draft = parse("draft");
const round = (Number(input("round", false)) || 0) + 1;
const findingsFile = join(art, "test-findings.md");
const unresolvedFile = join(art, "unresolved.md");
const validationFile = join(art, "validation.json");
const testedFile = join(art, "tested.json");
const out = (done: boolean, findings: number, needs: any = null) =>
  console.log(
    JSON.stringify({
      done,
      round,
      findings,
      needs_refine_present: needs !== null,
      needs_refine_question: String(needs?.question ?? ""),
      needs_refine_why: String(needs?.why ?? ""),
    }),
  );

if (draft.needs_refine_present === true) {
  for (const f of [testedFile, findingsFile, unresolvedFile, validationFile]) if (existsSync(f)) rmSync(f);
  out(true, 0, { question: draft.needs_refine_question, why: draft.needs_refine_why });
  process.exit(0);
}

const resolve = parse("resolve");
const design = parse("load_design");
const test = parse("test");
const review = parse("review", false);
const render = parse("render");
const issue = Number(resolve.issue);

// 1. Front matter, then the same check the publish step and the build's start run.
const final = join(art, "final");
mkdirSync(final, { recursive: true });
if (existsSync(join(art, "design.md"))) copyFileSync(join(art, "design.md"), join(final, "design.md"));
const fm = (kind: string) => ({
  issue,
  kind,
  title: String(draft.title),
  revision: Number(resolve.plan_revision) + 1,
  design_revision: Number(design.design_revision),
  run: process.env.WORKFLOW_ID || "run",
  updated: new Date().toISOString().slice(0, 10),
});
for (const kind of PLAN_KINDS) {
  const src = join(art, `${kind}.md`);
  if (existsSync(src)) writeFileSync(join(final, `${kind}.md`), serialize(fm(kind), readFileSync(src, "utf8")));
  else rmSync(join(final, `${kind}.md`), { force: true });
}
const docs = validateDocs({ issue, dir: final, kinds: [...PLAN_KINDS], withDesign: true });
if (docs.ok) rmSync(validationFile, { force: true });
else writeFileSync(validationFile, JSON.stringify(docs.errors.map((e) => ({ ...e, file: e.file.replace(`${final}/`, "") })), null, 2));

const findings = [
  ...(test.findings ?? []),
  ...(review?.findings ?? []),
  ...docs.errors.map((e) => ({
    source: "validate_docs",
    kind: "mechanical",
    phase: "",
    problem: `${e.file.replace(`${final}/`, "")}:${e.line} [${e.rule}] ${e.message}`,
    fix: "Fix it in the file (validation.json lists every error).",
  })),
].map((f: any, i: number) => ({ ...f, id: `F${i + 1}` }));

const tested = (extra: Record<string, unknown> = {}) =>
  writeFileSync(
    testedFile,
    JSON.stringify({ issue, branch: draft.branch, title: draft.title, scope: draft.scope, workflow: render.workflow, waves: render.waves, ...extra }),
  );

if (findings.length === 0) {
  tested();
  for (const f of [findingsFile, unresolvedFile]) if (existsSync(f)) rmSync(f);
  out(true, 0);
  process.exit(0);
}

let md = `# Plan test findings, round ${round}

Fix every finding in the files. A mechanical finding: change the file to match the code, the
profile, the template or the validator. An open decision: decide it, record it under
\`## Assumptions\`, and fix the briefs it affects.
`;
for (const f of findings) {
  md += `\n## ${f.id}. [${f.source}, ${f.kind}] ${f.phase || "plan"}\n\n**Problem:** ${f.problem}\n\n**Fix:** ${f.fix}\n`;
}
writeFileSync(findingsFile, md);

if (round < MAX_ROUNDS) {
  out(false, findings.length);
  process.exit(0);
}

const lines = findings.map((f: any) => `- ${f.id} [${f.source}, ${f.kind}] ${f.phase || "plan"}: ${String(f.problem).split("\n")[0]}`);
if (findings.some((f: any) => f.source !== "review")) {
  fail(
    `the plan still has ${findings.length} findings after ${MAX_ROUNDS - 1} fix rounds, and not only review findings, so nothing was published. They are in test-findings.md in the run artifacts:\n${lines.join("\n")}`,
  );
}
// Only the large-tier review is left: publish anyway, and say so in the plan.
tested({ unresolved: findings.length });
writeFileSync(
  unresolvedFile,
  `### Unresolved validation findings

The large-tier review still reported these after its last round. The plan was published anyway.
The full findings are \`test-findings.md\` in the planning run's artifacts.

${lines.join("\n")}
`,
);
out(true, findings.length);
