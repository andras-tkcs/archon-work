// Builds the question message of a refine round. Env: INPUTS_ROUND (1|2), INPUTS_ISSUE, INPUTS_TITLE,
// INPUTS_QUESTIONS (the agent's questions, JSON). Output: { message }.
// INPUTS_MODE=init (devflow-init): INPUTS_DRAFT (the draft profile, JSON) and INPUTS_PROVENANCE
// (key path -> existing|detected|default) instead of the issue and title; the round's draft and
// questions go to $ARTIFACTS_DIR/current-round.json for apply-answers.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactsDir, fail, input, isEntry, jsonInput } from "./util.ts";

export interface Question {
  id: string;
  title: string;
  context: string;
  options: { key: string; text: string }[];
  recommendation: { key: string; why: string };
}

// Archon substitutes `$`; keep the text literal.
const safe = (s: string) => s.replaceAll("$", "＄");

function questionBlocks(questions: Question[]): string {
  return questions
    .map((q) =>
      [
        `**${q.id}. ${q.title}**`,
        q.context,
        `Options: ${q.options.map((o) => `${o.key}) ${o.text}`).join("  ")}`,
        `Recommended: ${q.recommendation.key} — ${q.recommendation.why}`,
      ].join("\n"),
    )
    .join("\n\n");
}

// The draft as YAML, each leaf marked with where its value came from (the nearest key with a source).
export function annotatedYaml(draft: Record<string, unknown>, provenance: Record<string, string>): string {
  const lines: string[] = [];
  const sourceOf = (path: string) => {
    for (let p = path; p; p = p.includes(".") ? p.slice(0, p.lastIndexOf(".")) : "") if (provenance[p]) return provenance[p];
    return "";
  };
  const walk = (obj: Record<string, unknown>, prefix: string, indent: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        lines.push(`${indent}${k}:`);
        walk(v as Record<string, unknown>, path, `${indent}  `);
      } else {
        const src = sourceOf(path);
        lines.push(`${indent}${k}: ${JSON.stringify(v)}${src ? `  # ${src}` : ""}`);
      }
    }
  };
  walk(draft, "", "");
  return lines.join("\n");
}

export function formatInit(round: number, draft: Record<string, unknown>, provenance: Record<string, string>, questions: Question[]): string {
  return safe(
    [
      `devflow-init — round ${round} of max 2`,
      "",
      "The profile .devflow/devflow.yaml as it would be written:",
      "```yaml",
      annotatedYaml(draft, provenance),
      "```",
      "",
      questionBlocks(questions),
      "",
      'Reply ok to accept every recommendation, answer by number, or write a change such as "verify.dod: make test-all". Reply stop to cancel.',
    ].join("\n"),
  );
}

export function formatRound(round: number, issue: string, title: string, questions: Question[]): string {
  return safe(
    [
      `Refine issue #${issue} "${title}" — round ${round} of max 2`,
      "",
      questionBlocks(questions),
      "",
      "Reply `ok` to accept every recommendation, or answer by number (`1: b, 2: ok, 3: <your text>`). Reply `stop` to cancel.",
    ].join("\n"),
  );
}

if (isEntry(import.meta)) {
  const round = Number(input("round"));
  if (round !== 1 && round !== 2) fail(`input 'round' must be 1 or 2, got '${input("round")}'`);
  let qs: unknown;
  try {
    qs = JSON.parse(input("questions"));
  } catch {
    fail("input 'questions' is not JSON");
  }
  if (!Array.isArray(qs) || qs.length === 0) fail("input 'questions' must be a non-empty array");
  let message: string;
  if (input("mode", false) === "init") {
    const draft = jsonInput("draft") ?? {};
    const provenance = jsonInput("provenance") ?? {};
    // apply-answers reads the draft and the questions of this round from here.
    writeFileSync(join(artifactsDir(), "current-round.json"), JSON.stringify({ round, profile: draft, provenance, questions: qs }, null, 2));
    message = formatInit(round, draft, provenance, qs as Question[]);
  } else message = formatRound(round, input("issue"), input("title", false), qs as Question[]);
  console.log(JSON.stringify({ message }));
}
