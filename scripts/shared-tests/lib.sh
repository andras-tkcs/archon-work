#!/usr/bin/env bash
# Helpers for scripts/shared-tests/part-*.sh. Source this file.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SHARED="$REPO_ROOT/packs/devflow/.shared"
_FAILED=0
_ROOT="$(mktemp -d)"
trap 'rm -rf "$_ROOT"' EXIT
export WORKFLOW_ID=run-1

# mk_tmp: prints a new temp dir, removed at exit.
mk_tmp() { mktemp -d "$_ROOT/t.XXXXXX"; }

# mk_scratch: prints a new temp dir that is a git repo on main; removed at exit.
mk_scratch() {
  local d
  d="$(mk_tmp)"
  git -C "$d" init -q -b main
  git -C "$d" config user.name test
  git -C "$d" config user.email test@example.invalid
  echo "$d"
}

# mk_clone: sets REPO to a clone of a new local bare origin ORIGIN, with one commit on main pushed.
mk_clone() {
  ORIGIN="$(mk_tmp)/origin.git"
  git init -q --bare -b main "$ORIGIN"
  REPO="$(mk_scratch)"
  local repo="$REPO"
  git -C "$repo" remote add origin "$ORIGIN"
  echo base > "$repo/README.md"
  git -C "$repo" add README.md
  git -C "$repo" commit -qm base
  git -C "$repo" push -q origin main
}

# use_stub_gh: installs a stub gh first on PATH. Its state is in $GH_STUB_DIR: issue-<n>.json
# (served to `gh issue view <n>`), prs.json (`gh pr list`), comments-<n>.json (the issue's
# comments, changed by POST and PATCH), fail-<word> (makes every `gh <word> …` call fail).
# Every call is appended to calls.log as one line: `<METHOD> <endpoint>` for `gh api`, else the
# arguments.
use_stub_gh() {
  GH_STUB_DIR="$(mk_tmp)"
  export GH_STUB_DIR
  mkdir -p "$GH_STUB_DIR/bin"
  cat > "$GH_STUB_DIR/bin/gh" <<'STUB'
#!/usr/bin/env bash
exec bun "$(dirname "$0")/gh.ts" "$@"
STUB
  cat > "$GH_STUB_DIR/bin/gh.ts" <<'STUB'
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
const d = process.env.GH_STUB_DIR!;
const args = process.argv.slice(2);
const die = (m: string): never => { console.error(m); process.exit(1); };
if (existsSync(`${d}/fail-${args[0]}`)) { appendFileSync(`${d}/calls.log`, `${args.join(" ")}\n`); die("gh stub: forced failure"); }
const read = (f: string, dflt: string) => (existsSync(f) ? readFileSync(f, "utf8") : dflt);
if (args[0] === "api") {
  let method = "GET", endpoint = "", jq = "", input = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "-X" || a === "--method") method = args[++i];
    else if (a === "-H") i++;
    else if (a === "--jq" || a === "-q") jq = args[++i];
    else if (a === "--input") { input = true; i++; }
    else if (a.startsWith("-")) {}
    else if (!endpoint) endpoint = a;
  }
  const ep = endpoint.replace(/^\//, "").replace("repos/{owner}/{repo}/", "").replace("repos/o/r/", "");
  const body = input ? readFileSync(0, "utf8") : "";
  appendFileSync(`${d}/calls.log`, `${method} ${ep}\n`);
  let m = /^issues\/(\d+)\/comments$/.exec(ep);
  if (m) {
    const f = `${d}/comments-${m[1]}.json`;
    const arr = JSON.parse(read(f, "[]"));
    if (method === "GET") {
      if (jq) for (const c of arr) console.log(JSON.stringify({ id: c.id, body: c.body, html_url: c.html_url }));
      else console.log(JSON.stringify(arr));
      process.exit(0);
    }
    if (method === "POST") {
      const id = arr.reduce((x: number, c: any) => Math.max(x, c.id), 100) + 1;
      const c = { id, html_url: `https://github.com/o/r/issues/${m[1]}#issuecomment-${id}`, body: JSON.parse(body).body };
      arr.push(c);
      writeFileSync(f, JSON.stringify(arr));
      console.log(JSON.stringify(c));
      process.exit(0);
    }
  }
  m = /^issues\/comments\/(\d+)$/.exec(ep);
  if (m && method === "PATCH") {
    for (const f of new Bun.Glob(`${d}/comments-*.json`).scanSync()) {
      const arr = JSON.parse(readFileSync(f, "utf8"));
      const c = arr.find((x: any) => x.id === Number(m![1]));
      if (!c) continue;
      c.body = JSON.parse(body).body;
      writeFileSync(f, JSON.stringify(arr));
      console.log(JSON.stringify(c));
      process.exit(0);
    }
    die("gh stub: no such comment");
  }
  die(`gh stub: unhandled api ${method} ${ep}`);
}
appendFileSync(`${d}/calls.log`, `${args.join(" ")}\n`);
if (args[0] === "repo" && args[1] === "view") { console.log("o/r"); process.exit(0); }
if (args[0] === "auth") process.exit(0);
if (args[0] === "issue" && args[1] === "view") {
  const f = `${d}/issue-${args[2]}.json`;
  if (!existsSync(f)) die(`GraphQL: Could not resolve to an issue or pull request with the number of ${args[2]}.`);
  console.log(readFileSync(f, "utf8"));
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "list") { console.log(read(`${d}/prs.json`, "[]")); process.exit(0); }
die(`gh stub: unhandled: ${args.join(" ")}`);
STUB
  chmod +x "$GH_STUB_DIR/bin/gh"
  export PATH="$GH_STUB_DIR/bin:$PATH"
}

# gh_calls <pattern>: number of recorded gh calls matching the extended regex.
gh_calls() { grep -cE "$1" "$GH_STUB_DIR/calls.log" 2>/dev/null || true; }

ok() { echo "ok: $1"; }
_fail() { echo "FAIL: $1" >&2; _FAILED=1; }
# eq <actual> <expected> <message>
eq() { if [ "$1" = "$2" ]; then ok "$3"; else _fail "$3 (expected '$2', got '$1')"; fi; }
# contains <haystack> <needle> <message>
contains() { if [[ "$1" == *"$2"* ]]; then ok "$3"; else _fail "$3 (no '$2' in '$1')"; fi; }
# lacks <haystack> <needle> <message>
lacks() { if [[ "$1" != *"$2"* ]]; then ok "$3"; else _fail "$3 (unexpected '$2' in '$1')"; fi; }
finish() { exit "$_FAILED"; }
