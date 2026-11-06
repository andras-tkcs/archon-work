// Records the PR the delivery tail opened as the build's `pr` outcome, so wrap knows a PR exists
// (and pushes nothing to a branch that may be merged and gone by the time wrap's final pass runs).
// Env: INPUTS_NUMBER, INPUTS_URL, INPUTS_RUN_KEY. Prints { number, url }.
import { writeOutcome } from "./outcomes.ts";
import { fact, input } from "./util.ts";

const pr = { number: Number(input("number")), url: input("url") };
writeOutcome("pr", pr, fact("run_key"));
console.log(JSON.stringify(pr));
