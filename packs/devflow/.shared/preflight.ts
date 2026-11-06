// Fails the run before any model spend unless a valid profile and gh are both usable. Writes the
// resolved profile to $ARTIFACTS_DIR/profile.json for every later node, and copies the pack's
// knowledge files, templates and model rules into $ARTIFACTS_DIR, where the prompts read them.
// INPUTS_PROFILE=optional (devflow-init): a missing or invalid profile is not an error; the main
// branch then comes from GitHub. Prints has_profile and has_legacy (the retired toolkit's profile) as well.
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_PROFILE_PATH, MISSING_PROFILE, PROFILE_PATH, artifactsDir, fail, input, must, run } from "./util.ts";

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
const optional = input("profile", false) === "optional";
const hasProfile = existsSync(PROFILE_PATH);
const hasLegacy = existsSync(LEGACY_PROFILE_PATH);
let resolved: any = null;
if (!hasProfile && !optional) fail(MISSING_PROFILE);
if (hasProfile) {
  const v = run(["python3", join(shared, "validate-profile.py"), PROFILE_PATH, "--resolved"]);
  if (v.code === 0) {
    if (v.err.trim()) console.error(v.err.trim());
    resolved = JSON.parse(v.out);
    writeFileSync(join(art, "profile.json"), JSON.stringify(resolved, null, 2));
  } else if (!optional) fail(`the profile does not validate:\n${v.err}`);
  else console.error(`devflow: the profile does not validate (devflow-init rewrites it):\n${v.err.trim()}`);
}

const stacks: string[] = resolved?.stacks ?? [];
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

function defaultBranch(): string {
  const r = run(["gh", "repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"]);
  return (r.code === 0 && r.out.trim()) || "main";
}

console.log(
  JSON.stringify({
    shared_dir: shared,
    main_branch: resolved ? resolved.git.main_branch : defaultBranch(),
    branch_regex: resolved ? branchRegex(resolved.git.branch_pattern ?? "<type>/<kebab-case>", resolved.git.branch_types) : "",
    has_profile: hasProfile,
    has_legacy: hasLegacy,
  }),
);
