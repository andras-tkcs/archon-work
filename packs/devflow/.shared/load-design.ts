// Reads the published design.md (and plan.md, when the issue was planned before) at the plans
// commit resolve read, into $ARTIFACTS_DIR/design.md and existing-plan.md, and checks the design
// with validate-docs: a person may have edited it by hand. An invalid design is a refusal that lists
// every error. Env: INPUTS_ISSUE, INPUTS_PLANS_COMMIT, INPUTS_PLANS_REF, INPUTS_PLANS_DIR.
// Output: { design_revision, refusal }.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "./frontmatter.ts";
import { fileOf } from "./layout.ts";
import { readAt } from "./plans-branch.ts";
import { artifactsDir, fail, input, plansConfig } from "./util.ts";
import { formatErrors, validateDocs } from "./validate-docs.ts";

const art = artifactsDir();
const n = Number(input("issue"));
const commit = input("plans_commit");
const plans = plansConfig();

const design = readAt(commit, fileOf(plans.dir, n, "design"));
if (design === null) fail(`${fileOf(plans.dir, n, "design")} is not at ${commit}`);
writeFileSync(join(art, "design.md"), design);
const plan = readAt(commit, fileOf(plans.dir, n, "plan"));
if (plan === null) rmSync(join(art, "existing-plan.md"), { force: true });
else writeFileSync(join(art, "existing-plan.md"), plan);

const r = validateDocs({ issue: n, ref: commit, plansDir: plans.dir, kinds: ["design"] });
const refusal = r.ok
  ? ""
  : `Not planned: design.md of issue #${n} does not validate. Fix it on the ${plans.ref} branch and rerun:\n${formatErrors(r.errors)}`;
console.log(JSON.stringify({ design_revision: r.ok ? Number(parse(design).fm.revision) : 0, refusal }));
