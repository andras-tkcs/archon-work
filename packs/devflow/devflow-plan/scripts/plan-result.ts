// Prints the tested plan's slug, branch, title and workflow; fails when the plan test did not pass.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { artifactsDir, fail } from "../../.shared/util.ts";

const file = join(artifactsDir(), "tested.json");
if (!existsSync(file)) fail("tested.json does not exist: the plan test did not pass");
const t = JSON.parse(readFileSync(file, "utf8"));
console.log(JSON.stringify({ slug: t.slug, branch: t.branch, title: t.title, workflow: t.workflow }));
