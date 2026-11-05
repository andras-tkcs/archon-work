// The interview loop's decision step: reads the planner's questions and the challenger's ranking,
// appends the round to interview.md and says whether the interview is over.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactsDir, fail, input } from "./util.ts";

const MAX_ROUNDS = 3;
const PER_ROUND = 5;
type Q = { question: string; by: string };

function parse(name: string, text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return fail(`input '${name}' is not JSON: ${text.slice(0, 200)}`);
  }
}

const draft = parse("draft", input("draft"));
const challengeText = input("challenge", false);
const challenge = challengeText.trim() === "" ? null : parse("challenge", challengeText);

const dir = artifactsDir();
const file = join(dir, "interview.md");
let text = existsSync(file) ? readFileSync(file, "utf8") : "# Interview\n";
const rounds = (text.match(/^## Round \d+\s*$/gm) ?? []).length;
const asked = (text.match(/^### Q\d+ /gm) ?? []).length;

if (draft.status === "stop") {
  console.log(JSON.stringify({ done: true, stop: true, incomplete: false, question: "" }));
  process.exit(0);
}

const draftQs: Q[] = (Array.isArray(draft.questions) ? draft.questions : [])
  .map((x: unknown) => ({ question: String(x ?? "").trim(), by: "planner" }))
  .filter((q: Q) => q.question !== "");
const candidates: Q[] =
  draft.status === "publish" || challenge === null
    ? draftQs
    : (Array.isArray(challenge.questions) ? challenge.questions : [])
        .map((q: any) => ({
          question: String(q?.question ?? "").trim(),
          by: q?.by === "challenger" ? "challenger" : "planner",
        }))
        .filter((q: Q) => q.question !== "");

rmSync(join(dir, "carried.md"), { force: true });

if (candidates.length === 0) {
  console.log(JSON.stringify({ done: true, stop: false, incomplete: false, question: "" }));
  process.exit(0);
}

if (draft.status === "publish" || rounds >= MAX_ROUNDS) {
  const reason = draft.status === "publish" ? 'You said "publish"' : "The interview ended after 3 rounds";
  const blocks = candidates.map((q, i) => `### Q${asked + i + 1} (asked by: ${q.by})\n\n${q.question}\n`);
  writeFileSync(join(dir, "open-questions.md"), blocks.join("\n"));
  text =
    text.replace(/\n*$/, "\n") +
    `\n## Interview ended incomplete\n\n${reason} with ${candidates.length} open questions. They are in open-questions.md and are taken at their recommended defaults.\n`;
  writeFileSync(file, text);
  console.log(JSON.stringify({ done: true, stop: false, incomplete: true, question: "" }));
  process.exit(0);
}

const r = rounds + 1;
const batch = candidates.slice(0, PER_ROUND);
const carried = candidates.slice(PER_ROUND);
if (carried.length > 0) {
  writeFileSync(
    join(dir, "carried.md"),
    "# Carried over to the next round\n\n" + carried.map((q) => `### (asked by: ${q.by})\n\n${q.question}\n`).join("\n"),
  );
}
text = text.replace(/\n*$/, "\n") + `\n## Round ${r}\n`;
batch.forEach((q, i) => {
  text += `\n### Q${asked + i + 1} (asked by: ${q.by})\n\n${q.question}\n`;
});
writeFileSync(file, text);

let question =
  `Round ${r} of ${MAX_ROUNDS} of the plan for this run: ${batch.length} ${batch.length === 1 ? "question" : "questions"}.\n\n` +
  batch.map((q, i) => `**${i + 1}.** (Q${asked + i + 1})\n\n${q.question}`).join("\n\n---\n\n") +
  `\n\nAnswer in one reply, as "1: a, 2: c, …"; questions you skip are asked again next round. Say "publish" to stop asking and publish the plan as it is, or "stop" to abandon it.`;
if (r === MAX_ROUNDS) {
  question +=
    "\n\nThis is the last round: questions still open after it are taken at their recommended defaults, and the plan is published as incomplete, ready for devflow-refine.";
}
console.log(JSON.stringify({ done: false, stop: false, incomplete: false, question }));
