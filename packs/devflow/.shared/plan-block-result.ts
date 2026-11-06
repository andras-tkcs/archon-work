// The outcome of mod-devflow-plan-block. Env: INPUTS_ISSUE, INPUTS_DESIGN_REVISION,
// INPUTS_PUBLISH (publish's output, empty when it did not run), INPUTS_NEEDS_REFINE (needs-refine's
// output, empty when it did not run). Output: { planned, issue, plan_revision, design_revision,
// workflow, needs_refine, unresolved_findings }.
import { fail, input } from "./util.ts";

function json(name: string): any {
  const raw = input(name, false).trim();
  if (raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return fail(`input '${name}' is not JSON: ${raw.slice(0, 200)}`);
  }
}

const publish = json("publish");
const needs = json("needs_refine");
console.log(
  JSON.stringify({
    planned: publish !== null,
    issue: Number(input("issue")),
    plan_revision: publish ? Number(publish.revision) : 0,
    design_revision: Number(input("design_revision")),
    workflow: String(publish?.workflow ?? ""),
    needs_refine: needs?.needs_refine === true,
    unresolved_findings: Number(publish?.unresolved ?? 0),
  }),
);
