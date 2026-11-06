// Renders the build-issue-<n> workflow that runs a published plan's phases (up to 3 at a time, each
// in its own worktree) and then hands over to mod-devflow-deliver. A pure function plus a small CLI for tests.
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
  after: string | null; // after.md, when the plan has one
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
  const prerequisites = o.before !== null && (o.manifest.manual_before ?? []).length > 0;
  const afterSteps = o.after !== null && (o.manifest.manual_after ?? []).length > 0;
  const doc: Record<string, any> = {
    name: workflowName(o.issue),
    description: [
      `Build of issue #${o.issue} (https://github.com/${o.repo}/issues/${o.issue}), "${safe(o.title)}": design r${o.designRevision}, plan r${o.planRevision}, planned by run ${o.sourceRun ?? ""}.`,
      `The plan is ${planPath} on the ${o.plansRef} branch.`,
      `Phases run up to 3 at a time in their own worktrees. The build pauses ${prerequisites ? "for the steps in before.md and " : ""}when another worktree holds the feature branch.`,
      `Then ${o.pack}:mod-devflow-deliver reviews the change, opens one PR with the code and watches it until a person merges it.`,
    ].join("\n"),
    worktree: { enabled: true },
    returns: "result",
    outcome_field: "merged",
  };
  const nodes: Array<Record<string, any>> = [];

  if (prerequisites) {
    const items = (o.manifest.manual_before ?? []).map((i) => `- ${safe(i.title ?? i.id ?? "")}`).join("\n");
    nodes.push({
      id: "prerequisites",
      wait: {
        attention:
          `Before implementing ${safe(o.title)}, do these steps (full steps: ${fileOf(o.plansDir, o.issue, "before")} on the ${o.plansRef} branch):\n\n` +
          `${items}\n\nApprove when they are done; reject to stop.`,
        form: "approval",
        labels: { workflow: "build-issue", stage: "prerequisites" },
      },
    });
    nodes.push({
      id: "stop-at-prerequisites",
      depends_on: ["prerequisites"],
      when: "$prerequisites.output.decision == 'reject'",
      cancel: "Stopped before implementation: the prerequisites were not confirmed.",
    });
  }

  if (afterSteps) {
    const b64 = Buffer.from(o.after!).toString("base64");
    nodes.push({
      id: "after-steps",
      bash: `printf '%s' '${b64}' | base64 -d > "$ARTIFACTS_DIR/after.md"\necho "after.md written"\n`,
    });
  }

  // Another worktree (a failed earlier run's) can hold the feature branch. Never remove one unasked: report it,
  // ask a person, then remove only on approval and never with --force.
  const findHeld = [
    `B='${branch}'`,
    `awk -v b="refs/heads/$B" -v me="$(git rev-parse --show-toplevel)" '$1=="worktree"{w=$2} $1=="branch" && $2==b && w!=me{print w}' <(git worktree list --porcelain)`,
  ];
  const gate: Record<string, any> = {};
  if (prerequisites) {
    gate.depends_on = ["prerequisites"];
    gate.when = "$prerequisites.output.decision == 'approve'";
  }
  nodes.push({
    id: "worktree-check",
    ...gate,
    bash: [
      "set -euo pipefail",
      "exec 3>&1 1>&2",
      ...findHeld.slice(0, 1),
      `git fetch origin "$B" 2>/dev/null || true`,
      `HELD=$(${findHeld[1]})`,
      'Q=""',
      'if [ -n "$HELD" ]; then',
      '  AHEAD=$(git rev-list --count "origin/$B..refs/heads/$B" 2>/dev/null || echo unknown)',
      '  Q="The branch $B is already checked out in another worktree, probably left by an earlier run. Approving removes these worktrees (git worktree remove, never forced; a worktree with uncommitted changes is refused and the run fails). Do not approve if another run is still using one.\\n\\nCommits on the branch not on origin: $AHEAD"',
      '  while IFS= read -r w; do Q="$Q\\n\\n$w\\nuncommitted paths: $(git -C "$w" status --porcelain | wc -l | tr -d \' \')"; done <<< "$HELD"',
      "fi",
      `H="$HELD" Q="$Q" python3 -c 'import json,os; print(json.dumps({"held": os.environ["H"], "question": os.environ["Q"].replace("\\\\n", "\\n")}))' >&3`,
      "",
    ].join("\n"),
    output_format: {
      type: "object",
      properties: { held: { type: "string" }, question: { type: "string" } },
      required: ["held", "question"],
    },
  });
  nodes.push({
    id: "confirm-worktree-removal",
    depends_on: ["worktree-check"],
    when: "$worktree-check.output.held != ''",
    wait: {
      attention: "$worktree-check.output.question",
      form: "approval",
      labels: { workflow: "build-issue", stage: "worktree-removal" },
    },
  });
  nodes.push({
    id: "stop-at-worktrees",
    depends_on: ["confirm-worktree-removal"],
    when: "$confirm-worktree-removal.output.decision == 'reject'",
    cancel: "Stopped before implementation: the worktree holding the feature branch was not removed.",
  });
  nodes.push({
    id: "remove-worktrees",
    depends_on: ["confirm-worktree-removal"],
    when: "$confirm-worktree-removal.output.decision == 'approve'",
    bash: [
      "set -euo pipefail",
      ...findHeld.slice(0, 1),
      `HELD=$(${findHeld[1]})`,
      'while IFS= read -r w; do [ -n "$w" ] && git worktree remove "$w" && echo "removed $w" >&2; done <<< "$HELD"',
      "",
    ].join("\n"),
  });

  const start: Record<string, any> = { id: "start" };
  start.depends_on = [
    ...(prerequisites ? ["prerequisites"] : []),
    "worktree-check",
    "confirm-worktree-removal",
    "stop-at-worktrees",
    "remove-worktrees",
  ];
  start.trigger_rule = "none_failed_min_one_success";
  if (prerequisites) start.when = "$prerequisites.output.decision == 'approve'";
  start.bash = [
    "set -euo pipefail",
    "exec 3>&1 1>&2", // stdout must be the JSON only; git's own messages go to stderr
    `B='${branch}'; M='${o.mainBranch}'; PR='${o.plansRef}'`,
    'git fetch origin "$M"',
    'git fetch origin "$PR"',
    "PC=$(git rev-parse FETCH_HEAD)",
    'HELD=$(git worktree list --porcelain | awk -v b="refs/heads/$B" -v me="$(git rev-parse --show-toplevel)" \'$1=="worktree"{w=$2} $1=="branch" && $2==b && w!=me{print w}\')',
    'if [ -n "$HELD" ]; then echo "devflow: branch $B is already checked out in another worktree: $HELD" >&2; echo "devflow: if no run is using it and it has nothing unpushed, remove it with: git worktree remove $HELD" >&2; exit 1; fi',
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
  nodes.push({
    id: "trace-start",
    workflow: `${o.pack}:mod-devflow-trace`,
    depends_on: ["start"],
    with: { issue: String(o.issue), event: "building", branch },
  });

  ws.forEach((wave, i) => {
    const k = i + 1;
    const prev = k === 1 ? "$start.output.head" : `$merge-${k - 1}.output.head`;
    for (const p of wave) {
      nodes.push({
        id: `phase-${p.id}`,
        workflow: `${o.pack}:mod-devflow-phase`,
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
        `else git merge --no-ff "$${h}" -m 'Merge ${slug} ${p.id}: ${t}' -m 'Plan-Phase: ${slug}/${p.id}' || { git merge --abort; echo "devflow: merging ${p.id} conflicts; its touches overlap another phase" >&2; exit 1; }`,
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
  if (afterSteps) deps.push("after-steps");
  nodes.push({
    id: "deliver",
    workflow: `${o.pack}:mod-devflow-deliver`,
    depends_on: deps,
    with: {
      plan_ref: o.plansRef,
      plan_path: planPath,
      plan_commit: "$start.output.plan_commit",
      slug,
      branch,
      title: safe(o.title),
      head: `$merge-${ws.length}.output.head`,
      issue: String(o.issue),
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
    if (!file) {
      throw new Error(
        "usage: render-run.ts <plan.md> --issue N --design-revision D --plan-revision P --repo O/R --title T --main M --pack P [--before file] [--after file] [--plans-ref plans] [--plans-dir plans]",
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
        after: read(flag.after),
        sourceRun: process.env.WORKFLOW_ID ?? "",
      }),
    );
  } catch (e) {
    console.error(`devflow: ${(e as Error).message}`);
    process.exit(1);
  }
}
