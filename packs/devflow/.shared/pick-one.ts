// Prints the output of the one routed step that ran (small, medium or large); the others were skipped by their `when:`.
import { fail, input } from "./util.ts";

const ran = ["small", "medium", "large"].map((n) => [n, input(n, false)] as const).filter(([, v]) => v.trim() !== "");
if (ran.length !== 1) fail(`expected exactly one routed step to run, got ${ran.length} (${ran.map(([n]) => n).join(", ") || "none"})`);
console.log(ran[0][1].trim());
