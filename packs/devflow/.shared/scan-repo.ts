// devflow-init's deterministic scan of the repository (no AI): the existing profile (or a legacy
// .claude/toolkit.yaml, converted), the default branch, merge style, branch names, docs, candidate
// commands, stacks, dispatchable workflows, the CI jobs local CI would run, and what devflow
// scaffolding exists. Writes $ARTIFACTS_DIR/scan.json with a complete draft profile in which every
// key carries its provenance (existing, detected or default); prints a one-line summary.
// Env: INPUTS_MAIN_BRANCH (preflight's), INPUTS_HINT.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { listJobs } from "./ci-local.ts";
import { LEGACY_PROFILE_PATH as LEGACY_PATH, PROFILE_PATH, artifactsDir, input, isEntry, run } from "./util.ts";

export type Source = "existing" | "detected" | "default";
type Provenance = Record<string, Source>;

// The legacy toolkit profile in today's schema: version 1, without toolkit, models and docs.plan_dir.
export function convertLegacy(p: any): any {
  const out = { version: 1, ...(p ?? {}) };
  delete out.toolkit;
  delete out.models;
  if (out.docs && typeof out.docs === "object") {
    out.docs = { ...out.docs };
    delete out.docs.plan_dir;
  }
  out.version = 1;
  return out;
}

const exists = (root: string, p: string) => existsSync(join(root, p));
const read = (root: string, p: string) => (exists(root, p) ? readFileSync(join(root, p), "utf8") : "");
const files = (root: string, dir: string) => (exists(root, dir) && statSync(join(root, dir)).isDirectory() ? readdirSync(join(root, dir)).sort() : []);

export function detectStacks(root: string): string[] {
  const stacks: string[] = [];
  if (exists(root, "go.mod")) stacks.push("go");
  if (exists(root, "pyproject.toml") || exists(root, "setup.py")) stacks.push("python");
  if (exists(root, "Package.swift")) stacks.push("swift");
  return stacks;
}

// Candidate verify commands from the repository's own files, as { fast, dod }.
export function detectCommands(root: string): { fast: string[]; dod: string[] } {
  const fast: string[] = [];
  const dod: string[] = [];
  const pkg = read(root, "package.json");
  if (pkg) {
    let scripts: Record<string, string> = {};
    try {
      scripts = JSON.parse(pkg).scripts ?? {};
    } catch {}
    const pm = exists(root, "bun.lockb") || exists(root, "bun.lock") ? "bun run" : exists(root, "pnpm-lock.yaml") ? "pnpm run" : exists(root, "yarn.lock") ? "yarn" : "npm run";
    for (const s of ["lint", "typecheck", "type-check", "check"]) if (scripts[s]) fast.push(`${pm} ${s}`);
    if (scripts.test) dod.push(`${pm} test`);
    if (scripts.build) dod.push(`${pm} build`);
  }
  const make = read(root, "Makefile");
  if (make) {
    const targets = new Set([...make.matchAll(/^([A-Za-z][\w-]*):/gm)].map((m) => m[1]));
    for (const t of ["lint", "check", "fmt-check", "vet"]) if (targets.has(t)) fast.push(`make ${t}`);
    for (const t of ["test", "test-all"]) if (targets.has(t)) dod.push(`make ${t}`);
  }
  const py = read(root, "pyproject.toml");
  if (py) {
    if (/^\[tool\.ruff/m.test(py)) fast.push("ruff check .");
    if (/^\[tool\.mypy/m.test(py)) fast.push("mypy .");
    if (/^\[tool\.pytest/m.test(py) || exists(root, "tests")) dod.push("pytest");
  }
  if (exists(root, "go.mod")) {
    fast.push("go vet ./...");
    dod.push("go test ./...");
  }
  if (exists(root, "Package.swift")) dod.push("swift test");
  for (const f of files(root, "scripts")) if (/^test[\w.-]*\.sh$/.test(f)) dod.push(`scripts/${f}`);
  const uniq = (xs: string[]) => [...new Set(xs)];
  const d = uniq(dod);
  return { fast: uniq(fast).filter((c) => !d.includes(c)), dod: d };
}

// <type>/<rest> branch names: the types used, and the share of names that follow the pattern.
export function detectBranches(names: string[]): { types: string[]; pattern: string | null } {
  const counts = new Map<string, number>();
  let typed = 0;
  for (const n of names) {
    const m = /^([a-z]+)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(n);
    if (!m) continue;
    typed++;
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  const types = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  return { types, pattern: typed > 0 && typed * 2 >= names.length ? "<type>/<kebab-case>" : null };
}

function workflowsOf(root: string): { file: string; doc: any }[] {
  const dir = ".github/workflows";
  return files(root, dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => {
      try {
        return { file: `${dir}/${f}`, doc: Bun.YAML.parse(read(root, `${dir}/${f}`)) };
      } catch {
        return { file: `${dir}/${f}`, doc: null };
      }
    });
}

export function detectDispatchable(root: string): string[] {
  return workflowsOf(root)
    .filter(({ doc }) => {
      const on = doc?.on;
      if (typeof on === "string") return on === "workflow_dispatch";
      if (Array.isArray(on)) return on.includes("workflow_dispatch");
      return !!on && typeof on === "object" && "workflow_dispatch" in on;
    })
    .map(({ file }) => file);
}

function leftovers(root: string): string[] {
  const out: string[] = [];
  if (exists(root, LEGACY_PATH)) out.push(LEGACY_PATH);
  if (exists(root, ".claude/hooks/devflow.sh")) out.push(".claude/hooks/devflow.sh");
  const settings = read(root, ".claude/settings.json");
  if (/devflow|toolkit/.test(settings)) out.push(".claude/settings.json (hook entries)");
  return out;
}

function remoteBranches(): string[] {
  const names: string[] = [];
  const ls = run(["git", "ls-remote", "--heads", "origin"]);
  if (ls.code === 0) for (const l of ls.out.split("\n")) if (l.includes("refs/heads/")) names.push(l.split("refs/heads/")[1].trim());
  const prs = run(["gh", "pr", "list", "--state", "merged", "--json", "headRefName", "--limit", "50"]);
  if (prs.code === 0) {
    try {
      for (const p of JSON.parse(prs.out || "[]")) names.push(String(p.headRefName ?? ""));
    } catch {}
  }
  return names.filter(Boolean);
}

function mergeStyle(): "merge-commit" | "squash" | null {
  const r = run(["gh", "api", "repos/{owner}/{repo}"]);
  if (r.code !== 0) return null;
  try {
    const d = JSON.parse(r.out);
    if (d.allow_squash_merge && !d.allow_merge_commit) return "squash";
    if (d.allow_merge_commit && !d.allow_squash_merge) return "merge-commit";
  } catch {}
  return null;
}

export interface Scan {
  existing: { source: "profile" | "legacy" | "none"; profile: any };
  draft: any;
  provenance: Provenance;
  candidates: { fast: string[]; dod: string[]; stacks: string[]; dispatchable: string[]; ci_local: { workflow: string; job: string; runs: boolean; reason: string }[]; branch_types: string[] };
  present: { plans_branch: boolean; archon_config: boolean; rulings: boolean };
  leftovers: string[];
  hint: string;
}

export interface Detected {
  mainBranch: string;
  branchNames: string[];
  mergeStyle: "merge-commit" | "squash" | null;
  plansBranch: boolean;
}

export function scanRepo(root: string, det: Detected, hint = ""): Scan {
  let source: Scan["existing"]["source"] = "none";
  let existing: any = null;
  if (exists(root, PROFILE_PATH)) {
    source = "profile";
    try {
      existing = Bun.YAML.parse(read(root, PROFILE_PATH)) ?? {};
    } catch {
      existing = {};
    }
  } else if (exists(root, LEGACY_PATH)) {
    source = "legacy";
    try {
      existing = convertLegacy(Bun.YAML.parse(read(root, LEGACY_PATH)));
    } catch {
      existing = convertLegacy({});
    }
  }

  const draft: any = { version: 1 };
  const prov: Provenance = { version: "default" };
  const get = (o: any, path: string) => path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
  const set = (path: string, value: unknown, src: Source) => {
    const keys = path.split(".");
    let o = draft;
    for (const k of keys.slice(0, -1)) o = o[k] ??= {};
    o[keys[keys.length - 1]] = value;
    prov[path] = src;
  };
  // The existing value wins; then what was detected; then the default (undefined: leave the key out).
  const pick = (path: string, detected: unknown, dflt?: unknown) => {
    const e = get(existing, path);
    if (e !== undefined && e !== null) set(path, e, "existing");
    else if (detected !== undefined && detected !== null && !(Array.isArray(detected) && detected.length === 0)) set(path, detected, "detected");
    else if (dflt !== undefined) set(path, dflt, "default");
  };

  const cmds = detectCommands(root);
  const branches = detectBranches(det.branchNames);
  const docs = ["README.md", "CONTRIBUTING.md"].filter((f) => exists(root, f));
  const adr = ["docs/adr", "doc/adr", "adr", "docs/decisions"].find((d) => exists(root, d));
  const changelog = ["CHANGELOG.md", "CHANGES.md"].find((f) => exists(root, f));
  const dispatchable = detectDispatchable(root);

  pick("project.name", basename(run(["git", "rev-parse", "--show-toplevel"], { cwd: root }).out.trim() || root));
  pick("docs.must_read", docs, ["README.md"]);
  pick("docs.adr_dir", adr);
  pick("docs.changelog", changelog);
  pick("git.main_branch", det.mainBranch, "main");
  pick("git.branch_pattern", branches.pattern, "<type>/<kebab-case>");
  pick("git.branch_types", branches.types.length ? branches.types : null, ["feat", "fix", "docs", "chore"]);
  pick("git.merge_style", det.mergeStyle);
  pick("verify.fast", cmds.fast, []);
  pick("verify.dod", cmds.dod, []);
  for (const k of ["dod_conditional", "dod_manual", "dod_doc", "ci_local"]) pick(`verify.${k}`, undefined);
  pick("ci.dispatchable", null);
  pick("stacks", detectStacks(root), []);
  pick("plans", null);
  pick("project_steward", null);
  // Keys of the existing profile this scan does not know stay as they are.
  for (const [k, v] of Object.entries(existing ?? {})) if (!(k in draft)) set(k, v, "existing");

  const ci = listJobs(root).map((j) => ({ workflow: j.workflow, job: j.job, runs: j.status === "plan", reason: j.reason }));
  return {
    existing: { source, profile: existing },
    draft,
    provenance: prov,
    candidates: { ...cmds, stacks: detectStacks(root), dispatchable, ci_local: ci, branch_types: branches.types },
    present: { plans_branch: det.plansBranch, archon_config: exists(root, ".archon/config.yaml"), rulings: exists(root, ".archon/devflow/policy/rulings.md") },
    leftovers: leftovers(root),
    hint,
  };
}

if (isEntry(import.meta)) {
  const plansRef = (() => {
    try {
      return (Bun.YAML.parse(read(".", PROFILE_PATH)) as any)?.plans?.ref || "plans";
    } catch {
      return "plans";
    }
  })();
  const det: Detected = {
    mainBranch: input("main_branch", false) || "main",
    branchNames: remoteBranches(),
    mergeStyle: mergeStyle(),
    plansBranch: run(["git", "ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${plansRef}`]).code === 0,
  };
  const scan = scanRepo(".", det, input("hint", false));
  const file = join(artifactsDir(), "scan.json");
  writeFileSync(file, JSON.stringify(scan, null, 2) + "\n");
  console.log(JSON.stringify({ scan_file: file, source: scan.existing.source, stacks: scan.candidates.stacks, leftovers: scan.leftovers }));
}
