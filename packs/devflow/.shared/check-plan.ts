// The plan-check loop's decision step: collects the test and review findings and says whether the plan may be published.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractManifest } from "./render-run.ts";
import { artifactsDir, fail, input } from "./util.ts";

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
const unresolvedFile = join(art, "unresolved.md");

if (findings.length === 0) {
  writeFileSync(
    join(art, "tested.json"),
    JSON.stringify({ slug: finalize.slug, branch: finalize.branch, title: finalize.title, scope: finalize.scope, workflow: render.workflow, waves: render.waves, withheld: false }),
  );
  if (existsSync(findingsFile)) rmSync(findingsFile);
  if (existsSync(unresolvedFile)) rmSync(unresolvedFile);
  console.log(JSON.stringify({ done: true, round, findings: 0 }));
  process.exit(0);
}

let md = `# Plan test findings, round ${round}

Fix every finding in plan.md. A mechanical finding: change the plan to match the code. An
open decision: decide it, record it under \`## Assumptions\`, and fix the briefs it affects.
`;
for (const f of findings) {
  md += `\n## ${f.id}. [${f.source}, ${f.kind}] ${f.phase || "plan"}\n\n**Problem:** ${f.problem}\n\n**Fix:** ${f.fix}\n`;
}
writeFileSync(findingsFile, md);

if (round < MAX_ROUNDS) {
  console.log(JSON.stringify({ done: false, round, findings: findings.length }));
} else {
  const lines = findings.map((f: any) => `- ${f.id} [${f.source}, ${f.kind}] ${f.phase || "plan"}: ${String(f.problem).split("\n")[0]}`);
  // A render or validate_manifest finding means the generated workflow would fail at its first phase: plan.md is
  // published anyway when devflow-refine can load it (a usable manifest), and the workflow is withheld.
  if (findings.some((f: any) => f.source !== "review")) {
    let unusable = "";
    try {
      const m = extractManifest(readFileSync(join(art, "plan.md"), "utf8"));
      if (m.plan_slug !== finalize.slug) unusable = `its plan_slug '${m.plan_slug}' differs from '${finalize.slug}'`;
      else if (String(m.feature_branch ?? "") === "") unusable = "it has no feature_branch";
    } catch (e) {
      unusable = (e as Error).message;
    }
    if (unusable) {
      fail(`the plan still has ${findings.length} findings after 2 fix rounds and no usable manifest (${unusable}), so devflow-refine could not load it; nothing was published. They are in test-findings.md in the run artifacts:\n${lines.join("\n")}`);
    }
    writeFileSync(
      join(art, "tested.json"),
      JSON.stringify({ slug: finalize.slug, branch: finalize.branch, title: finalize.title, scope: finalize.scope, workflow: `devflow-run-${finalize.slug}`, waves: 0, unresolved: findings.length, withheld: true }),
    );
    writeFileSync(
      unresolvedFile,
      `### Unresolved validation findings

The plan test still reported these after its last fix round. They would break the generated
workflow, so it was not published; \`devflow-refine\` fixes them. The full findings are
\`test-findings.md\` in the planning run's artifacts.

${lines.join("\n")}
`,
    );
    console.log(JSON.stringify({ done: true, round, findings: findings.length }));
    process.exit(0);
  }
  // Only the large-tier review is left: publish anyway, and say so in the plan.
  writeFileSync(
    join(art, "tested.json"),
    JSON.stringify({ slug: finalize.slug, branch: finalize.branch, title: finalize.title, scope: finalize.scope, workflow: render.workflow, waves: render.waves, unresolved: findings.length, withheld: false }),
  );
  writeFileSync(
    unresolvedFile,
    `### Unresolved validation findings

The large-tier review still reported these after its last round. The plan was published anyway.
The full findings are \`test-findings.md\` in the planning run's artifacts.

${lines.join("\n")}
`,
  );
  console.log(JSON.stringify({ done: true, round, findings: findings.length }));
  process.exit(0);
}
