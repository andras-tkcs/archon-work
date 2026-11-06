// Fails the run before any model spend unless a valid profile and gh are both usable. Writes the
// resolved profile to $ARTIFACTS_DIR/profile.json for every later node, and copies the pack's
// knowledge files, templates and model rules into $ARTIFACTS_DIR, where the prompts read them.
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_PATH, artifactsDir, fail, must, run } from "./util.ts";

function branchRegex(pattern: string, types: string[] | undefined): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re = esc(pattern);
  re = re.replace(esc("<type>"), types && types.length ? `(${types.map(esc).join("|")})` : "[a-z]+");
  re = re.replace(esc("<kebab-case>"), "[a-z0-9]+(-[a-z0-9]+)*");
  re = re.replace(esc("<slug>"), "[a-z0-9]+(-[a-z0-9]+)*");
  return `^${re}$`;
}

const shared = import.meta.dir;
const art = artifactsDir();
if (!existsSync(PROFILE_PATH)) fail(`${PROFILE_PATH} not found: see the README section "Profile"`);
const v = run(["python3", join(shared, "validate-profile.py"), PROFILE_PATH, "--resolved"]);
if (v.code !== 0) fail(`the profile does not validate:\n${v.err}`);
if (v.err.trim()) console.error(v.err.trim());
const resolved = JSON.parse(v.out);
writeFileSync(join(art, "profile.json"), JSON.stringify(resolved, null, 2));

const stacks: string[] = resolved.stacks ?? [];
const knowledge = join(shared, "knowledge");
if (existsSync(knowledge)) {
  mkdirSync(join(art, "knowledge"), { recursive: true });
  for (const f of readdirSync(knowledge)) {
    const stack = /^stack-(.+)\.md$/.exec(f);
    if (stack && !stacks.includes(stack[1])) continue;
    cpSync(join(knowledge, f), join(art, "knowledge", f));
  }
}
if (existsSync(join(shared, "templates"))) cpSync(join(shared, "templates"), join(art, "templates"), { recursive: true });
if (existsSync(join(shared, "model-rules.md"))) cpSync(join(shared, "model-rules.md"), join(art, "model-rules.md"));

if (run(["gh", "auth", "status"]).code !== 0) fail("gh is not authenticated: the PR steps need it");
must(["git", "remote", "get-url", "origin"]);

console.log(
  JSON.stringify({
    shared_dir: shared,
    main_branch: resolved.git.main_branch,
    branch_regex: branchRegex(resolved.git.branch_pattern ?? "<type>/<kebab-case>", resolved.git.branch_types),
  }),
);
