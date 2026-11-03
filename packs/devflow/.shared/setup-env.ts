// Builds the project's environment the way a Claude Code cloud session gets it: full history and
// tags, then every SessionStart command hook in the project's .claude/settings.json, run with
// CLAUDE_CODE_REMOTE=true as on a fresh cloud container. The pack knows nothing about any project;
// the hook is the project's own statement of what a fresh checkout needs (a venv, node_modules, ...).
//
// What the hooks export through CLAUDE_ENV_FILE lands in $ARTIFACTS_DIR/project-env.sh, which the
// verify script loads and every agent sources before running project tooling.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactsDir, fail, must, run, tail } from "./util.ts";

interface CommandHook {
  type: string;
  command?: string;
  timeout?: number;
}
interface HookGroup {
  matcher?: string;
  hooks?: CommandHook[];
}

if (run(["git", "rev-parse", "--is-shallow-repository"]).out.trim() === "true") {
  must(["git", "fetch", "--unshallow", "--tags", "origin"]);
} else {
  must(["git", "fetch", "--tags", "origin"]);
}

function sessionStartHooks(): CommandHook[] {
  const path = ".claude/settings.json";
  if (!existsSync(path)) return [];
  let settings: { hooks?: { SessionStart?: HookGroup[] } };
  try {
    settings = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(`${path} is not valid JSON: ${e}`);
  }
  // A cloud session starts with source "startup": a group matches when it has no matcher or one that admits it.
  const startup = (g: HookGroup) => !g.matcher || g.matcher === "*" || g.matcher.split("|").includes("startup");
  return (settings.hooks?.SessionStart ?? [])
    .filter(startup)
    .flatMap((g) => g.hooks ?? [])
    .filter((h) => h.type === "command" && h.command);
}

const envFile = join(artifactsDir(), "project-env.sh");
writeFileSync(envFile, "# Exports of the project's SessionStart hooks (CLAUDE_ENV_FILE), written by setup-env.\n");

const projectDir = process.cwd();
const hooks = sessionStartHooks();
const stdin = JSON.stringify({ hook_event_name: "SessionStart", source: "startup", cwd: projectDir });
for (const h of hooks) {
  const proc = Bun.spawnSync(["bash", "-c", h.command!], {
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_REMOTE: "true", CLAUDE_ENV_FILE: envFile },
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    timeout: h.timeout ? h.timeout * 1000 : undefined,
  });
  const out = proc.stdout.toString() + proc.stderr.toString();
  if (proc.exitCode !== 0) fail(`the project's SessionStart hook \`${h.command}\` exited ${proc.exitCode}, so the environment is not built:\n${tail(out, 60)}`);
  console.error(`setup: SessionStart hook \`${h.command}\` done\n${tail(out, 40)}`);
}

console.log(JSON.stringify({ hooks: hooks.map((h) => h.command), env_file: envFile }));
