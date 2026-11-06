// Publishes $ARTIFACTS_DIR/final/design.md to the plans branch: the commit is checked with
// validate-docs before it is pushed, then the issue comment is updated. Env: INPUTS_ISSUE, INPUTS_TITLE, INPUTS_REVISION,
// INPUTS_PLANS_REF, INPUTS_PLANS_DIR. Output: { commit, revision, design_url, comment_url }.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoSlug } from "./gh.ts";
import { upsertComment } from "./issue-comment.ts";
import { fileOf } from "./layout.ts";
import { commitFiles } from "./plans-branch.ts";
import { artifactsDir, fail, input, isEntry, plansConfig } from "./util.ts";
import { formatErrors, validateDocs } from "./validate-docs.ts";

// The entries of the design's `## Proposed rulings` section, one `- **Q:** …` line each.
export function proposedRulings(text: string): string[] {
  const m = /^## Proposed rulings\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text);
  return m ? m[1].split("\n").filter((l) => l.startsWith("- **Q:**")) : [];
}

if (isEntry(import.meta)) {
  const n = Number(input("issue"));
  const revision = Number(input("revision"));
  const title = input("title");
  const plans = plansConfig();
  const text = readFileSync(join(artifactsDir(), "final", "design.md"), "utf8");
  const path = fileOf(plans.dir, n, "design");
  const run = process.env.WORKFLOW_ID || "run";
  const commit = commitFiles({
    ref: plans.ref,
    files: { [path]: text },
    message: `Design issue-${n} r${revision}: ${title}`,
    trailers: { Issue: `#${n}`, Run: run },
    check: (c) => {
      const r = validateDocs({ issue: n, ref: c, plansDir: plans.dir, kinds: ["design"] });
      return r.ok ? "" : `design.md does not validate; nothing was pushed and the issue comment is unchanged:\n${formatErrors(r.errors)}`;
    },
  });

  let repo: string;
  try {
    repo = repoSlug();
  } catch (e) {
    fail(`${(e as Error).message}\nThe design is already pushed in commit ${commit}.`);
  }
  const comment = upsertComment(n, { design: { revision, commit, title }, proposed_rulings: proposedRulings(text), needs_refine: null, plans, repo }, commit);
  console.log(JSON.stringify({ commit, revision, design_url: `https://github.com/${repo}/blob/${plans.ref}/${path}`, comment_url: comment.url }));
}
