// The output of mod-devflow-dod, from the results its scripts wrote: ok is the definition of done,
// ci_status the last local-CI run's status (red when ci-local never reported: the result must not
// read as neutral). Never fails.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readOwnOutcome } from "./outcomes.ts";
import { artifactsDir } from "./util.ts";

const dod = readOwnOutcome("dod");
const ci = readOwnOutcome("ci-local");
const dir = join(artifactsDir(), "outcomes");
const rounds = existsSync(dir) ? readdirSync(dir).filter((f) => /^ci-fix-\d+\.json$/.test(f)).length : 0;
const status = ci?.status ?? "red";
console.log(
  JSON.stringify({
    ok: dod?.green === true,
    dod: { green: dod?.green === true, failed: dod?.failed ?? [], unavailable: dod?.unavailable ?? [] },
    ci_local: { status, reason: ci ? (ci.reason ?? "") : "local CI did not report a result", rounds, ran: ci?.ran ?? [], failed: ci?.failed ?? [], skipped: ci?.skipped ?? [] },
    ci_status: status,
  }),
);
