// The two joins of devflow-refine. INPUTS_MODE=choice: from the attention answers of every pass
// (INPUTS_ATTEND_1 … INPUTS_ATTEND_6, empty when the pass did not run), the last answer:
// { choice, issue, outcome }. INPUTS_MODE=result: from that choice (INPUTS_CHOICE) and the plan
// block's outcome (INPUTS_PLAN, empty when it did not run), the run's outcome:
// { designed, issue, revision, design_url, planned, needs_refine }.
import { fail, input } from "./util.ts";

export const PASSES = 6;

function json(name: string): any {
  const raw = input(name, false).trim();
  if (raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return fail(`input '${name}' is not JSON: ${raw.slice(0, 200)}`);
  }
}

const mode = input("mode");
if (mode === "choice") {
  const answers = Array.from({ length: PASSES }, (_, k) => json(`attend_${k + 1}`)).filter((a) => a !== null);
  const last = answers[answers.length - 1];
  if (!last) fail("no refine pass reached its pause");
  const outcome = last.outcome ?? {};
  console.log(JSON.stringify({ choice: String(last.choice ?? ""), issue: Number(outcome?.issue ?? 0), outcome }));
} else if (mode === "result") {
  const choice = json("choice");
  const plan = json("plan");
  const o = choice?.outcome ?? {};
  console.log(
    JSON.stringify({
      designed: o.designed === true,
      issue: Number(o.issue ?? 0),
      revision: Number(o.revision ?? 0),
      design_url: String(o.design_url ?? ""),
      planned: plan?.planned === true,
      needs_refine: plan?.needs_refine === true,
    }),
  );
} else fail(`mode must be choice or result, got '${mode}'`);
