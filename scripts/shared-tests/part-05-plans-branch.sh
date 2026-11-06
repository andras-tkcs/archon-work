#!/usr/bin/env bash
# plans-branch.ts: orphan branch when absent, commit on top, rejected push fails and never forces,
# the temporary worktree is always removed.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

mk_clone
repo="$REPO"
cat > "$repo/pb.ts" <<TS
import { commitFiles, fetchPlans, readAt } from "$SHARED/plans-branch.ts";
const [, , cmd, a] = process.argv;
if (cmd === "commit") console.log(commitFiles({ ref: "plans", files: JSON.parse(a), message: process.argv[4], trailers: { Issue: "#42", Run: "r1" } }));
else if (cmd === "fetch") console.log(JSON.stringify(fetchPlans(a)));
else if (cmd === "read") console.log(JSON.stringify(readAt(a, process.argv[4])));
TS
pb() { (cd "$repo" && bun pb.ts "$@"); }
worktrees() { git -C "$repo" worktree list | wc -l | tr -d ' '; }

eq "$(pb fetch plans)" '""' "fetchPlans returns empty when the branch is absent"

c1="$(pb commit '{"plans/plans/issue-42/design.md":"A\n"}' 'Design issue-42 r1: t')"
eq "$(git -C "$ORIGIN" rev-parse refs/heads/plans)" "$c1" "an orphan plans branch is pushed"
eq "$(git -C "$ORIGIN" rev-list --count plans)" "1" "the orphan branch has one commit"
eq "$(git -C "$ORIGIN" log -1 --format=%B plans)" $'Design issue-42 r1: t\n\nIssue: #42\nRun: r1' "message and trailers"
eq "$(git -C "$repo" branch --list 'plans-*' | wc -l | tr -d ' ')" "0" "no leftover local orphan branch"

c2="$(pb commit '{"plans/workflows/build-issue-42.yaml":"name: x\n"}' 'second')"
eq "$(git -C "$ORIGIN" rev-parse plans~1)" "$c1" "the second commit is on top of the first"
eq "$(git -C "$ORIGIN" ls-tree -r --name-only plans | tr '\n' ' ')" "plans/plans/issue-42/design.md plans/workflows/build-issue-42.yaml " "both files on the branch"
eq "$(pb fetch plans)" "\"$c2\"" "fetchPlans returns the tip"
eq "$(pb read "$c2" plans/plans/issue-42/design.md)" '"A\n"' "readAt reads the content"
eq "$(pb read "$c2" plans/nothing.md)" "null" "readAt returns null when absent"
eq "$(pb commit '{"plans/plans/issue-42/design.md":"A\n"}' 'same')" "$c2" "unchanged files make no commit"

# Stray files in the temporary worktree are never staged: only the given paths are added.
hooks="$(mk_tmp)"
printf '#!/usr/bin/env bash\necho stray > stray.md\n' > "$hooks/post-checkout"; chmod +x "$hooks/post-checkout"
git -C "$repo" config core.hooksPath "$hooks"
pb commit '{"plans/plans/issue-42/plan.md":"P\n"}' 'third' >/dev/null
git -C "$repo" config --unset core.hooksPath
lacks "$(git -C "$ORIGIN" ls-tree -r --name-only plans)" "stray.md" "an unlisted file is not committed"

# A rejected push (pre-receive refuses it) fails, and origin is never force-updated.
before="$(git -C "$ORIGIN" rev-parse plans)"
printf '#!/usr/bin/env bash\necho "refused by test" >&2\nexit 1\n' > "$ORIGIN/hooks/pre-receive"; chmod +x "$ORIGIN/hooks/pre-receive"
out="$(pb commit '{"plans/plans/issue-42/after.md":"X\n"}' 'fourth' 2>&1)"; code=$?
rm "$ORIGIN/hooks/pre-receive"
eq "$code" "1" "a rejected push fails"
contains "$out" "the push to plans was rejected" "the failure names the rejection"
contains "$out" "refused by test" "the failure shows git's output"
eq "$(git -C "$ORIGIN" rev-parse plans)" "$before" "origin's plans branch is unchanged"
eq "$(worktrees)" "1" "the temporary worktree is removed after a failed push"

# A rival push landed first: the push is not forced, the rival commit stays.
rival="$(mk_tmp)/c"
git clone -q -b plans "$ORIGIN" "$rival"
git -C "$rival" -c user.name=o -c user.email=o@example.invalid commit -q --allow-empty -m rival
hooks2="$(mk_tmp)"
printf '#!/usr/bin/env bash\n[ -e %q/fired ] && exit 0\ntouch %q/fired\ngit -C %q push -q origin plans\n' "$hooks2" "$hooks2" "$rival" > "$hooks2/post-checkout"; chmod +x "$hooks2/post-checkout"
git -C "$repo" config core.hooksPath "$hooks2"
out="$(pb commit '{"plans/plans/issue-42/before.md":"B\n"}' 'fifth' 2>&1)"; code=$?
git -C "$repo" config --unset core.hooksPath
eq "$code" "1" "a push behind a rival commit fails"
eq "$(git -C "$ORIGIN" rev-parse plans)" "$(git -C "$rival" rev-parse HEAD)" "the rival commit stays (never forced)"
eq "$(worktrees)" "1" "no leftover worktree"
finish
