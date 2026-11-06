// Merges one wave of a build's phases into the feature branch (mod-devflow-merge). Only phases whose
// shared outcome is `done` are merged, each with `--no-ff` and the trailer `Plan-Phase: <slug>/<id>`;
// a head the branch already contains is skipped. A conflict is not fatal: the merge is aborted, the
// conflict is recorded as outcome merge-<id> (push-all later pushes its head as <branch>-partial-<id>)
// and the next phase is merged. Env: INPUTS_SLUG, INPUTS_PHASES (comma list, wave order),
// INPUTS_TITLES (JSON {id: title}), INPUTS_RUN_KEY, INPUTS_WAVE (the wave's record is outcome wave-<k>).
import { readOutcome, writeOutcome } from "./outcomes.ts";
import { fail, input, jsonInput, must, run, tail } from "./util.ts";

const slug = input("slug");
const runKey = input("run_key");
const wave = input("wave", false) || "1";
const titles: Record<string, string> = jsonInput("titles") ?? {};
const phases = input("phases").split(",").map((p) => p.trim()).filter(Boolean);

const merged: string[] = [];
const conflicts: string[] = [];
const notDone: string[] = [];
for (const id of phases) {
  const o = readOutcome(runKey, id);
  if (o?.status !== "done" || !o.head) {
    notDone.push(id);
    continue;
  }
  if (run(["git", "merge-base", "--is-ancestor", o.head, "HEAD"]).code === 0) {
    console.error(`${id} is already merged`);
    continue;
  }
  const r = run(["git", "merge", "--no-ff", o.head, "-m", `Merge ${slug} ${id}: ${titles[id] ?? id}`, "-m", `Plan-Phase: ${slug}/${id}`]);
  if (r.code === 0) {
    merged.push(id);
    continue;
  }
  const abort = run(["git", "merge", "--abort"]);
  if (abort.code !== 0) fail(`merging ${id} failed and could not be aborted:\n${tail(r.out + r.err + abort.err, 30)}`);
  conflicts.push(id);
  writeOutcome(`merge-${id}`, { status: "conflict", phase: id, head: o.head, detail: tail(r.out + r.err, 20) });
  console.error(`devflow: merging ${id} conflicts; recorded, the next phase is merged`);
}

const head = must(["git", "rev-parse", "HEAD"]);
writeOutcome(`wave-${wave}`, { merged, conflicts, not_done: notDone });
console.log(JSON.stringify({ ok: true, head, merged, conflicts, not_done: notDone }));
