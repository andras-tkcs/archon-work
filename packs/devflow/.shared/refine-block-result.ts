// The outcome of mod-devflow-refine-block, read from the published design and the interview.
// Env: INPUTS_ISSUE, INPUTS_REVISION, INPUTS_DESIGN_URL.
// Output: { designed, issue, revision, design_url, questions_asked, assumptions, assumption_lines }.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { artifactsDir, input } from "./util.ts";

const art = artifactsDir();
const design = readFileSync(join(art, "final", "design.md"), "utf8");
const section = /^## Assumptions\n([\s\S]*?)(?=^## )/m.exec(design)?.[1] ?? "";
const lines = section.split("\n").filter((l) => l.startsWith("- **"));
const interview = existsSync(join(art, "interview.md")) ? readFileSync(join(art, "interview.md"), "utf8") : "";
console.log(
  JSON.stringify({
    designed: true,
    issue: Number(input("issue")),
    revision: Number(input("revision")),
    design_url: input("design_url"),
    questions_asked: interview.split("\n").filter((l) => /^Q\d+: /.test(l)).length,
    assumptions: lines.length,
    assumption_lines: lines,
  }),
);
