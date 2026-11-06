// Records the before.md check as the build's `before` outcome. An item the agent did not report (or
// every item, when the agent did not run) is `unknown`. The build never waits on it: unmet and
// unknown items go to deviations.md. Env: INPUTS_ITEMS (the agent's output, may be empty),
// INPUTS_LISTED (load-before's output).
import { writeOutcome } from "./outcomes.ts";
import { jsonInput } from "./util.ts";

const listed: Array<{ n: number; title: string }> = jsonInput("listed")?.items ?? [];
const reported: Array<{ n: number; title?: string; status?: string; evidence?: string }> = jsonInput("items")?.items ?? [];
const items = listed.map((it) => {
  const r = reported.find((x) => Number(x.n) === it.n);
  const status = r && ["met", "unmet", "unknown"].includes(String(r.status)) ? String(r.status) : "unknown";
  return { n: it.n, title: it.title, status, evidence: r?.evidence?.trim() || "the check did not run" };
});
writeOutcome("before", { items });
console.log(JSON.stringify({ items }));
