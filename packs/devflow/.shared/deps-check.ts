// The first node of mod-devflow-phase: the phase runs only when every phase it depends on is done
// (read from the build's shared outcomes). Otherwise it records itself as skipped, naming the
// dependency, and the block does nothing else. Env: INPUTS_PHASE, INPUTS_DEPENDS_ON (comma list),
// INPUTS_RUN_KEY, INPUTS_BASE. Prints { ready } and writes $ARTIFACTS_DIR/deps.json.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readOutcome, writeOutcome } from "./outcomes.ts";
import { artifactsDir, input } from "./util.ts";

const phase = input("phase");
const runKey = input("run_key", false);
const deps = input("depends_on", false).split(",").map((d) => d.trim()).filter(Boolean);

let blocker = "";
for (const d of deps) {
  const state = runKey ? (readOutcome(runKey, d)?.status ?? "missing") : "missing";
  if (state !== "done") {
    blocker = `dependency ${d} is ${state}`;
    break;
  }
}
const ready = blocker === "";
writeFileSync(join(artifactsDir(), "deps.json"), JSON.stringify({ ready, reason: blocker }));
if (!ready) {
  writeOutcome(phase, { phase, status: "skipped", head: input("base", false), summary: "", stuck_reason: blocker, decisions: [], cases: [], partial_head: "", skipped: true });
  console.error(`devflow: phase ${phase} is skipped: ${blocker}`);
}
console.log(JSON.stringify({ ready }));
