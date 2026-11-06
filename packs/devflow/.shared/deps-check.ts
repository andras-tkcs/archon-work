// The first node of mod-devflow-phase: the phase runs only when every phase it depends on is done
// and merged (read from the build's shared outcomes). Otherwise it records itself as skipped, naming the
// dependency, and the block does nothing else. Env: INPUTS_PHASE, INPUTS_DEPENDS_ON (comma list),
// INPUTS_RUN_KEY, INPUTS_BASE. Prints { ready } and writes $ARTIFACTS_DIR/deps.json.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type PhaseOutcome, readOutcome, readPhaseOutcome, writeOutcome } from "./outcomes.ts";
import { artifactsDir, input } from "./util.ts";

const phase = input("phase");
const runKey = input("run_key", false);
const deps = input("depends_on", false).split(",").map((d) => d.trim()).filter(Boolean);

let blocker = "";
for (const d of deps) {
  // A done dependency whose merge conflicted is not on the base this phase starts from.
  const conflict = runKey && readOutcome(runKey, `merge-${d}`)?.status === "conflict";
  const state = !runKey ? "missing" : conflict ? "conflicted" : (readPhaseOutcome(runKey, d)?.status ?? "missing");
  if (state !== "done") {
    blocker = `dependency ${d} is ${state}`;
    break;
  }
}
const ready = blocker === "";
writeFileSync(join(artifactsDir(), "deps.json"), JSON.stringify({ ready, reason: blocker }));
if (!ready) {
  const skipped: PhaseOutcome = { phase, status: "skipped", head: input("base", false), summary: "", stuck_reason: blocker, decisions: [], cases: [], partial_head: "", skipped: true };
  writeOutcome(phase, skipped);
  console.error(`devflow: phase ${phase} is skipped: ${blocker}`);
}
console.log(JSON.stringify({ ready }));
