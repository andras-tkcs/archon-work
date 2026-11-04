// The deterministic gate at the end of a devflow-phase child run. A phase that was already merged
// on the base passes untouched; otherwise it fails when the implementer stopped as blocked (its
// reason is in $ARTIFACTS_DIR/blocked.md), when the last fast checks were red, when the worktree is
// dirty, or when nothing was committed beyond the base.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { artifactsDir, fail, input, must } from "./util.ts";

const phase = input("phase", false);

if (input("done", false) === "true") {
  const base = input("base");
  console.log(JSON.stringify({ head: base, phase, skipped: true }));
  process.exit(0);
}

const blocked = join(artifactsDir(), "blocked.md");
if (existsSync(blocked)) fail(`phase ${phase} stopped as blocked; it needs a person:\n${readFileSync(blocked, "utf8")}`);
if (input("green", false) !== "true") fail(`the fast checks are still red after the last implementation step of ${phase} (see ${join(artifactsDir(), "verify-fast.md")})`);
const dirty = must(["git", "status", "--porcelain"]);
if (dirty) fail(`uncommitted changes after implementing ${phase}:\n${dirty}`);
const base = input("base");
const ahead = Number(must(["git", "rev-list", "--count", `${base}..HEAD`]));
if (ahead === 0) fail(`phase ${phase} has no commits beyond ${base}: nothing was implemented`);

console.log(JSON.stringify({ head: must(["git", "rev-parse", "HEAD"]), phase, skipped: false }));
