// Appends one refine round, its questions and the person's answer, to $ARTIFACTS_DIR/interview.md and
// says whether the answer stops the run. Env: INPUTS_ROUND (1|2), INPUTS_QUESTIONS (the agent's
// questions, JSON), INPUTS_ANSWER (the reply text). Output: { stop }.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { artifactsDir, fail, input } from "./util.ts";

export const STOP_RE = /^\s*(stop|cancel|not now)\b/i;

const round = Number(input("round"));
if (round !== 1 && round !== 2) fail(`input 'round' must be 1 or 2, got '${input("round")}'`);
let qs: any[];
try {
  qs = JSON.parse(input("questions"));
} catch {
  fail("input 'questions' is not JSON");
}
const answer = input("answer", false).trim();
const lines = [`## Round ${round}`, "", ...qs.map((q) => `${q.id}: ${q.title} (recommended: ${q.recommendation?.key})`), "", `A: ${answer}`, "", ""];
appendFileSync(join(artifactsDir(), "interview.md"), lines.join("\n"));
console.log(JSON.stringify({ stop: STOP_RE.test(answer) }));
