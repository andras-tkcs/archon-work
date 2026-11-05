// Publishes the plan, its steps for the person and the generated workflow to the plans branch.
// Never syncs and never forces a push.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactsDir, fail, input, must, run, tail } from "./util.ts";

const art = artifactsDir();
const slug = input("slug");
const title = input("title");
const workflow = input("workflow");
const plansRef = input("plans_ref");
const plansDir = input("plans_dir");
const mainBranch = input("main_branch");
const verb = input("commit_verb", false) || "Plan";
if (verb !== "Plan" && verb !== "Refine") fail(`invalid commit_verb '${verb}': it must be Plan or Refine`);
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail(`invalid slug '${slug}': it must be kebab-case`);
const runId = process.env.WORKFLOW_ID || "run";
// The load step is a person's command and is never run here; it is only quoted in published.md.
const LOAD = "archon workflow sync";
const ident = ["-c", "user.name=devflow", "-c", "user.email=devflow@example.invalid"];

// What the plan test and the interview left open: check-plan.ts writes tested.json and unresolved.md, next-question.ts
// writes open-questions.md. They are marked in plan.md, above the review warning.
let unresolved = 0;
let withheld = false;
let open = 0;
let noteLines: string[] = [];
{
  const tj = join(art, "tested.json");
  if (existsSync(tj)) {
    try {
      withheld = JSON.parse(readFileSync(tj, "utf8")).withheld === true;
    } catch {}
  }
  const of = join(art, "open-questions.md");
  const openText = existsSync(of) ? readFileSync(of, "utf8").trim() : "";
  open = openText.split("\n").filter((l) => /^### Q\d+/.test(l)).length;
  const incomplete = open > 0 || withheld;
  const uf = join(art, "unresolved.md");
  const pf = join(art, "plan.md");
  const lines = readFileSync(pf, "utf8").split("\n");

  // Line numbers of the non-fenced "## " headings.
  const headings = () => {
    const heads: { i: number; text: string }[] = [];
    let inFence = false;
    lines.forEach((line, i) => {
      if (line.startsWith("```")) inFence = !inFence;
      else if (!inFence && /^## /.test(line)) heads.push({ i, text: line.trimEnd() });
    });
    return heads;
  };

  // 0. Remove what an earlier publication left, so the note is rebuilt from this run's inputs only.
  {
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("```")) inFence = !inFence;
      else if (!inFence && lines[i] === "> [!WARNING]" && (lines[i + 1] ?? "").startsWith("> Incomplete plan:")) {
        let end = i + 2;
        while (end < lines.length && lines[end].startsWith("> ")) end++;
        const from = i > 0 && lines[i - 1] === "" ? i - 1 : i;
        lines.splice(from, end - from);
        i = from - 1;
      }
    }
    for (;;) {
      const heads = headings();
      const k = heads.findIndex((h) => h.text === "## Open questions");
      if (k < 0) break;
      lines.splice(heads[k].i, (heads[k + 1]?.i ?? lines.length) - heads[k].i);
    }
  }

  // 1. The unresolved findings.
  if (existsSync(uf)) {
    const content = readFileSync(uf, "utf8").trim();
    unresolved = content.split("\n").filter((l) => l.startsWith("- F")).length;
    if (!lines.includes("### Unresolved validation findings")) {
      const heads = headings();
      const block = ["", ...content.split("\n"), ""];
      const risks = heads.filter((h) => h.text === "## Risks and open questions").pop();
      if (risks) {
        const next = heads.find((h) => h.i > risks.i);
        lines.splice(next ? next.i : lines.length, 0, ...block);
      } else {
        const at = heads.filter((h) => h.text === "## Assumptions").pop() ?? heads.filter((h) => h.text === "## Implementation manifest").pop();
        lines.splice(at ? at.i : lines.length, 0, "## Risks and open questions", ...block);
      }
      if (!withheld) {
        const t = lines.findIndex((l) => l.startsWith("# "));
        lines.splice(t + 1, 0, "", "> [!WARNING]", `> This plan was published with ${unresolved} unresolved validation findings. Read "Unresolved validation`, `> findings" under "Risks and open questions" before you run it.`);
      }
    }
  }

  // 2. The open interview questions.
  if (open > 0) {
    const heads = headings();
    const at = heads.filter((h) => h.text === "## Risks and open questions").pop() ?? heads.filter((h) => h.text === "## Assumptions").pop() ?? heads.filter((h) => h.text === "## Implementation manifest").pop();
    lines.splice(
      at ? at.i : lines.length,
      0,
      "## Open questions",
      "",
      "The interview ended before these were answered. Each is taken at its recommended default under",
      "`## Assumptions`; `devflow-refine` asks them again.",
      "",
      ...openText.split("\n"),
      "",
    );
  }

  // 3. The note under the title.
  if (incomplete) {
    const parts: string[] = [];
    if (open > 0) parts.push(`${open} interview questions are still open (listed under "Open questions", taken at their recommended defaults under "Assumptions")`);
    if (withheld) parts.push(`${unresolved} validation findings would break the generated workflow (listed under "Unresolved validation findings" in "Risks and open questions")`);
    const last = withheld
      ? `There is no runnable \`${workflow}\` workflow until \`devflow-refine\` fixes the plan; an earlier one on the plans branch is removed.`
      : `Running \`${workflow}\` now accepts the recommended defaults listed under Assumptions. After it starts, \`devflow-refine\` can no longer continue this plan.`;
    noteLines = [
      "> [!WARNING]",
      `> Incomplete plan: ${parts.join("; ")}. Ready for \`devflow-refine\` as continuation: run it with the plan slug \`${slug}\`; its open questions are asked again.`,
      `> ${last}`,
    ];
    const t = lines.findIndex((l) => l.startsWith("# "));
    lines.splice(t + 1, 0, "", ...noteLines);
  }
  writeFileSync(pf, lines.join("\n"));
}

const tmp = join(mkdtempSync(join(tmpdir(), "devflow-plans-")), "wt");
let orphan = "";
let commit = "";
let removed = false;
try {
  // 1. A temporary worktree on the plans branch, so the run's own worktree is untouched.
  if (run(["git", "ls-remote", "--exit-code", "--heads", "origin", plansRef]).code === 0) {
    must(["git", "fetch", "origin", plansRef]);
    must(["git", "worktree", "add", "--detach", tmp, "FETCH_HEAD"]);
  } else {
    orphan = `${plansRef}-${runId}`;
    must(["git", "worktree", "add", "--orphan", "-b", orphan, tmp]);
  }

  // 2. The files.
  const slugDir = join(tmp, plansDir, slug);
  mkdirSync(slugDir, { recursive: true });
  mkdirSync(join(tmp, plansDir, "workflows"), { recursive: true });
  copyFileSync(join(art, "plan.md"), join(slugDir, "plan.md"));
  for (const f of ["prerequisites.md", "after.md"]) {
    if (existsSync(join(art, f))) copyFileSync(join(art, f), join(slugDir, f));
    else rmSync(join(slugDir, f), { force: true });
  }
  const wf = join(tmp, plansDir, "workflows", `${workflow}.yaml`);
  if (withheld) {
    removed = existsSync(wf);
    rmSync(wf, { force: true });
  } else {
    copyFileSync(join(art, `${workflow}.yaml`), wf);
  }

  // 3. Commit (nothing, when nothing changed) and push without force.
  must(["git", "-C", tmp, "add", "-A"]);
  const dirty = run(["git", "-C", tmp, "status", "--porcelain"]).out.trim() !== "";
  if (dirty) must(["git", ...ident, "-C", tmp, "commit", "-qm", `${verb} ${slug}: ${title}`]);
  commit = must(["git", "-C", tmp, "rev-parse", "HEAD"]);
  const push = run(["git", "-C", tmp, "push", "origin", `HEAD:refs/heads/${plansRef}`]);
  if (push.code !== 0) fail(`the push to ${plansRef} was rejected: ${tail(push.err || push.out, 10)}`);
} finally {
  run(["git", "worktree", "remove", "--force", tmp]);
  rmSync(join(tmp, ".."), { recursive: true, force: true });
  run(["git", "worktree", "prune"]);
  if (orphan) run(["git", "branch", "-D", orphan]);
}

// 4. Is the plans branch already a workflow source of the project? (No sync: only instructions.)
run(["git", "fetch", "origin", mainBranch]);
const cfg = run(["git", "show", `origin/${mainBranch}:.archon/config.yaml`]);
let configured = false;
if (cfg.code === 0) {
  try {
    const sources = (Bun.YAML.parse(cfg.out) as any)?.extraWorkflowSources ?? [];
    configured = Array.isArray(sources) && sources.some((s: any) => s?.ref === plansRef && (s?.path ?? ".") === plansDir);
  } catch {}
}

// Assumptions: bullets of the last non-fenced "## Assumptions" section of plan.md.
const assumptions: string[] = [];
{
  let inFence = false;
  let inSection = false;
  let current: string[] = [];
  for (const line of readFileSync(join(art, "plan.md"), "utf8").split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^## Assumptions\s*$/.test(line)) {
      inSection = true;
      current = [];
      continue;
    }
    if (/^## /.test(line)) {
      if (inSection) assumptions.splice(0, assumptions.length, ...current);
      inSection = false;
      continue;
    }
    if (inSection && line.startsWith("- ")) current.push(line);
  }
  if (inSection) assumptions.splice(0, assumptions.length, ...current);
}

const repo = run(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).out.trim() || "<owner>/<repo>";
const lines = [
  `# Published ${workflow}`,
  "",
  `Commit ${commit} on the \`${plansRef}\` branch: https://github.com/${repo}/blob/${plansRef}/${plansDir}/${slug}/plan.md`,
  ...(noteLines.length > 0 ? ["", ...noteLines, ""] : []),
  withheld
    ? `Workflow: none published (withheld until \`devflow-refine\` fixes the plan)`
    : `Workflow: \`${workflow}\` (${plansDir}/workflows/${workflow}.yaml)`,
  ...(withheld && removed ? [`The previous \`${workflow}.yaml\` was removed from the plans branch.`] : []),
  "",
  ...(assumptions.length > 0
    ? ["## Assumptions", "", ...assumptions, ""]
    : ["None: every decision in the plan was made in the interview.", ""]),
];
if (!configured && !withheld) {
  lines.push(
    "The project does not load workflows from the plans branch yet. Add this to `.archon/config.yaml` on the default branch first:",
    "",
    "```yaml",
    "extraWorkflowSources:",
    `  - ref: ${plansRef}`,
    `    path: ${plansDir}`,
    "```",
    "",
  );
}
lines.push(withheld ? `Continue with devflow-refine on the plan slug \`${slug}\`.` : `Run \`${LOAD}\` in the project's checkout, then \`archon workflow run ${workflow} --detach\`.`, "");
writeFileSync(join(art, "published.md"), lines.join("\n"));

const message = withheld
  ? `published plan ${slug} without its workflow: ${unresolved} validation findings would break it; continue with devflow-refine ${slug}`
  : `published ${workflow}; assumptions: ${assumptions.length === 0 ? "none" : `${assumptions.length} (listed in published.md)`}; run ${LOAD} to load it` +
    (open > 0 ? `; incomplete: ${open} open questions, continue with devflow-refine ${slug}` : "");
console.log(JSON.stringify({ commit, workflow: withheld ? "" : workflow, unresolved, incomplete: open > 0 || withheld, open, message }));
