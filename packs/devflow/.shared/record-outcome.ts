// The last node of mod-devflow-phase (it runs whatever happened before it): the phase's typed outcome
// (PhaseOutcome in outcomes.ts), written to the build's shared outcomes for merge and wrap. It reads only
// files, never an upstream output: gate.json, deps.json, and what the implementer wrote
// (decisions.jsonl, cases.json, summary.md). No gate.json means the block stopped before its gate.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type PhaseDecision, type PhaseOutcome, readOwnOutcome, writeOutcome } from "./outcomes.ts";
import { artifactsDir, input, run } from "./util.ts";

const dir = artifactsDir();
const phase = input("phase");
const base = input("base", false);
const read = (name: string): string | null => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : null);
const json = (name: string): any => {
  try {
    return JSON.parse(read(name) ?? "null");
  } catch {
    return null;
  }
};

const deps = json("deps.json");
if (deps && deps.ready === false) {
  console.log(JSON.stringify(readOwnOutcome(phase)));
  process.exit(0);
}

const decisions = (read("decisions.jsonl") ?? "")
  .split("\n")
  .filter((l) => l.trim())
  .flatMap((l): PhaseDecision[] => {
    try {
      const d = JSON.parse(l);
      return d && typeof d === "object" ? [{ kind: d.kind === "deviation" ? "deviation" : "decision", title: String(d.title ?? ""), choice: String(d.choice ?? ""), why: String(d.why ?? ""), alternatives: String(d.alternatives ?? "") }] : [];
    } catch {
      return [];
    }
  });
const cases: PhaseOutcome["cases"] = (Array.isArray(json("cases.json")) ? json("cases.json") : [])
  .filter((c: any) => c && /^T\d+$/.test(String(c.id)))
  .map((c: any) => ({ id: String(c.id), result: ["pass", "fail", "not_run"].includes(c.result) ? c.result : "not_run" }));
const summary = (read("summary.md") ?? "").trim();

const gate = json("gate.json");
let outcome: PhaseOutcome;
if (gate) {
  outcome = { phase, status: gate.status, head: gate.head, summary, stuck_reason: gate.stuck_reason ?? "", decisions, cases, partial_head: gate.partial_head ?? "", skipped: !!gate.skipped };
} else {
  const head = run(["git", "rev-parse", "HEAD"]).out.trim();
  const ahead = base && head && run(["git", "rev-list", "--count", `${base}..HEAD`]).out.trim() !== "0";
  outcome = { phase, status: "failed", head: base, summary, stuck_reason: "the phase block stopped before its gate", decisions, cases, partial_head: ahead ? head : "", skipped: false };
}
writeOutcome(phase, outcome);
console.log(JSON.stringify(outcome));
