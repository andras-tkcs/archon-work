// devflow-init's final draft: the output of the last step that ran (apply-2, else apply-1, else
// propose); the later ones are empty when their round was not asked. Env: INPUTS_PROPOSE,
// INPUTS_APPLY_1, INPUTS_APPLY_2 (each the step's output JSON, or empty). Prints { profile, provenance }.
import { fail, jsonInput } from "./util.ts";

const last = jsonInput("apply_2") ?? jsonInput("apply_1") ?? jsonInput("propose");
if (!last?.profile || typeof last.profile !== "object") fail("no draft profile: propose-profile returned none");
console.log(JSON.stringify({ profile: last.profile, provenance: last.provenance ?? {} }));
