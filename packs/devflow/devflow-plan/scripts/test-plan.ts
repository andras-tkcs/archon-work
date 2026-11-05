// Tests the plan before it is published: manifest validator, then a dry run of the rendered workflow with stubbed children.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactsDir, fail, input, must, run, tail } from "../../.shared/util.ts";

function parse(name: string, text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return fail(`input '${name}' is not JSON: ${text.slice(0, 200)}`);
  }
}

const art = artifactsDir();
const r = parse("render", input("render"));
const root = input("devflow_root");
const findings: any[] = [];
const add = (source: string, phase: string, problem: string, fix: string) =>
  findings.push({ id: `T${findings.length + 1}`, source, kind: "mechanical", phase, problem, fix });

if (!r.ok) add("render", "", String(r.error), "Change plan.md so the renderer accepts it.");

const v = run(["python3", join(root, "scripts", "validate_manifest.py"), join(art, "plan.md"), "--profile", ".claude/toolkit.yaml"]);
if (v.code !== 0) add("validate_manifest", "", tail(v.out + v.err, 40), "Fix every error validate_manifest.py prints.");

if (r.ok) {
  const scratch = mkdtempSync(join(tmpdir(), "devflow-test-plan-"));
  try {
    mkdirSync(join(scratch, ".archon", "workflows"), { recursive: true });
    copyFileSync(r.file, join(scratch, ".archon", "workflows", `${r.workflow}.yaml`));
    must(["git", "init", "-q", "-b", "main"], { cwd: scratch });
    must(["git", "add", "-A"], { cwd: scratch });
    must(["git", "-c", "user.name=devflow", "-c", "user.email=devflow@example.invalid", "commit", "-qm", "rendered"], { cwd: scratch });

    const doc: any = Bun.YAML.parse(readFileSync(r.file, "utf8"));
    const stubs: Record<string, unknown> = {};
    for (const n of doc.nodes ?? []) {
      if (n.wait !== undefined) stubs[n.id] = { decision: "approve", text: "ok" };
      else if (n.workflow !== undefined) stubs[n.id] = { head: "0".repeat(40), merged: true };
      else if (n.cancel !== undefined) continue;
      else if (n.bash !== undefined || n.script !== undefined) {
        if (n.output_format?.properties) {
          const o: Record<string, unknown> = {};
          for (const [k, p] of Object.entries<any>(n.output_format.properties)) {
            o[k] = p?.type === "boolean" ? true : p?.type === "integer" || p?.type === "number" ? 0 : "";
          }
          stubs[n.id] = o;
        } else stubs[n.id] = "ok";
      }
    }
    const stubsPath = join(scratch, "stubs.yaml");
    writeFileSync(stubsPath, Bun.YAML.stringify(stubs));

    const d = run(["archon", "workflow", "run", r.workflow, "--dry-run", "--stubs", stubsPath, "--json"], { cwd: scratch, timeoutMs: 180000 });
    const lines = d.out.split("\n");
    const end = lines.indexOf("}");
    const text = end >= 0 ? lines.slice(0, end + 1).join("\n") : d.out;
    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      fail(`the rendered ${r.workflow} does not complete a dry run (a renderer bug, not a plan problem):\n${tail(d.out + d.err, 40)}`);
    }
    const trace: any[] = j.trace ?? [];
    const tolerated: string[] = j.toleratedMissingStubs ?? [];
    const problems: string[] = [];
    if (j.outcome !== "completed") problems.push(`outcome is ${j.outcome ?? "missing"}`);
    for (const id of j.missingStubs ?? []) if (!tolerated.includes(id)) problems.push(`missing stub: ${id}`);
    const need = [...(doc.nodes ?? []).filter((n: any) => n.workflow !== undefined).map((n: any) => n.id), "result"];
    for (const id of need) {
      const t = trace.find((e) => e.nodeId === id);
      if (!t || t.state !== "stubbed") problems.push(`node ${id} is not stubbed (${t?.state ?? "not in the trace"})`);
    }
    if (problems.length) {
      const bad = trace.filter((e) => e.state !== "stubbed" && e.state !== "skipped").map((e) => `${e.nodeId} ${e.state} ${e.reason ?? ""}`.trimEnd());
      fail(`the rendered ${r.workflow} does not complete a dry run (a renderer bug, not a plan problem):\n${[...problems, ...bad].join("\n")}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({ ok: findings.length === 0, findings }));
