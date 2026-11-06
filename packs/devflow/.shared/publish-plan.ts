// Publishes the checked plan files ($ARTIFACTS_DIR/final/) and the generated build workflow to the
// plans branch in one commit, checks the published files with validate-docs, then updates the issue
// comment. Never syncs and never forces a push. Env: INPUTS_ISSUE, INPUTS_TITLE, INPUTS_PLAN_REVISION,
// INPUTS_DESIGN_REVISION, INPUTS_WORKFLOW, INPUTS_MAIN_BRANCH, INPUTS_PLANS_REF, INPUTS_PLANS_DIR.
// Output: { commit, workflow, revision, unresolved, message }.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoSlug } from "./gh.ts";
import { upsertComment } from "./issue-comment.ts";
import { fileOf, workflowFile } from "./layout.ts";
import { commitFiles } from "./plans-branch.ts";
import { artifactsDir, fail, input, plansConfig, run } from "./util.ts";
import { formatErrors, validateDocs } from "./validate-docs.ts";

const PLAN_KINDS = ["plan", "plan-test", "before", "after"] as const;
// The load step is a person's command and is never run here; it is only quoted in published.md.
const LOAD = "archon workflow sync";

// Puts the review-only findings check-plan left (unresolved.md) into plan.md: a warning under the
// Design line, and the findings under "Risks and open questions". Returns the plan and their count.
export function markUnresolved(plan: string, unresolvedMd: string): { text: string; count: number } {
  const content = unresolvedMd.trim();
  const count = content.split("\n").filter((l) => l.startsWith("- F")).length;
  if (count === 0) return { text: plan, count };
  const lines = plan.split("\n");
  let inFence = false;
  const heads: number[] = [];
  lines.forEach((l, i) => {
    if (l.startsWith("```")) inFence = !inFence;
    else if (!inFence && l.startsWith("## ")) heads.push(i);
  });
  const risks = heads.find((i) => lines[i] === "## Risks and open questions");
  if (risks !== undefined) {
    const next = heads.find((i) => i > risks) ?? lines.length;
    lines.splice(next, 0, ...content.split("\n"), "");
  }
  const designLine = lines.findIndex((l) => /^Design: design\.md r\d+$/.test(l));
  lines.splice(
    designLine + 1,
    0,
    "",
    "> [!WARNING]",
    `> This plan was published with ${count} unresolved review findings. Read "Unresolved validation`,
    '> findings" under "Risks and open questions" before you run it.',
  );
  return { text: lines.join("\n"), count };
}

// The bullets of plan.md's `## Assumptions` section (the one after the manifest).
function assumptionsOf(plan: string): string[] {
  const m = /^## Assumptions\n([\s\S]*?)(?=^## )/m.exec(plan);
  return m ? m[1].split("\n").filter((l) => l.startsWith("- ")) : [];
}

if (import.meta.main) {
  const art = artifactsDir();
  const n = Number(input("issue"));
  const title = input("title");
  const revision = Number(input("plan_revision"));
  const designRevision = Number(input("design_revision"));
  const workflow = input("workflow");
  const mainBranch = input("main_branch");
  const plans = plansConfig();
  const runId = process.env.WORKFLOW_ID || "run";

  const files: Record<string, string> = {};
  let unresolved = 0;
  for (const kind of PLAN_KINDS) {
    let text = readFileSync(join(art, "final", `${kind}.md`), "utf8");
    if (kind === "plan" && existsSync(join(art, "unresolved.md"))) {
      const marked = markUnresolved(text, readFileSync(join(art, "unresolved.md"), "utf8"));
      text = marked.text;
      unresolved = marked.count;
    }
    files[fileOf(plans.dir, n, kind)] = text;
  }
  files[workflowFile(plans.dir, n)] = readFileSync(join(art, `${workflow}.yaml`), "utf8");

  const commit = commitFiles({
    ref: plans.ref,
    files,
    message: `Plan issue-${n} r${revision}: ${title}`,
    trailers: { Issue: `#${n}`, Design: `r${designRevision}`, Run: runId },
  });

  const back = validateDocs({ issue: n, ref: commit, plansDir: plans.dir, kinds: [...PLAN_KINDS], withDesign: true });
  if (!back.ok) fail(`the published plan (commit ${commit}) does not validate; the issue comment is unchanged:\n${formatErrors(back.errors)}`);

  let repo: string;
  try {
    repo = repoSlug();
  } catch (e) {
    fail(`${(e as Error).message}\nThe plan is already pushed in commit ${commit}.`);
  }
  upsertComment(n, { plan: { revision, design_revision: designRevision, commit }, needs_refine: null, build: { state: "not_started" }, plans, repo }, commit);

  // Is the plans branch already a workflow source of the project? (No sync: only instructions.)
  run(["git", "fetch", "origin", mainBranch]);
  const cfg = run(["git", "show", `origin/${mainBranch}:.archon/config.yaml`]);
  let configured = false;
  if (cfg.code === 0) {
    try {
      const sources = (Bun.YAML.parse(cfg.out) as any)?.extraWorkflowSources ?? [];
      configured = Array.isArray(sources) && sources.some((s: any) => s?.ref === plans.ref && (s?.path ?? ".") === plans.dir);
    } catch {}
  }

  const assumptions = assumptionsOf(files[fileOf(plans.dir, n, "plan")]);
  const lines = [
    `# Published ${workflow}`,
    "",
    `Commit ${commit} on the \`${plans.ref}\` branch: https://github.com/${repo}/blob/${plans.ref}/${fileOf(plans.dir, n, "plan")}`,
    `Workflow: \`${workflow}\` (${workflowFile(plans.dir, n)})`,
    ...(unresolved > 0 ? ["", `${unresolved} review findings are unresolved: they are listed in plan.md under "Risks and open questions".`] : []),
    "",
    ...(assumptions.length > 0 ? ["## Assumptions", "", ...assumptions, ""] : ["Assumptions: none; every decision comes from design.md.", ""]),
  ];
  if (!configured) {
    lines.push(
      "The project does not load workflows from the plans branch yet. Add this to `.archon/config.yaml` on the default branch first:",
      "",
      "```yaml",
      "extraWorkflowSources:",
      `  - ref: ${plans.ref}`,
      `    path: ${plans.dir}`,
      "```",
      "",
    );
  }
  lines.push(`Run \`${LOAD}\` in the project's checkout, then \`archon workflow run ${workflow} --detach\`.`, "");
  writeFileSync(join(art, "published.md"), lines.join("\n"));

  const message = `published ${workflow} (plan r${revision} from design r${designRevision}); assumptions: ${assumptions.length === 0 ? "none" : `${assumptions.length} (listed in published.md)`}; run ${LOAD} to load it`;
  console.log(JSON.stringify({ commit, workflow, revision, unresolved, message }));
}
