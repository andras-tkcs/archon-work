// The deterministic gate at the end of a mod-devflow-phase run. It never fails the build: a phase
// that cannot finish is `stuck`, with the reason (the implementer's blocked.md, red fast checks after
// the last step, uncommitted changes, or no commit beyond the base). A phase already merged on the
// base is `done` untouched. Writes $ARTIFACTS_DIR/gate.json for record-outcome and prints it.
//
// `head` is the commit the parent merges: the phase's HEAD when done, else the base, so half-done
// work is never merged; a stuck phase's commits are in `partial_head`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PhaseOutcome } from "./outcomes.ts";
import { artifactsDir, input, must } from "./util.ts";

const phase = input("phase", false) || "<unknown phase>";
const base = input("base");
const dir = artifactsDir();

function verdict(): { status: "done" | "stuck"; reason: string } {
  const blocked = join(dir, "blocked.md");
  if (existsSync(blocked)) return { status: "stuck", reason: `the implementer stopped as blocked: ${readFileSync(blocked, "utf8").trim()}` };
  const report = join(dir, "verify-fast.md");
  const green = existsSync(report) && /<!-- green: true -->\s*$/.test(readFileSync(report, "utf8"));
  if (!green) return { status: "stuck", reason: `the fast checks are red after the last implementation step of ${phase} (${report})` };
  const dirty = must(["git", "status", "--porcelain"]);
  if (dirty) return { status: "stuck", reason: `uncommitted changes after implementing ${phase}: ${dirty.split("\n").map((l) => l.slice(3)).join(", ")}` };
  if (ahead() === 0) return { status: "stuck", reason: `phase ${phase} has no commits beyond ${base}: nothing was implemented` };
  return { status: "done", reason: "" };
}

const ahead = () => Number(must(["git", "rev-list", "--count", `${base}..HEAD`]));

let out: Pick<PhaseOutcome, "head" | "phase" | "skipped" | "status" | "stuck_reason" | "partial_head">;
if (input("done", false) === "true") {
  out = { head: base, phase, skipped: true, status: "done", stuck_reason: "", partial_head: "" };
} else {
  const v = verdict();
  const head = must(["git", "rev-parse", "HEAD"]);
  out = {
    head: v.status === "done" ? head : base,
    phase,
    skipped: false,
    status: v.status,
    stuck_reason: v.reason,
    partial_head: v.status === "stuck" && ahead() > 0 ? head : "",
  };
}
writeFileSync(join(dir, "gate.json"), JSON.stringify(out));
if (out.status === "stuck") console.error(`devflow: phase ${phase} is stuck: ${out.stuck_reason}`);
console.log(JSON.stringify(out));
