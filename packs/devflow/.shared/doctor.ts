// devflow-init's doctor: checks that the repository and this machine can run the devflow workflows.
// Each check is ok, warn or fail with a one-line fix; the run never fails on it. Prints
// { ok, warn, fail, table, checks }.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listJobs } from "./ci-local.ts";
import { ARCHON_CONFIG } from "./scaffold-repo.ts";
import { PROFILE_PATH, type Run, isEntry, isNotFound, plansConfig, run } from "./util.ts";

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

function rawProfile(root: string): any {
  try {
    return Bun.YAML.parse(readFileSync(join(root, PROFILE_PATH), "utf8"));
  } catch {
    return null;
  }
}

export function doctor(root = "."): Check[] {
  const checks: Check[] = [];
  const add = (name: string, good: boolean, detail: string, fix: string, bad: Status = "fail") => checks.push({ name, status: good ? "ok" : bad, detail, fix: good ? "" : fix });
  // A check whose executable is missing is a warn row saying to install it: the doctor never throws on it.
  const probe = (name: string, cmd: string[], detail: string, fix: (r: Run) => string, opts: { cwd?: string; timeoutMs?: number; good?: (r: Run) => boolean; bad?: Status } = {}) => {
    const r = run(cmd, { cwd: opts.cwd, timeoutMs: opts.timeoutMs });
    if (isNotFound(r)) add(name, false, detail, `install ${cmd[0]}`, "warn");
    else add(name, (opts.good ?? ((x) => x.code === 0))(r), detail, fix(r), opts.bad);
    return r;
  };
  probe("gh authenticated", ["gh", "auth", "status"], "gh auth status", () => "run gh auth login");
  probe("origin reachable", ["git", "ls-remote", "--heads", "origin"], "git ls-remote origin", () => "check the remote URL and your credentials", { timeoutMs: 30_000 });
  probe("python3 with PyYAML", ["python3", "-c", "import yaml"], "python3 -c 'import yaml'", () => "install PyYAML (pip install pyyaml)");
  add("bun", onPath("bun"), "bun on PATH", "install bun (https://bun.sh)", "warn");

  let profile: any = null;
  const v = existsSync(join(root, PROFILE_PATH))
    ? probe("profile valid", ["python3", join(import.meta.dir, "validate-profile.py"), PROFILE_PATH, "--root", root, "--resolved"], PROFILE_PATH, (r) => `fix: ${r.err.trim().split("\n")[0]}`, { cwd: root })
    : (add("profile valid", false, PROFILE_PATH, "rerun devflow-init"), null);
  if (v?.code === 0) profile = JSON.parse(v.out);
  // Without python3 the profile cannot be validated; its commands are still worth checking.
  else if (v && isNotFound(v)) profile = rawProfile(root);
  checks.push(...commandChecks(profile, root));
  for (const d of profile?.ci?.dispatchable ?? []) {
    const f = String(d?.workflow ?? "");
    const path = f.includes("/") ? f : `.github/workflows/${f}`;
    add(`ci.dispatchable: ${f}`, existsSync(join(root, path)), path, `add ${path} or remove the entry`);
  }

  const plans = plansConfig();
  const plansOnOrigin = run(["git", "ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${plans.ref}`]).code === 0;
  probe(`plans branch ${plans.ref}`, ["git", "push", "--dry-run", "-q", "origin", `HEAD:refs/heads/${plans.ref}-devflow-doctor`], plansOnOrigin ? "exists on origin" : "created by devflow-init's PR step", () => "allow pushes to origin for this account", { cwd: root, bad: "warn" });
  const cfg = existsSync(join(root, ARCHON_CONFIG)) ? readFileSync(join(root, ARCHON_CONFIG), "utf8") : "";
  let source = false;
  try {
    source = ((Bun.YAML.parse(cfg) as any)?.extraWorkflowSources ?? []).some((s: any) => s?.ref === plans.ref && s?.path === plans.dir);
  } catch {}
  add("Archon config has the plans source", source, ARCHON_CONFIG, `add extraWorkflowSources: [{ ref: ${plans.ref}, path: ${plans.dir} }]`);
  probe("devflow pack installed", ["archon", "workflow", "list"], "archon workflow list", () => "install the devflow pack, then archon workflow sync", { cwd: root, timeoutMs: 60_000, good: (r) => r.code === 0 && r.out.includes("devflow-refine"), bad: "warn" });

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
