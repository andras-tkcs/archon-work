// Renders the build-issue-<n> workflow: an unattended build of a published plan. start, the phases (up
// to 3 at a time, each in its own worktree), the merges, wrap (deviations.md committed and pushed),
// deliver when every phase is done, wrap's final pass, end. No wait, approval, select or cancel
// node: every ending passes through wrap. A pure function plus a small CLI for tests.
import { readFileSync } from "node:fs";
import { SLUG_RE, fileOf, slugOf, workflowName } from "./layout.ts";

export interface Phase {
  id: string;
  title?: string;
  depends_on?: string[];
  model?: string;
  model_reason?: string;
}

export interface Manifest {
  plan_slug?: string;
  feature_branch?: string;
  max_parallel?: number;
  review_model?: string;
  review_model_reason?: string;
  manual_before?: Array<{ id?: string; title?: string }>;
  manual_after?: Array<{ id?: string; title?: string }>;
  phases: Phase[];
}

export interface RenderOpts {
  manifest: Manifest;
  issue: number;
  designRevision: number;
  planRevision: number;
  repo: string; // owner/name
  title: string;
  mainBranch: string;
  pack: string;
  plansRef: string;
  plansDir: string;
  before: string | null; // before.md, when the plan has one
  sourceRun?: string;
}

// The same rule as gate-build.ts: the first fenced yaml block under "## Implementation manifest".
export function extractManifest(text: string): Manifest {
  const m = text.match(/^## Implementation manifest\s*$[\s\S]*?^```ya?ml\s*$([\s\S]*?)^```\s*$/m);
  if (!m) throw new Error("plan.md has no fenced yaml block under '## Implementation manifest'");
  const manifest = Bun.YAML.parse(m[1]) as Manifest;
  if (!manifest?.phases?.length) throw new Error("the plan's manifest has no phases");
  return manifest;
}

export function waves(manifest: Manifest): Phase[][] {
  const cap = Math.max(1, Math.min(3, manifest.max_parallel ?? 3));
  const placed = new Set<string>();
  const out: Phase[][] = [];
  while (placed.size < manifest.phases.length) {
    const ready = manifest.phases.filter((p) => !placed.has(p.id) && (p.depends_on ?? []).every((d) => placed.has(d)));
    if (!ready.length) throw new Error("dependency cycle in the manifest");
    const wave = ready.slice(0, cap);
    wave.forEach((p) => placed.add(p.id));
    out.push(wave);
  }
  return out;
}

export const TIERS = ["small", "medium", "large"] as const;

// Every phase names the tier its worker runs on, and the plan names the final review's tier (devflow-plan's model rules).
export function validateModels(m: Manifest): void {
  for (const p of m.phases) {
    if (!(TIERS as readonly string[]).includes(p.model ?? "")) {
      throw new Error(`phase '${p.id}': model must be small, medium or large (got ${JSON.stringify(p.model) ?? "nothing"})`);
    }
    if (p.model !== "small" && !String(p.model_reason ?? "").trim()) throw new Error(`phase '${p.id}': model ${p.model} needs a model_reason`);
  }
  if (m.review_model !== "medium" && m.review_model !== "large") {
    throw new Error(`review_model must be medium or large (got ${JSON.stringify(m.review_model) ?? "nothing"})`);
  }
  if (!String(m.review_model_reason ?? "").trim()) throw new Error("review_model needs a review_model_reason");
}

// Archon substitutes `$…` in bash bodies and attention text, so plan-derived text loses its `$`.
const safe = (s: string) => s.replaceAll("$", "＄");
const msgSafe = (s: string) => safe(s).replaceAll("'", "’");

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Ids land in bash bodies, so they must be plain kebab-case; the values quoted with '…' must hold no quote.
function validate(o: RenderOpts, slug: string, branch: string): void {
  if (!Number.isInteger(o.issue) || o.issue < 1 || !SLUG_RE.test(slug)) throw new Error(`invalid issue '${o.issue}': it must be a positive integer`);
  if (o.manifest.plan_slug !== slug) throw new Error(`the manifest's plan_slug '${o.manifest.plan_slug}' must be '${slug}'`);
  if (!branch) throw new Error("the manifest has no feature_branch");
  for (const p of o.manifest.phases) {
    if (typeof p.id !== "string" || !KEBAB.test(p.id)) throw new Error(`invalid phase id '${p.id}': it must match ${KEBAB}`);
  }
  for (const [k, v] of Object.entries({ plansRef: o.plansRef, plansDir: o.plansDir, branch, mainBranch: o.mainBranch })) {
    if (v.includes("'")) throw new Error(`invalid ${k} '${v}': it must not contain a single quote`);
  }
  validateModels(o.manifest);
}

export function renderRunWorkflow(o: RenderOpts): string {
  const slug = slugOf(o.issue);
  const branch = String(o.manifest.feature_branch ?? "");
  validate(o, slug, branch);
  const ws = waves(o.manifest);
  const planPath = fileOf(o.plansDir, o.issue, "plan");
  const before = o.before !== null && (o.manifest.manual_before ?? []).length > 0;
  const child = (name: string) => `${o.pack}:${name}`;
  const started = "$start.output.ok == true";
  const doc: Record<string, any> = {
    name: workflowName(o.issue),
    description: [
      `Build of issue #${o.issue} (https://github.com/${o.repo}/issues/${o.issue}), "${safe(o.title)}": design r${o.designRevision}, plan r${o.planRevision}, planned by run ${o.sourceRun ?? ""}.`,
      `The plan is ${planPath} on the ${o.plansRef} branch.`,
      "No human interaction: stuck phases and decisions are written to deviations.md; phases run up to 3 at a time in their own worktrees.",
      `At the end the issue's docs and deviations.md are committed and pushed, and a complete build opens the PR (${o.pack}:mod-devflow-deliver reviews it, runs the definition of done and local CI, and watches it until a person merges it).`,
    ].join("\n"),
    worktree: { enabled: true },
    returns: "end",
    outcome_field: "complete",
  };
  const nodes: Array<Record<string, any>> = [];
  const ident = { issue: String(o.issue), branch, plans_ref: o.plansRef, plans_dir: o.plansDir, plan_commit: "$start.output.plan_commit", main_branch: o.mainBranch, run_key: "$start.output.run_key" };

  nodes.push({
    id: "start",
    workflow: child("mod-devflow-start"),
    with: { branch, main_branch: o.mainBranch, plans_ref: o.plansRef, plans_dir: o.plansDir, issue: String(o.issue), mode: "build" },
  });
  // Children without isolation run in this checkout and must never overlap (a second one would
  // cancel itself on the checkout's lock), so they are chained: start, trace-start, before, the
  // merges, wrap, deliver, wrap-final.
  nodes.push({ id: "trace-start", workflow: child("mod-devflow-trace"), depends_on: ["start"], with: { issue: String(o.issue), event: "building", branch } });
  if (before) {
    nodes.push({
      id: "before",
      workflow: child("mod-devflow-before-check"),
      depends_on: ["trace-start"],
      with: { plan_commit: "$start.output.plan_commit", plans_ref: o.plansRef, plans_dir: o.plansDir, issue: String(o.issue), run_key: "$start.output.run_key" },
    });
  }

  const phaseNodes: string[] = [];
  const mergeNodes: string[] = [];
  ws.forEach((wave, i) => {
    const k = i + 1;
    for (const p of wave) {
      const id = `phase-${p.id}`;
      phaseNodes.push(id);
      // No `when:` on a dependency: a skipped or failed dependency would fail the node instead of
      // skipping it. The phase block checks its dependencies itself and records itself as skipped.
      nodes.push({
        id,
        workflow: child("mod-devflow-phase"),
        isolation: "worktree",
        depends_on: [k === 1 ? "start" : `merge-${k - 1}`],
        with: {
          plan_ref: o.plansRef,
          plan_path: planPath,
          plan_commit: "$start.output.plan_commit",
          phase: p.id,
          base: k === 1 ? "$start.output.head" : `$merge-${k - 1}.output.head`,
          depends_on: (p.depends_on ?? []).join(","),
          run_key: "$start.output.run_key",
        },
      });
    }
    const titles = Object.fromEntries(wave.map((p) => [p.id, msgSafe(p.title ?? p.id)]));
    nodes.push({
      id: `merge-${k}`,
      workflow: child("mod-devflow-merge"),
      depends_on: [...wave.map((p) => `phase-${p.id}`), ...(k === 1 ? ["trace-start", ...(before ? ["before"] : [])] : [`merge-${k - 1}`])],
      trigger_rule: "all_done",
      when: started,
      with: { slug, phases: wave.map((p) => p.id).join(","), titles: JSON.stringify(titles), run_key: "$start.output.run_key", wave: String(k) },
    });
    mergeNodes.push(`merge-${k}`);
  });

  nodes.push({
    id: "wrap",
    workflow: child("mod-devflow-wrap"),
    depends_on: [...phaseNodes, ...mergeNodes, ...(before ? ["before"] : [])],
    trigger_rule: "all_done",
    when: started,
    with: { stage: "first", mode: "build", ...ident },
  });
  nodes.push({
    id: "deliver",
    workflow: child("mod-devflow-deliver"),
    depends_on: ["wrap"],
    when: "$wrap.output.deliverable == true",
    with: {
      plan_ref: o.plansRef,
      plan_path: planPath,
      plan_commit: "$start.output.plan_commit",
      slug,
      branch,
      title: safe(o.title),
      head: "$wrap.output.head",
      issue: String(o.issue),
      run_key: "$start.output.run_key",
      phases: "plan",
    },
  });
  nodes.push({
    id: "wrap-final",
    workflow: child("mod-devflow-wrap"),
    depends_on: ["wrap", "deliver"],
    trigger_rule: "all_done",
    when: started,
    with: { stage: "final", mode: "build", ...ident },
  });
  nodes.push({
    id: "end",
    depends_on: ["wrap-final"],
    bash: [
      "r=$wrap-final.output",
      "python3 - \"$r\" <<'PY'",
      "import json, sys",
      "r = json.loads(sys.argv[1])",
      'out = {k: r.get(k) for k in ["complete", "stuck_phases", "branch", "pr_url", "deviations_url", "pushed"]}',
      "print(json.dumps(out))",
      'if out["complete"] is not True:',
      `    print(f"devflow: ${workflowName(o.issue)} is not complete: see deviations.md ({out['deviations_url']})", file=sys.stderr)`,
      "    sys.exit(1)",
      "PY",
      "",
    ].join("\n"),
    output_format: {
      type: "object",
      properties: {
        complete: { type: "boolean" },
        stuck_phases: { type: "array", items: { type: "string" } },
        branch: { type: "string" },
        pr_url: { type: "string" },
        deviations_url: { type: "string" },
        pushed: { type: "array", items: { type: "string" } },
      },
      required: ["complete", "stuck_phases", "branch", "pr_url", "deviations_url", "pushed"],
    },
  });

  doc.nodes = nodes;
  return Bun.YAML.stringify(doc, null, 2);
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    const file = argv.shift();
    if (!file) {
      throw new Error(
        "usage: render-run.ts <plan.md> --issue N --design-revision D --plan-revision P --repo O/R --title T --main M --pack P [--before file] [--plans-ref plans] [--plans-dir plans]",
      );
    }
    const flag: Record<string, string> = {};
    for (let i = 0; i < argv.length; i += 2) flag[argv[i].replace(/^--/, "")] = argv[i + 1] ?? "";
    for (const r of ["issue", "design-revision", "plan-revision", "repo", "title", "main", "pack"]) if (!flag[r]) throw new Error(`missing --${r}`);
    const read = (f?: string) => (f ? readFileSync(f, "utf8") : null);
    process.stdout.write(
      renderRunWorkflow({
        manifest: extractManifest(readFileSync(file, "utf8")),
        issue: Number(flag.issue),
        designRevision: Number(flag["design-revision"]),
        planRevision: Number(flag["plan-revision"]),
        repo: flag.repo,
        title: flag.title,
        mainBranch: flag.main,
        pack: flag.pack,
        plansRef: flag["plans-ref"] || "plans",
        plansDir: flag["plans-dir"] || "plans",
        before: read(flag.before),
        sourceRun: process.env.WORKFLOW_ID ?? "",
      }),
    );
  } catch (e) {
    console.error(`devflow: ${(e as Error).message}`);
    process.exit(1);
  }
}
