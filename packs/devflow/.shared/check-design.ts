// Adds the front matter to the design write-design drafted ($ARTIFACTS_DIR/design.md, body only),
// writes $ARTIFACTS_DIR/final/design.md and checks it with validate-docs. Fails listing every error.
// Env: INPUTS_ISSUE, INPUTS_TITLE, INPUTS_REVISION_BASE (the published revision, 0 when none).
// Output: { ok, revision }.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serialize } from "./frontmatter.ts";
import { artifactsDir, fail, input } from "./util.ts";
import { formatErrors, validateDocs } from "./validate-docs.ts";

const art = artifactsDir();
const issue = Number(input("issue"));
const revision = Number(input("revision_base", false) || "0") + 1;
const body = readFileSync(join(art, "design.md"), "utf8");
const fm = { issue, kind: "design", title: input("title"), revision, run: process.env.WORKFLOW_ID || "run", updated: new Date().toISOString().slice(0, 10) };
mkdirSync(join(art, "final"), { recursive: true });
writeFileSync(join(art, "final", "design.md"), serialize(fm, body));
const r = validateDocs({ issue, dir: join(art, "final"), kinds: ["design"] });
if (!r.ok) fail(`design.md does not follow its template (${r.errors.length} errors); nothing was published:\n${formatErrors(r.errors)}`);
console.log(JSON.stringify({ ok: true, revision }));
