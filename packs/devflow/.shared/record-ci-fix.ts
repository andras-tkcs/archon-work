// Records one ci-fix session of mod-devflow-dod as outcomes/ci-fix-<n>.json and counts the sessions,
// so the local-CI loop stops after the second. Env: INPUTS_FIX (the agent's output; empty when it
// did not run this round). Prints { rounds }.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeOutcome } from "./outcomes.ts";
import { artifactsDir, jsonInput } from "./util.ts";

const counter = join(artifactsDir(), "ci-rounds");
let rounds = existsSync(counter) ? Number(readFileSync(counter, "utf8")) || 0 : 0;
const fix = jsonInput("fix");
if (fix) {
  rounds++;
  writeFileSync(counter, String(rounds));
  writeOutcome(`ci-fix-${rounds}`, fix);
}
console.log(JSON.stringify({ rounds }));
