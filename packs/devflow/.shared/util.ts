// Shared helpers for the devflow pack's scripts. Diagnostics go to stderr; stdout is the node's JSON.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

// True when the process runs this module as a node script: directly, or through a workflow's
// scripts/<same name>.ts wrapper, which imports it (so import.meta.main is false there). False when a
// test imports it. Pass the module's own import.meta.
export const isEntry = (meta: ImportMeta) => basename(Bun.main) === basename(meta.path);

export interface Run {
  code: number;
  out: string;
  err: string;
}

export function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}): Run {
  const r = Bun.spawnSync(cmd, {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env ?? {}) },
    stdout: "pipe",
    stderr: "pipe",
    timeout: opts.timeoutMs,
  });
  return { code: r.exitCode ?? 1, out: r.stdout.toString(), err: r.stderr.toString() };
}

// Runs a command that must succeed; on failure, fails the node with the command and its output.
export function must(cmd: string[], opts: Parameters<typeof run>[1] = {}): string {
  const r = run(cmd, opts);
  if (r.code !== 0) fail(`\`${cmd.join(" ")}\` exited ${r.code}\n${tail(r.out + r.err, 40)}`);
  return r.out.trim();
}

export function fail(msg: string): never {
  console.error(`devflow: ${msg}`);
  process.exit(1);
}

export function tail(text: string, lines: number): string {
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}

export function artifactsDir(): string {
  const dir = process.env.ARTIFACTS_DIR;
  if (!dir) fail("ARTIFACTS_DIR is not set");
  return dir;
}

export function input(name: string, required = true): string {
  const v = process.env[`INPUTS_${name.toUpperCase()}`] ?? "";
  if (required && v === "") fail(`input '${name}' is empty`);
  return v;
}

// An optional JSON input: null when empty (its producer did not run); fails the node when malformed.
export function jsonInput(name: string): any {
  const raw = input(name, false).trim();
  if (raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return fail(`input '${name}' is not JSON: ${raw.slice(0, 200)}`);
  }
}

// The project environment setup-env wrote; `bash` loads BASH_ENV before every project command.
export function projectEnv(): Record<string, string> {
  const file = join(artifactsDir(), "project-env.sh");
  return existsSync(file) ? { BASH_ENV: file } : {};
}

export const PROFILE_PATH = ".devflow/devflow.yaml";

// The raw profile; preflight has already validated it with validate-profile.py.
export function profile(): any {
  if (!existsSync(PROFILE_PATH)) fail(`${PROFILE_PATH} not found: see the README section "Profile"`);
  return Bun.YAML.parse(readFileSync(PROFILE_PATH, "utf8"));
}

// Where this project's plans branch is: the run's input, else the profile's `plans`, else `plans`.
export function plansConfig(): { ref: string; dir: string } {
  const p = existsSync(PROFILE_PATH) ? (profile().plans ?? {}) : {};
  return {
    ref: input("plans_ref", false) || p.ref || "plans",
    dir: input("plans_dir", false) || p.dir || "plans",
  };
}
