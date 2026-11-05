// The plan-check loop's decision step: collects the test and review findings and says whether the plan may be published.
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactsDir, fail, input } from "../../.shared/util.ts";

const MAX_ROUNDS = 3;

function parse(name: string, text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return fail(`input '${name}' is not JSON: ${text.slice(0, 200)}`);
  }
}

const art = artifactsDir();
const test = parse("test", input("test"));
const reviewText = input("review", false);
const review = reviewText.trim() === "" ? null : parse("review", reviewText);
const finalize = parse("finalize", input("finalize"));
const render = parse("render", input("render"));
const round = (Number(input("round", false)) || 0) + 1;

const findings = [...(test.findings ?? []), ...(review?.findings ?? [])].map((f: any, i: number) => ({ ...f, id: `F${i + 1}` }));
const findingsFile = join(art, "test-findings.md");

if (findings.length === 0) {
  writeFileSync(
    join(art, "tested.json"),
    JSON.stringify({ slug: finalize.slug, branch: finalize.branch, title: finalize.title, scope: finalize.scope, workflow: render.workflow, waves: render.waves }),
  );
  if (existsSync(findingsFile)) rmSync(findingsFile);
  console.log(JSON.stringify({ done: true, round, findings: 0 }));
  process.exit(0);
}

let md = `# Plan test findings, round ${round}

Fix every finding in plan.md. A mechanical finding: change the plan to match the code. An
open decision: decide it, record it under \`## Assumptions\`, and fix the briefs it affects.
`;
for (const f of findings) {
  md += `\n## ${f.id}. [${f.source}, ${f.kind}] ${f.phase || "plan"}\n\n${f.problem}\n\nFix: ${f.fix}\n`;
}
writeFileSync(findingsFile, md);

if (round < MAX_ROUNDS) {
  console.log(JSON.stringify({ done: false, round, findings: findings.length }));
} else {
  const lines = findings.map((f: any) => `- ${f.id} [${f.source}, ${f.kind}] ${f.phase || "plan"}: ${String(f.problem).split("\n")[0]}`);
  fail(`the plan still has ${findings.length} findings after 2 fix rounds; nothing was published. They are in test-findings.md in the run artifacts:\n${lines.join("\n")}`);
}
