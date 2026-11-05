// Renders the devflow-run-<slug> workflow that runs a published plan's phases (up to 3 at a time, each
// in its own worktree) and then hands over to devflow-deliver. A pure function plus a small CLI for tests.
import { readFileSync } from "node:fs";

export interface Phase {
  id: string;
  title?: string;
  depends_on?: string[];
}

export interface Manifest {
  plan_slug?: string;
  feature_branch?: string;
  max_parallel?: number;
  manual_before?: Array<{ id?: string; title?: string }>;
  manual_after?: Array<{ id?: string; title?: string }>;
  phases: Phase[];
}

export interface RenderOpts {
  manifest: Manifest;
  slug: string;
  branch: string;
  title: string;
  mainBranch: string;
  pack: string;
  plansRef: string;
  plansDir: string;
  prerequisites: string | null;
  after: string | null;
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

// Archon substitutes `$…` in bash bodies and attention text, so plan-derived text loses its `$`.
const safe = (s: string) => s.replaceAll("$", "＄");
const msgSafe = (s: string) => safe(s).replaceAll("'", "’");

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Ids and the slug land in bash bodies, so they must be plain kebab-case; the values quoted with '…' must hold no quote.
function validate(o: RenderOpts): void {
  if (!KEBAB.test(o.slug)) throw new Error(`invalid slug '${o.slug}': it must match ${KEBAB}`);
  for (const p of o.manifest.phases) {
    if (typeof p.id !== "string" || !KEBAB.test(p.id)) throw new Error(`invalid phase id '${p.id}': it must match ${KEBAB}`);
  }
  for (const [k, v] of Object.entries({ plansRef: o.plansRef, plansDir: o.plansDir, branch: o.branch, mainBranch: o.mainBranch })) {
    if (v.includes("'")) throw new Error(`invalid ${k} '${v}': it must not contain a single quote`);
  }
}

export function renderRunWorkflow(o: RenderOpts): string {
  validate(o);
  const ws = waves(o.manifest);
  const planPath = `${o.plansDir}/${o.slug}/plan.md`;
  const doc: Record<string, any> = {
    name: `devflow-run-${o.slug}`,
    description: [
      `Implementation of the devflow plan ${o.slug} ("${safe(o.title)}") from run ${o.sourceRun ?? ""}.`,
      `The plan is ${planPath} on the ${o.plansRef} branch.`,
      `Phases run up to 3 at a time in their own worktrees, then ${o.pack}:devflow-deliver reviews, opens the PR and watches it.`,
    ].join("\n"),
    worktree: { enabled: true },
    returns: "result",
    outcome_field: "merged",
  };
  const nodes: Array<Record<string, any>> = [];

  if (o.prerequisites !== null) {
    const items = (o.manifest.manual_before ?? []).map((i) => `- ${safe(i.title ?? i.id ?? "")}`).join("\n");
    nodes.push({
      id: "prerequisites",
      wait: {
        attention:
          `Before implementing ${safe(o.title)}, do these steps (full steps: ${o.plansDir}/${o.slug}/prerequisites.md on the ${o.plansRef} branch):\n\n` +
          `${items}\n\nApprove when they are done; reject to stop.`,
        form: "approval",
        labels: { workflow: "devflow-run", stage: "prerequisites" },
      },
    });
    nodes.push({
      id: "stop-at-prerequisites",
      depends_on: ["prerequisites"],
      when: "$prerequisites.output.decision == 'reject'",
      cancel: "Stopped before implementation: the prerequisites were not confirmed.",
    });
  }

  if (o.after !== null) {
    const b64 = Buffer.from(o.after).toString("base64");
    nodes.push({
      id: "after-steps",
      bash: `printf '%s' '${b64}' | base64 -d > "$ARTIFACTS_DIR/after.md"\necho "after.md written"\n`,
    });
  }

  const start: Record<string, any> = { id: "start" };
  if (o.prerequisites !== null) {
    start.depends_on = ["prerequisites"];
    start.when = "$prerequisites.output.decision == 'approve'";
  }
  start.bash = [
    "set -euo pipefail",
    "exec 3>&1 1>&2", // stdout must be the JSON only; git's own messages go to stderr
    `B='${o.branch}'; M='${o.mainBranch}'; PR='${o.plansRef}'`,
    'git fetch origin "$M"',
    'git fetch origin "$PR"',
    "PC=$(git rev-parse FETCH_HEAD)",
    'if git ls-remote --exit-code --heads origin "$B" >/dev/null 2>&1; then',
    '  git fetch origin "$B"',
    '  if git rev-parse --verify --quiet "refs/heads/$B" >/dev/null; then git switch "$B"; git merge --ff-only "origin/$B"; else git switch -c "$B" --track "origin/$B"; fi',
    'elif git rev-parse --verify --quiet "refs/heads/$B" >/dev/null; then git switch "$B"',
    'else git switch -c "$B" "origin/$M"; fi',
    `printf '{"head":"%s","plan_commit":"%s"}\\n' "$(git rev-parse HEAD)" "$PC" >&3`,
    "",
  ].join("\n");
  start.output_format = {
    type: "object",
    properties: { head: { type: "string" }, plan_commit: { type: "string" } },
    required: ["head", "plan_commit"],
  };
  nodes.push(start);

  ws.forEach((wave, i) => {
    const k = i + 1;
    const prev = k === 1 ? "$start.output.head" : `$merge-${k - 1}.output.head`;
    for (const p of wave) {
      nodes.push({
        id: `phase-${p.id}`,
        workflow: `${o.pack}:devflow-phase`,
        isolation: "worktree",
        depends_on: [k === 1 ? "start" : `merge-${k - 1}`],
        with: {
          plan_ref: o.plansRef,
          plan_path: planPath,
          plan_commit: "$start.output.plan_commit",
          phase: p.id,
          base: prev,
        },
      });
    }
    const lines = ["set -euo pipefail", "exec 3>&1 1>&2"];
    wave.forEach((p, j) => {
      const h = `h${j + 1}`;
      const t = msgSafe(p.title ?? p.id);
      lines.push(
        `${h}=$phase-${p.id}.output.head`,
        `if git merge-base --is-ancestor "$${h}" HEAD; then echo "${p.id} already merged" >&2`,
        `else git merge --no-ff "$${h}" -m 'Merge ${o.slug} ${p.id}: ${t}' -m 'Plan-Phase: ${o.slug}/${p.id}' || { git merge --abort; echo "devflow: merging ${p.id} conflicts; its touches overlap another phase" >&2; exit 1; }`,
        "fi",
      );
    });
    lines.push(`printf '{"head":"%s"}\\n' "$(git rev-parse HEAD)" >&3`, "");
    nodes.push({
      id: `merge-${k}`,
      depends_on: wave.map((p) => `phase-${p.id}`),
      bash: lines.join("\n"),
      output_format: { type: "object", properties: { head: { type: "string" } }, required: ["head"] },
    });
  });

  const deps = [`merge-${ws.length}`];
  if (o.after !== null) deps.push("after-steps");
  nodes.push({
    id: "deliver",
    workflow: `${o.pack}:devflow-deliver`,
    depends_on: deps,
    with: {
      plan_ref: o.plansRef,
      plan_path: planPath,
      plan_commit: "$start.output.plan_commit",
      slug: o.slug,
      branch: o.branch,
      title: safe(o.title),
      head: `$merge-${ws.length}.output.head`,
    },
  });
  nodes.push({
    id: "result",
    depends_on: ["deliver"],
    bash: `m=$deliver.output.merged; printf '{"merged":%s}\\n' "$m"\n`,
    output_format: { type: "object", properties: { merged: { type: "boolean" } }, required: ["merged"] },
  });

  doc.nodes = nodes;
  return Bun.YAML.stringify(doc, null, 2);
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    const file = argv.shift();
    if (!file) throw new Error("usage: render-run.ts <plan.md> --slug S --branch B --title T --main M --pack P [--prerequisites file] [--after file] [--plans-ref plans] [--plans-dir plans]");
    const flag: Record<string, string> = {};
    for (let i = 0; i < argv.length; i += 2) flag[argv[i].replace(/^--/, "")] = argv[i + 1] ?? "";
    for (const r of ["slug", "branch", "title", "main", "pack"]) if (!flag[r]) throw new Error(`missing --${r}`);
    const read = (f?: string) => (f ? readFileSync(f, "utf8") : null);
    process.stdout.write(
      renderRunWorkflow({
        manifest: extractManifest(readFileSync(file, "utf8")),
        slug: flag.slug,
        branch: flag.branch,
        title: flag.title,
        mainBranch: flag.main,
        pack: flag.pack,
        plansRef: flag["plans-ref"] || "plans",
        plansDir: flag["plans-dir"] || "plans",
        prerequisites: read(flag.prerequisites),
        after: read(flag.after),
        sourceRun: process.env.WORKFLOW_ID ?? "",
      }),
    );
  } catch (e) {
    console.error(`devflow: ${(e as Error).message}`);
    process.exit(1);
  }
}
