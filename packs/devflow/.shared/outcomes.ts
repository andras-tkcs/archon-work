// Typed outcomes of a build's blocks (phases, merges, before check, local CI, PR). Every child run has
// its own $ARTIFACTS_DIR, so an outcome is also written to a directory every worktree of the
// repository shares: <git common dir>/devflow/outcomes/<run_key>/<name>.json. run_key comes from
// mod-devflow-start and is passed to every block; without it only the run's own copy is written.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactsDir, input, must } from "./util.ts";

export function sharedOutcomesDir(runKey: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(runKey)) throw new Error(`run_key '${runKey}' is not a plain name`);
  const common = must(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return join(common, "devflow", "outcomes", runKey);
}

export function writeOutcome(name: string, obj: unknown, runKey = input("run_key", false)): void {
  const text = JSON.stringify(obj, null, 2) + "\n";
  const own = join(artifactsDir(), "outcomes");
  mkdirSync(own, { recursive: true });
  writeFileSync(join(own, `${name}.json`), text);
  if (!runKey) return;
  const shared = sharedOutcomesDir(runKey);
  mkdirSync(shared, { recursive: true });
  writeFileSync(join(shared, `${name}.json`), text);
}

const parse = (file: string): any => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { status: "failed", detail: "unreadable outcome" };
  }
};

// Every outcome of the build, by name; empty when nothing was written yet.
export function readOutcomes(runKey: string): Record<string, any> {
  const dir = sharedOutcomesDir(runKey);
  if (!existsSync(dir)) return {};
  const out: Record<string, any> = {};
  for (const f of readdirSync(dir).sort()) if (f.endsWith(".json")) out[f.slice(0, -5)] = parse(join(dir, f));
  return out;
}

export function readOutcome(runKey: string, name: string): any | null {
  const file = join(sharedOutcomesDir(runKey), `${name}.json`);
  return existsSync(file) ? parse(file) : null;
}

// A block that runs inside the same run (an include) reads its siblings' outcomes from $ARTIFACTS_DIR.
export function readOwnOutcome(name: string): any | null {
  const file = join(artifactsDir(), "outcomes", `${name}.json`);
  return existsSync(file) ? parse(file) : null;
}
