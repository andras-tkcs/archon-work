// Copies before.md of the issue at the plan commit to $ARTIFACTS_DIR/before.md for the before-check
// agent, and lists its items. Env: INPUTS_PLAN_COMMIT, INPUTS_ISSUE, INPUTS_PLANS_DIR.
// Prints { items: [{ n, title }] }.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileOf } from "./layout.ts";
import { artifactsDir, fail, input, plansConfig, run } from "./util.ts";

const issue = Number(input("issue"));
const path = fileOf(plansConfig().dir, issue, "before");
const shown = run(["git", "show", `${input("plan_commit")}:${path}`]);
if (shown.code !== 0) fail(`cannot read ${path} at ${input("plan_commit")}: ${shown.err.trim()}`);
writeFileSync(join(artifactsDir(), "before.md"), shown.out);
const items = [...shown.out.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => ({ n: Number(m[1]), title: m[2].trim() }));
console.log(JSON.stringify({ items }));
