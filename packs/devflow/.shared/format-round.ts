// Builds the question message of a refine round. Env: INPUTS_ROUND (1|2), INPUTS_ISSUE, INPUTS_TITLE,
// INPUTS_QUESTIONS (the agent's questions, JSON). Output: { message }.
import { fail, input } from "./util.ts";

export interface Question {
  id: string;
  title: string;
  context: string;
  options: { key: string; text: string }[];
  recommendation: { key: string; why: string };
}

// Archon substitutes `$`; keep the text literal.
const safe = (s: string) => s.replaceAll("$", "＄");

export function formatRound(round: number, issue: string, title: string, questions: Question[]): string {
  const blocks = questions.map((q) =>
    [
      `**${q.id}. ${q.title}**`,
      q.context,
      `Options: ${q.options.map((o) => `${o.key}) ${o.text}`).join("  ")}`,
      `Recommended: ${q.recommendation.key} — ${q.recommendation.why}`,
    ].join("\n"),
  );
  return safe(
    [
      `Refine issue #${issue} "${title}" — round ${round} of max 2`,
      "",
      blocks.join("\n\n"),
      "",
      "Reply `ok` to accept every recommendation, or answer by number (`1: b, 2: ok, 3: <your text>`). Reply `stop` to cancel.",
    ].join("\n"),
  );
}

if (import.meta.main) {
  const round = Number(input("round"));
  if (round !== 1 && round !== 2) fail(`input 'round' must be 1 or 2, got '${input("round")}'`);
  let qs: unknown;
  try {
    qs = JSON.parse(input("questions"));
  } catch {
    fail("input 'questions' is not JSON");
  }
  if (!Array.isArray(qs) || qs.length === 0) fail("input 'questions' must be a non-empty array");
  console.log(JSON.stringify({ message: formatRound(round, input("issue"), input("title", false), qs as Question[]) }));
}
