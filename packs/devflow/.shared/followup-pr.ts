// After a follow-up on an open PR: one marked PR comment (<!-- devflow-followup:issue-<n> -->, edited
// in place) shows the follow-up entries of deviations.md, and a draft PR that devflow-dod opened for a
// red local CI is marked ready once the definition of done is green and local CI is green or
// skipped. Never converts a PR to a draft and
// never fails the run: problems are in the output. Env: INPUTS_PR_NUMBER, INPUTS_ISSUE.
// Prints { ok, comment_url, ready, problems }.
import { existsSync, readFileSync } from "node:fs";
import { readOwnOutcome } from "./outcomes.ts";
import { parse } from "./frontmatter.ts";
import { input, run } from "./util.ts";
import { deviationsPath, sectionText } from "./write-deviations.ts";

const pr = input("pr_number");
const issue = Number(input("issue"));
const marker = `<!-- devflow-followup:issue-${issue} -->`;
const problems: string[] = [];
const gh = (args: string[], stdin?: string) => {
  const p = Bun.spawnSync(["gh", ...args], { stdin: stdin === undefined ? undefined : new TextEncoder().encode(stdin), stdout: "pipe", stderr: "pipe", env: process.env });
  return { code: p.exitCode ?? 1, out: p.stdout.toString(), err: p.stderr.toString() };
};

let commentUrl = "";
const file = deviationsPath(issue);
const followups = existsSync(file) ? sectionText(parse(readFileSync(file, "utf8")).body, "Follow-ups") : "";
const body = `${marker}\n### devflow follow-ups\n\n${followups || "None."}\n\nFull record: \`${file}\` on this branch.\n`;
const list = gh(["api", "--paginate", `repos/{owner}/{repo}/issues/${pr}/comments`, "--jq", ".[] | {id, body, html_url}"]);
if (list.code !== 0) problems.push(`cannot list the PR's comments: ${list.err.trim().split("\n")[0]}`);
else {
  const found = list.out.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).find((c: any) => String(c.body).startsWith(marker));
  const payload = JSON.stringify({ body });
  const w = found
    ? gh(["api", "--method", "PATCH", `repos/{owner}/{repo}/issues/comments/${found.id}`, "--input", "-"], payload)
    : gh(["api", "--method", "POST", `repos/{owner}/{repo}/issues/${pr}/comments`, "--input", "-"], payload);
  if (w.code !== 0) problems.push(`the follow-up comment was not written: ${w.err.trim().split("\n")[0]}`);
  else {
    try {
      commentUrl = JSON.parse(w.out).html_url ?? "";
    } catch {}
  }
}

let ready = false;
const dod = readOwnOutcome("dod");
const ci = readOwnOutcome("ci-local");
if (dod?.green === true && (ci?.status === "green" || ci?.status === "skipped")) {
  const view = gh(["pr", "view", pr, "--json", "isDraft,body"]);
  if (view.code !== 0) problems.push(`cannot read PR #${pr}: ${view.err.trim().split("\n")[0]}`);
  else {
    const v = JSON.parse(view.out);
    if (v.isDraft && String(v.body ?? "").includes("<!-- devflow:draft-ci -->")) {
      const r = run(["gh", "pr", "ready", pr]);
      if (r.code === 0) ready = true;
      else problems.push(`gh pr ready ${pr} failed: ${r.err.trim().split("\n")[0]}`);
    }
  }
}
if (problems.length) console.error(`devflow: ${problems.join("; ")}`);
console.log(JSON.stringify({ ok: problems.length === 0, comment_url: commentUrl, ready, problems }));
