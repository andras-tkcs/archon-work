// The interview loop's decision step: reads the planner's draft verdict and the challenger's
// question, appends the next question to interview.md and says whether the loop is over.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactsDir, fail, input } from "./util.ts";

const MAX_QUESTIONS = 14;

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

const file = join(artifactsDir(), "interview.md");
let text = existsSync(file) ? readFileSync(file, "utf8") : "# Interview\n";
const asked = (text.match(/^## Q\d+/gm) ?? []).length;

let question = "";
let who = "planner";
if (draft.status === "stop") {
  console.log(JSON.stringify({ done: true, stop: true, question: "" }));
  process.exit(0);
} else if (draft.status === "ask") {
  question = String(draft.question ?? "").trim();
} else if (draft.status === "done" && challenge && String(challenge.question ?? "").trim() !== "") {
  question = String(challenge.question).trim();
  who = "challenger";
}

if (question === "") {
  console.log(JSON.stringify({ done: true, stop: false, question: "" }));
  process.exit(0);
}

if (asked >= MAX_QUESTIONS) {
  text = text.replace(/\n*$/, "\n") + `\n## Stopped\n\n${MAX_QUESTIONS} questions asked without converging.\n`;
  writeFileSync(file, text);
  console.log(JSON.stringify({ done: true, stop: true, question: "" }));
  process.exit(0);
}

const n = asked + 1;
if (!existsSync(file)) text = "# Interview\n";
text = text.replace(/\n*$/, "\n") + `\n## Q${n} (asked by: ${who})\n\n${question}\n`;
writeFileSync(file, text);
console.log(
  JSON.stringify({
    done: false,
    stop: false,
    question: `Question ${n} of the plan for this run:\n\n${question}\n\nAnswer in one reply; say "stop" to end planning.`,
  }),
);
