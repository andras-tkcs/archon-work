// devflow-plan found a gap the design leaves and it cannot decide: put the question on the issue
// comment for the next devflow-refine. Nothing is committed. Env: INPUTS_ISSUE, INPUTS_QUESTION,
// INPUTS_WHY. Output: { planned: false, needs_refine: true, comment_url }.
import { upsertComment } from "./issue-comment.ts";
import { input } from "./util.ts";

const n = Number(input("issue"));
const c = upsertComment(n, { needs_refine: { question: input("question"), why: input("why"), run: process.env.WORKFLOW_ID || "run" } });
console.log(JSON.stringify({ planned: false, needs_refine: true, comment_url: c.url }));
