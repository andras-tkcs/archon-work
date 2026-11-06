// devflow-init's write step: validates the final draft with validate-profile.py and writes
// .devflow/devflow.yaml in a fixed key order with a one-line comment per top-level key. A draft
// equal in content to the existing profile leaves the file untouched, so a re-run changes nothing.
// Env: INPUTS_PROFILE (the draft, JSON). On errors fails listing them all. Prints { path, changed }.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PROFILE_PATH, artifactsDir, fail, isEntry, jsonInput, run } from "./util.ts";

export const KEY_ORDER = ["version", "project", "docs", "git", "verify", "ci", "stacks", "plans", "project_steward"];
const COMMENTS: Record<string, string> = {
  version: "Profile format version.",
  project: "The project's name.",
  docs: "What every agent reads first; ADRs and the changelog.",
  git: "Default branch, branch names and merge style.",
  verify: "Commands: fast after each step, dod before the PR, ci_local for local CI.",
  ci: "GitHub Actions workflows an agent may dispatch.",
  stacks: "Stack notes the agents read (knowledge/stack-<name>.md).",
  plans: "Where the plans branch is.",
  project_steward: "Project policy no other key holds.",
};

export function renderProfile(p: Record<string, unknown>): string {
  const keys = [...KEY_ORDER.filter((k) => k in p), ...Object.keys(p).filter((k) => !KEY_ORDER.includes(k))];
  const blocks = keys.map((k) => `${COMMENTS[k] ? `# ${COMMENTS[k]}\n` : ""}${Bun.YAML.stringify({ [k]: p[k] }, null, 2).trimEnd()}\n`);
  return [
    "# devflow profile: read by every devflow workflow. Written by devflow-init; rerun it to change it.",
    "# Schema: profile.schema.json in the devflow pack's .shared/ directory (README section \"Profile\").",
    "",
    blocks.join("\n"),
  ].join("\n");
}

const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

// Returns the errors of validate-profile.py for <text>, checked against the repository at <root>.
export function validateProfile(text: string, root = "."): string[] {
  const tmp = join(artifactsDir(), "devflow.draft.yaml");
  writeFileSync(tmp, text);
  const v = run(["python3", join(import.meta.dir, "validate-profile.py"), tmp, "--root", root]);
  return v.code === 0 ? [] : (v.err.trim() || v.out.trim() || "validate-profile.py failed").split("\n");
}

if (isEntry(import.meta)) {
  const draft = jsonInput("profile");
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) fail("input 'profile' must be a JSON object");
  const text = renderProfile(draft);
  const errors = validateProfile(text);
  if (errors.length) fail(`the profile does not validate; nothing was written (rerun devflow-init with a hint that fixes it):\n${errors.map((e) => `- ${e}`).join("\n")}`);
  let same = false;
  if (existsSync(PROFILE_PATH)) {
    try {
      same = canon(Bun.YAML.parse(readFileSync(PROFILE_PATH, "utf8"))) === canon(draft);
    } catch {}
  }
  if (!same) {
    mkdirSync(dirname(PROFILE_PATH), { recursive: true });
    writeFileSync(PROFILE_PATH, text);
  }
  console.log(JSON.stringify({ path: PROFILE_PATH, changed: !same }));
}
