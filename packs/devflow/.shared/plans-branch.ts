// Reads and writes the plans branch through a temporary worktree, so the run's own worktree is untouched.
// A push is never forced: a rejected push fails with the tail of git's output.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fail, must, run, tail } from "./util.ts";

const ident = ["-c", "user.name=devflow", "-c", "user.email=devflow@example.invalid"];

// Fetches origin/<ref> and returns its commit, or "" when the branch does not exist on origin.
export function fetchPlans(ref: string): string {
  if (run(["git", "ls-remote", "--exit-code", "--heads", "origin", ref]).code !== 0) return "";
  must(["git", "fetch", "-q", "origin", `+refs/heads/${ref}:refs/remotes/origin/${ref}`]);
  return must(["git", "rev-parse", `refs/remotes/origin/${ref}`]);
}

// The content of <path> at <commit>, or null when the path does not exist there.
export function readAt(commit: string, path: string): string | null {
  const r = run(["git", "show", `${commit}:${path}`]);
  return r.code === 0 ? r.out : null;
}

export interface CommitSpec {
  ref: string;
  files: Record<string, string>; // path from the branch root -> content
  message: string;
  trailers: Record<string, string>;
}

// Commits <files> on top of origin/<ref> (a new orphan branch when it is absent) and pushes. Returns the
// commit; when the files are already there it returns the tip unchanged.
export function commitFiles({ ref, files, message, trailers }: CommitSpec): string {
  const paths = Object.keys(files);
  if (paths.length === 0) fail("commitFiles: no files to commit");
  const base = fetchPlans(ref);
  const tmp = join(mkdtempSync(join(tmpdir(), "devflow-plans-")), "wt");
  const orphan = base ? "" : `${ref}-${process.env.WORKFLOW_ID || "run"}`;
  let problem = "";
  let commit = "";
  try {
    if (base) must(["git", "worktree", "add", "-q", "--detach", tmp, base]);
    else must(["git", "worktree", "add", "-q", "--orphan", "-b", orphan, tmp]);
    for (const [path, content] of Object.entries(files)) {
      const abs = join(tmp, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    must(["git", "-C", tmp, "add", "--", ...paths]);
    if (base && run(["git", "-C", tmp, "diff", "--cached", "--quiet"]).code === 0) return base;
    const trailerText = Object.entries(trailers).map(([k, v]) => `${k}: ${v}`).join("\n");
    const msg = trailerText ? ["-m", message, "-m", trailerText] : ["-m", message];
    must(["git", ...ident, "-C", tmp, "commit", "-q", ...msg]);
    commit = must(["git", "-C", tmp, "rev-parse", "HEAD"]);
    const push = run(["git", "-C", tmp, "push", "-q", "origin", `HEAD:refs/heads/${ref}`]);
    if (push.code !== 0) problem = `the push to ${ref} was rejected:\n${tail(push.err + push.out, 20)}`;
  } finally {
    run(["git", "worktree", "remove", tmp]);
    rmSync(dirname(tmp), { recursive: true, force: true });
    run(["git", "worktree", "prune"]);
    if (orphan) run(["git", "branch", "-D", orphan]);
  }
  // fail() exits the process, so it runs only after the worktree is removed.
  if (problem) fail(problem);
  return commit;
}
