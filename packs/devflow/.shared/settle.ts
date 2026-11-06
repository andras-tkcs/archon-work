// The attention pause: builds the pause from a stage's typed outcome (no agent decides whether to
// pause), then turns the person's answer into the block's result. Two calls per pause:
//   1. INPUTS_OUTCOME (the stage's outcome, JSON or empty) → whether to pause, the message, the options.
//   2. INPUTS_PREVIOUS (call 1's output) and INPUTS_ANSWER (the select's {decision, text}) → the result.
// INPUTS_LAST = "true" on the last pass the graph allows: no revise option.
// Output: { done, choice, outcome ({} when the stage did not finish), message, options, brief }.
import { fail, input } from "./util.ts";

const MAX_LINES = 5;

// Archon substitutes `$`; keep the text literal.
const safe = (s: string) => s.replaceAll("$", "＄");

function json(name: string): any {
  const raw = input(name, false).trim();
  if (raw === "") return null;
  try {
    const v = JSON.parse(raw);
    return v === "" ? null : v;
  } catch {
    return fail(`input '${name}' is not JSON: ${raw.slice(0, 200)}`);
  }
}

const isObj = (v: unknown): v is Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0;

function refineMessage(o: Record<string, any>, last: boolean): string {
  const assumptions: string[] = Array.isArray(o.assumption_lines) ? o.assumption_lines.map(String) : [];
  const count = Number.isInteger(o.assumptions) ? (o.assumptions as number) : assumptions.length;
  const lines = assumptions.slice(0, MAX_LINES);
  if (count > MAX_LINES) lines.push(`… and ${count - MAX_LINES} more`);
  const r = Number(o.revision);
  return [
    `Design for issue #${o.issue} is ready: revision ${r} — ${o.design_url}`,
    "",
    `Assumptions taken (not asked): ${count} — listed under "Assumptions" in the file.`,
    ...lines,
    "",
    `plan: run devflow-plan now and publish build-issue-${o.issue}.`,
    ...(last ? [] : [`revise: another refine pass; your note is the change request (revision ${r + 1}).`]),
    "finish: stop here; the design stays published.",
  ].join("\n");
}

function pause(stage: string, outcome: unknown, last: boolean) {
  const none = { done: true, choice: "", outcome: isObj(outcome) ? outcome : {}, message: "", options: [], brief: "" };
  if (!isObj(outcome) || stage !== "devflow-refine" || outcome.designed !== true) return none;
  const options = [
    { id: "plan", label: "Plan it" },
    ...(last ? [] : [{ id: "revise", label: "Revise (add a note)" }]),
    { id: "finish", label: "Finish" },
  ];
  return { done: false, choice: "", outcome, message: safe(refineMessage(outcome, last)), options, brief: "" };
}

function settle(previous: Record<string, any>, answer: unknown) {
  const decision = isObj(answer) ? String(answer.decision ?? "") : "";
  const outcome = previous.outcome ?? {};
  if (decision === "plan" || decision === "finish") return { done: true, choice: decision, outcome, message: "", options: [], brief: "" };
  if (decision === "revise") return { done: false, choice: "revise", outcome, message: "", options: [], brief: String((answer as any).text ?? "") };
  if (decision !== "") fail(`unknown answer '${decision}'`);
  return previous;
}

const previous = json("previous");
const result = isObj(previous) ? settle(previous, json("answer")) : pause(input("stage"), json("outcome"), input("last", false) === "true");
console.log(JSON.stringify(result));
