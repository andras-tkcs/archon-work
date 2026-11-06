// devflow-init's scaffold step: creates what a repository needs besides the profile, and only what is
// missing; it never overwrites a file. .archon/devflow/policy/rulings.md (header only), the plans
// source in .archon/config.yaml (merged, other keys kept), the .gitignore line for Archon's
// worktrees, and the removal of a legacy .claude/toolkit.yaml once the profile exists.
// Env: INPUTS_PLANS_REF, INPUTS_PLANS_DIR (the profile's plans key, else plans). Prints { changed }.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PROFILE_PATH, isEntry, must, plansConfig, run } from "./util.ts";

export const RULINGS_PATH = ".archon/devflow/policy/rulings.md";
export const ARCHON_CONFIG = ".archon/config.yaml";
export const WORKTREES_IGNORE = ".archon/worktrees/";
const LEGACY_PATH = ".claude/toolkit.yaml";

export const RULINGS = `# Rulings

Answers to questions that come up again, settled once by the maintainers. The devflow workflows
read this file before asking a person and cite a ruling instead; they never write it. Change it
through a normal pull request.

One entry per ruling:

- **Q:** <the question it settles> **A:** <the answer> **Source:** <project document or issue/PR URL>
`;

// The Archon config with the plans source added; null when it is already there.
export function mergeArchonConfig(text: string | null, ref: string, path: string): string | null {
  const doc: any = text ? (Bun.YAML.parse(text) ?? {}) : {};
  if (typeof doc !== "object" || Array.isArray(doc)) throw new Error(`${ARCHON_CONFIG} is not a YAML mapping`);
  const list = Array.isArray(doc.extraWorkflowSources) ? doc.extraWorkflowSources : [];
  if (list.some((s: any) => s?.ref === ref && s?.path === path)) return null;
  const entry = { ref, path };
  if (text && !/^extraWorkflowSources\s*:/m.test(text)) {
    // Append, so the file's comments and layout stay as they are.
    return `${text.replace(/\n*$/, "\n")}${Bun.YAML.stringify({ extraWorkflowSources: [entry] }, null, 2)}`;
  }
  return Bun.YAML.stringify({ ...doc, extraWorkflowSources: [...list, entry] }, null, 2);
}

export function scaffold(root: string, ref: string, path: string): string[] {
  const changed: string[] = [];
  const at = (p: string) => join(root, p);
  if (!existsSync(at(RULINGS_PATH))) {
    mkdirSync(dirname(at(RULINGS_PATH)), { recursive: true });
    writeFileSync(at(RULINGS_PATH), RULINGS);
    changed.push(RULINGS_PATH);
  }
  const cfg = existsSync(at(ARCHON_CONFIG)) ? readFileSync(at(ARCHON_CONFIG), "utf8") : null;
  const merged = mergeArchonConfig(cfg, ref, path);
  if (merged !== null) {
    mkdirSync(dirname(at(ARCHON_CONFIG)), { recursive: true });
    writeFileSync(at(ARCHON_CONFIG), merged);
    changed.push(ARCHON_CONFIG);
  }
  const ignore = existsSync(at(".gitignore")) ? readFileSync(at(".gitignore"), "utf8") : "";
  if (!ignore.split("\n").some((l) => [WORKTREES_IGNORE, ".archon/worktrees", "/.archon/worktrees/"].includes(l.trim()))) {
    appendFileSync(at(".gitignore"), `${ignore && !ignore.endsWith("\n") ? "\n" : ""}${WORKTREES_IGNORE}\n`);
    changed.push(".gitignore");
  }
  if (existsSync(at(LEGACY_PATH)) && existsSync(at(PROFILE_PATH))) {
    if (run(["git", "-C", root, "ls-files", "--error-unmatch", "--", LEGACY_PATH]).code === 0) must(["git", "-C", root, "rm", "-q", "--", LEGACY_PATH]);
    else rmSync(at(LEGACY_PATH));
    changed.push(LEGACY_PATH);
  }
  return changed;
}

if (isEntry(import.meta)) {
  const plans = plansConfig();
  console.log(JSON.stringify({ changed: scaffold(".", plans.ref, plans.dir) }));
}
