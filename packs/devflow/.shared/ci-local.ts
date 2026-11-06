// Runs the repository's own GitHub Actions jobs in the worktree, mechanically (no AI, no network
// credentials): the local-CI step of the definition of done (mod-devflow-dod).
//
//   bun ci-local.ts           run the jobs, print { status, ran, failed, skipped, dirty }
//   bun ci-local.ts --list    print the plan (which jobs would run, which are skipped and why), run nothing
//
// Profile verify.ci_local: enabled (default true), jobs (auto | [names]), skip_jobs, timeout_minutes
// (default 20 per job), env. `auto` runs every job of a workflow triggered on push or pull_request
// that runs on ubuntu-*, has no services, container or job-level uses, reads no secret or
// github.token, and whose workflow is not in ci.dispatchable. Only a matrix's first combination runs.
// status: red when a job failed, skipped when no job was runnable, else green.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { artifactsDir, isEntry, list, projectEnv, rawProfile, run, tail } from "./util.ts";
import { writeOutcome } from "./outcomes.ts";

export interface StepResult {
  name: string;
  status: "pass" | "fail" | "skip";
  exit: number | null;
  reason?: string;
  tail?: string;
}

export interface JobResult {
  workflow: string;
  job: string;
  status: "pass" | "fail" | "skip" | "plan";
  reason: string;
  steps: StepResult[];
}

export interface CiResult {
  status: "green" | "red" | "skipped";
  reason: string;
  ran: JobResult[];
  failed: JobResult[];
  skipped: JobResult[];
  dirty: string[];
}

interface Config {
  enabled: boolean;
  jobs: "auto" | string[];
  skip: string[];
  timeoutMs: number;
  env: Record<string, string>;
  dispatchable: string[];
}

export function config(root = "."): Config {
  const p = rawProfile(root);
  // The doctor reads this from a profile that may not have been validated: take only well-shaped values.
  const map = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const c = map(p?.verify?.ci_local);
  return {
    enabled: c.enabled !== false,
    jobs: Array.isArray(c.jobs) ? c.jobs.map(String) : "auto",
    skip: list(c.skip_jobs).map(String),
    timeoutMs: (Number(c.timeout_minutes) || 20) * 60_000,
    env: Object.fromEntries(Object.entries(map(c.env)).map(([k, v]) => [k, String(v)])),
    dispatchable: list(p?.ci?.dispatchable).map((d) => basename(String(d?.workflow ?? ""))),
  };
}

// The events a workflow's `on:` names (string, list or map form). Bun.YAML keeps the key `on`.
function events(on: unknown): string[] {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.map(String);
  if (on && typeof on === "object") return Object.keys(on);
  return [];
}

const SECRET_RE = /\$\{\{\s*(secrets\.|github\.token)/;
const EXPR_RE = /\$\{\{\s*([^}]*?)\s*\}\}/g;
const SECRET_ENV_RE = /SECRET|TOKEN|PASSWORD/i;

// A step's environment: the host's and the given layers, minus every credential name, plus CI=true.
export function cleanEnv(...layers: Record<string, string | undefined>[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const layer of [process.env, ...layers]) for (const [k, v] of Object.entries(layer)) if (v !== undefined && !SECRET_ENV_RE.test(k)) out[k] = v;
  return { ...out, CI: "true" };
}

interface Planned {
  file: string;
  id: string;
  job: any;
  workflow: any;
  reason: string; // empty: runnable
}

export function plan(root = ".", cfg = config(root)): Planned[] {
  const dir = join(root, ".github", "workflows");
  if (!existsSync(dir)) return [];
  const out: Planned[] = [];
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    let wf: any;
    try {
      wf = Bun.YAML.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      out.push({ file, id: "*", job: {}, workflow: {}, reason: "the workflow file does not parse" });
      continue;
    }
    const jobs = wf?.jobs && typeof wf.jobs === "object" ? wf.jobs : {};
    const evs = events(wf?.on);
    for (const [id, job] of Object.entries<any>(jobs)) {
      const named = cfg.jobs !== "auto" && cfg.jobs.includes(id);
      let reason = "";
      const text = JSON.stringify(job);
      if (cfg.jobs !== "auto" && !named) reason = "not listed in verify.ci_local.jobs";
      else if (cfg.skip.includes(id)) reason = "listed in verify.ci_local.skip_jobs";
      else if (!named && !evs.some((e) => e === "push" || e === "pull_request")) reason = "the workflow runs on neither push nor pull_request";
      else if (!named && cfg.dispatchable.includes(file)) reason = "the workflow is in ci.dispatchable";
      else if (typeof job?.["runs-on"] !== "string" || !job["runs-on"].startsWith("ubuntu-")) reason = `runs-on ${JSON.stringify(job?.["runs-on"] ?? null)} is not ubuntu-*`;
      else if (job.services) reason = "the job needs services";
      else if (job.container) reason = "the job runs in a container";
      else if (job.uses) reason = "the job calls a reusable workflow";
      else if (SECRET_RE.test(text)) reason = "the job reads a secret or github.token";
      out.push({ file, id, job, workflow: wf, reason });
    }
  }
  return out;
}

// The first matrix combination: { key: value } of every list-valued key.
function firstMatrix(job: any): Record<string, string> {
  const m = job?.strategy?.matrix;
  if (!m || typeof m !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries<any>(m)) {
    if (k === "include" || k === "exclude") continue;
    if (Array.isArray(v) && v.length) out[k] = typeof v[0] === "object" ? JSON.stringify(v[0]) : String(v[0]);
  }
  if (Object.keys(out).length === 0 && Array.isArray(m.include) && m.include[0]) for (const [k, v] of Object.entries(m.include[0])) out[k] = String(v);
  return out;
}

// Substitutes ${{ matrix.* }}, ${{ env.* }} and ${{ runner.os }}; returns null when anything else is left.
export function resolve(text: string, matrix: Record<string, string>, env: Record<string, string>): string | null {
  let unresolved = false;
  const out = text.replace(EXPR_RE, (whole, expr: string) => {
    const m = /^matrix\.([A-Za-z0-9_-]+)$/.exec(expr);
    if (m && m[1] in matrix) return matrix[m[1]];
    const e = /^env\.([A-Za-z0-9_]+)$/.exec(expr);
    if (e) return env[e[1]] ?? "";
    if (expr === "runner.os") return "Linux";
    unresolved = true;
    return whole;
  });
  return unresolved ? null : out;
}

const strEnv = (o: any): Record<string, string> => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, String(v)]));

function runJob(p: Planned, cfg: Config, root: string): JobResult {
  const name = basename(p.file);
  const result: JobResult = { workflow: name, job: p.id, status: "pass", reason: "", steps: [] };
  const matrix = firstMatrix(p.job);
  const layers = [projectEnv(), strEnv(p.workflow?.env), strEnv(p.job.env), cfg.env];
  const steps: any[] = Array.isArray(p.job.steps) ? p.job.steps : [];
  // Decide every step before running any, so a job with an unresolvable step is skipped whole.
  const prepared = steps.map((s, i) => {
    const label = String(s?.name ?? s?.uses ?? `step ${i + 1}`);
    if (s?.uses) {
      const uses = String(s.uses);
      if (/^actions\/checkout@/.test(uses)) return { label, skip: "actions/checkout: the worktree is the checkout", noop: true };
      if (/^actions\/(setup-|cache)/.test(uses)) return { label, skip: `${uses}: setup-env prepared the tools` };
      return { label, skip: `${uses}: a uses: step does not run locally` };
    }
    if (typeof s?.run !== "string") return { label, skip: "no run: command" };
    const cond = s.if === undefined ? "" : String(s.if).replace(/^\$\{\{\s*|\s*\}\}$/g, "").trim();
    if (cond && cond !== "always()" && cond !== "success()") return { label, skip: `if: ${cond}` };
    const env = cleanEnv(...layers, strEnv(s.env));
    const script = resolve(s.run, matrix, env);
    if (script === null) return { label, unresolved: true };
    const cwd = String(s["working-directory"] ?? p.job.defaults?.run?.["working-directory"] ?? p.workflow?.defaults?.run?.["working-directory"] ?? ".");
    const resolvedCwd = resolve(cwd, matrix, env) ?? ".";
    const first = script.trim().split(/\s+/)[0] ?? "";
    return { label, script, env, cwd: join(root, resolvedCwd), first };
  });
  if (prepared.some((s: any) => s.unresolved)) {
    return { ...result, status: "skip", reason: "unresolved expression", steps: prepared.map((s: any) => ({ name: s.label, status: "skip", exit: null, reason: s.unresolved ? "unresolved expression" : s.skip })) };
  }
  let failed = false;
  for (const s of prepared as any[]) {
    if (failed) {
      result.steps.push({ name: s.label, status: "skip", exit: null, reason: "an earlier step failed" });
      continue;
    }
    if (s.skip) {
      result.steps.push({ name: s.label, status: "skip", exit: null, reason: s.skip });
      continue;
    }
    const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/.test(s.first);
    if (s.first && !assignment && run(["bash", "-c", 'command -v "$0" >/dev/null', s.first], { cwd: s.cwd, env: s.env }).code !== 0) {
      result.steps.push({ name: s.label, status: "skip", exit: null, reason: `missing tool ${s.first}` });
      continue;
    }
    const r = Bun.spawnSync(["bash", "-eo", "pipefail", "-c", s.script], { cwd: s.cwd, env: s.env, stdout: "pipe", stderr: "pipe", timeout: cfg.timeoutMs });
    const code = r.exitCode ?? 1;
    const out = tail(r.stdout.toString() + r.stderr.toString(), 60);
    result.steps.push({ name: s.label, status: code === 0 ? "pass" : "fail", exit: code, tail: out });
    if (code !== 0) failed = true;
  }
  const stepSkips = result.steps.filter((s) => s.status === "skip").length;
  if (failed) result.status = "fail";
  else if (stepSkips === result.steps.length) {
    result.status = "skip";
    result.reason = "no step could run here";
  } else if (stepSkips) result.reason = `${stepSkips} step(s) skipped`;
  return result;
}

export function listJobs(root = "."): JobResult[] {
  const cfg = config(root);
  return plan(root, cfg).map((p) => ({ workflow: basename(p.file), job: p.id, status: p.reason ? "skip" : "plan", reason: p.reason, steps: [] }));
}

export function runCi(root = "."): CiResult {
  const cfg = config(root);
  if (!cfg.enabled) return { status: "skipped", reason: "disabled in the profile", ran: [], failed: [], skipped: [], dirty: [] };
  const ran: JobResult[] = [];
  for (const p of plan(root, cfg)) {
    if (p.reason) ran.push({ workflow: basename(p.file), job: p.id, status: "skip", reason: p.reason, steps: [] });
    else ran.push(runJob(p, cfg, root));
  }
  const failed = ran.filter((j) => j.status === "fail");
  const skipped = ran.filter((j) => j.status === "skip");
  const passed = ran.filter((j) => j.status === "pass");
  const dirty = run(["git", "status", "--porcelain", "--untracked-files=no"], { cwd: root }).out.split("\n").filter(Boolean).map((l) => l.slice(3));
  const status = failed.length ? "red" : passed.length ? "green" : "skipped";
  return { status, reason: status === "skipped" ? "no job could run locally" : "", ran, failed, skipped, dirty };
}

if (isEntry(import.meta)) {
  if (process.argv.includes("--list")) {
    const jobs = listJobs();
    console.log(JSON.stringify({ status: jobs.some((j) => j.status === "plan") ? "plan" : "skipped", ran: jobs, failed: [], skipped: jobs.filter((j) => j.status === "skip"), dirty: [] }));
  } else {
    // The definition of done comes first: when it is red, no CI time (or fix session) is spent.
    // A run that crashes or is killed leaves the red placeholder behind, never a neutral status.
    const red = (reason: string): CiResult => ({ status: "red", reason, ran: [], failed: [], skipped: [], dirty: [] });
    writeOutcome("ci-local", red("local CI did not finish"));
    const dod = join(artifactsDir(), "outcomes", "dod.json");
    let result: CiResult;
    try {
      if (existsSync(dod) && JSON.parse(readFileSync(dod, "utf8")).green === false) {
        result = { status: "skipped", reason: "the definition of done is red", ran: [], failed: [], skipped: [], dirty: [] };
      } else result = runCi();
    } catch (e) {
      result = red(`local CI could not run: ${e instanceof Error ? e.message : String(e)}`);
    }
    writeOutcome("ci-local", result);
    console.error(`ci-local: ${result.status}; ran=${result.ran.filter((j) => j.status !== "skip").length} failed=${result.failed.length} skipped=${result.skipped.length}`);
    console.log(JSON.stringify(result));
  }
}
