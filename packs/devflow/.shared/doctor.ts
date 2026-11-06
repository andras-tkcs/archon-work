// devflow-init's doctor: checks that the repository and this machine can run the devflow workflows.
// Each check is ok, warn or fail with a one-line fix; the run never fails on it. Prints
// { ok, warn, fail, table, checks }.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listJobs } from "./ci-local.ts";
import { ARCHON_CONFIG } from "./scaffold-repo.ts";
import { PROFILE_PATH, isEntry, plansConfig, run } from "./util.ts";

export type Status = "ok" | "warn" | "fail";
export interface Check {
  name: string;
  status: Status;
  detail: string;
  fix: string;
}

const onPath = (cmd: string) => run(["bash", "-c", `command -v -- "$1" >/dev/null`, "_", cmd]).code === 0;

// The first word of a verify command (string or { run }), after leading VAR=value assignments.
export function firstWord(cmd: unknown): string {
  const text = typeof cmd === "string" ? cmd : String((cmd as any)?.run ?? "");
  const words = text.trim().replace(/^\(\s*/, "").split(/\s+/);
  return words.find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) ?? "";
}

export function commandChecks(profile: any, root = "."): Check[] {
  const out: Check[] = [];
  for (const key of ["fast", "dod"]) {
    for (const cmd of profile?.verify?.[key] ?? []) {
      const w = firstWord(cmd);
      const cwd = typeof cmd === "object" && cmd?.cwd ? String(cmd.cwd) : ".";
      if (!w || w === "cd") continue;
      const found = w.includes("/") ? existsSync(join(root, cwd, w)) : onPath(w) || ["test", "true", "false", "["].includes(w);
      out.push({ name: `verify.${key}: ${w}`, status: found ? "ok" : "fail", detail: found ? "found" : `'${w}' is not on PATH and not a file in the repository`, fix: found ? "" : `install ${w}, or change the command in ${PROFILE_PATH}` });
    }
  }
  return out;
}

export function doctor(root = "."): Check[] {
  const checks: Check[] = [];
  const add = (name: string, good: boolean, detail: string, fix: string, bad: Status = "fail") => checks.push({ name, status: good ? "ok" : bad, detail, fix: good ? "" : fix });
  add("gh authenticated", run(["gh", "auth", "status"]).code === 0, "gh auth status", "run gh auth login");
  add("origin reachable", run(["git", "ls-remote", "--heads", "origin"], { timeoutMs: 30_000 }).code === 0, "git ls-remote origin", "check the remote URL and your credentials");
  add("python3 with PyYAML", run(["python3", "-c", "import yaml"]).code === 0, "python3 -c 'import yaml'", "install python3 and PyYAML (pip install pyyaml)");
  add("bun", onPath("bun"), "bun on PATH", "install bun (https://bun.sh)");

  let profile: any = null;
  const v = existsSync(join(root, PROFILE_PATH)) ? run(["python3", join(import.meta.dir, "validate-profile.py"), PROFILE_PATH, "--root", root, "--resolved"], { cwd: root }) : null;
  add("profile valid", v?.code === 0, PROFILE_PATH, v ? `fix: ${v.err.trim().split("\n")[0]}` : "rerun devflow-init");
  if (v?.code === 0) profile = JSON.parse(v.out);
  checks.push(...commandChecks(profile, root));
  for (const d of profile?.ci?.dispatchable ?? []) {
    const f = String(d?.workflow ?? "");
    const path = f.includes("/") ? f : `.github/workflows/${f}`;
    add(`ci.dispatchable: ${f}`, existsSync(join(root, path)), path, `add ${path} or remove the entry`);
  }

  const plans = plansConfig();
  const plansOnOrigin = run(["git", "ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${plans.ref}`]).code === 0;
  const pushable = run(["git", "push", "--dry-run", "-q", "origin", `HEAD:refs/heads/${plans.ref}-devflow-doctor`], { cwd: root }).code === 0;
  add(`plans branch ${plans.ref}`, pushable, plansOnOrigin ? "exists on origin" : "created by devflow-init's PR step", "allow pushes to origin for this account", "warn");
  const cfg = existsSync(join(root, ARCHON_CONFIG)) ? readFileSync(join(root, ARCHON_CONFIG), "utf8") : "";
  let source = false;
  try {
    source = ((Bun.YAML.parse(cfg) as any)?.extraWorkflowSources ?? []).some((s: any) => s?.ref === plans.ref && s?.path === plans.dir);
  } catch {}
  add("Archon config has the plans source", source, ARCHON_CONFIG, `add extraWorkflowSources: [{ ref: ${plans.ref}, path: ${plans.dir} }]`);
  const list = run(["archon", "workflow", "list"], { cwd: root, timeoutMs: 60_000 });
  add("devflow pack installed", list.code === 0 && list.out.includes("devflow-refine"), "archon workflow list", "install the devflow pack, then archon workflow sync", "warn");

  for (const j of listJobs(root)) {
    checks.push({ name: `local CI: ${j.workflow} ${j.job}`, status: j.status === "plan" ? "ok" : "warn", detail: j.status === "plan" ? "runs locally" : `skipped: ${j.reason}`, fix: "" });
  }
  return checks;
}

export function table(checks: Check[]): string {
  const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
  return ["| check | status | detail | fix |", "|---|---|---|---|", ...checks.map((c) => `| ${cell(c.name)} | ${c.status} | ${cell(c.detail)} | ${cell(c.fix)} |`)].join("\n");
}

if (isEntry(import.meta)) {
  const checks = doctor(".");
  const count = (s: Status) => checks.filter((c) => c.status === s).length;
  console.log(JSON.stringify({ ok: count("ok"), warn: count("warn"), fail: count("fail"), table: table(checks), checks }));
}
