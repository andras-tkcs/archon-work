// Prints the tested plan's issue, revision, branch, title and workflow; fails when the plan test did not pass.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { artifactsDir, fail } from "./util.ts";

const file = join(artifactsDir(), "tested.json");
if (!existsSync(file)) fail("tested.json does not exist: the plan test did not pass");
const t = JSON.parse(readFileSync(file, "utf8"));
console.log(JSON.stringify({ issue: t.issue, revision: t.revision, branch: t.branch, title: t.title, workflow: t.workflow }));
