#!/usr/bin/env bash
# frontmatter.ts: round trip and every validation failure of spec §3.1.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

fm() { bun -e "import * as F from '$SHARED/frontmatter.ts'; $1"; }
val() { fm "console.log(F.validate($1, '$2').join(' | '))"; }

good='{issue:7,kind:"plan",title:"Add: a thing",revision:2,design_revision:1,run:"r-1",updated:"2026-11-06"}'
out="$(fm "const t=F.serialize($good,'# T\n\nbody\n'); const p=F.parse(t); console.log(JSON.stringify([t.split('\n')[0], p.body, p.fm, F.serialize(p.fm,p.body)===t]))")"
contains "$out" '"---","# T\n\nbody\n"' "body survives the round trip"
contains "$out" '"title":"Add: a thing"' "a quoted title survives"
contains "$out" ',true]' "serialize(parse(x)) == x"
out="$(fm "console.log(F.serialize($good,'b').split('\n').slice(1,8).map(l=>l.split(':')[0]).join(','))")"
eq "$out" "issue,kind,title,revision,design_revision,run,updated" "keys are written in the fixed order"

eq "$(val "$good" plan)" "" "a valid plan block"
eq "$(val '{issue:7,kind:"design",title:"t",revision:1,run:"r",updated:"2026-11-06"}' design)" "" "a valid design block"
contains "$(val '{issue:7,kind:"plan",title:"t",revision:1,run:"r",updated:"2026-11-06"}' plan)" "key 'design_revision' is missing" "missing key"
contains "$(val '{issue:7,kind:"design",title:"t",revision:1,run:"r",updated:"2026-11-06"}' plan)" "kind 'design' does not match the file 'plan.md'" "kind is not the file name"
contains "$(val '{issue:0,kind:"design",title:"t",revision:1,run:"r",updated:"2026-11-06"}' design)" "'issue' must be a positive integer" "issue not positive"
contains "$(val '{issue:7,kind:"design",title:"t",revision:"2",run:"r",updated:"2026-11-06"}' design)" "'revision' must be a positive integer" "revision not an integer"
contains "$(val '{issue:7,kind:"plan",title:"t",revision:1,design_revision:-1,run:"r",updated:"2026-11-06"}' plan)" "'design_revision' must be a positive integer" "design_revision not positive"
contains "$(val '{issue:7,kind:"design",title:"t",revision:1,design_revision:1,run:"r",updated:"2026-11-06"}' design)" "must not be present on a design" "design_revision on a design"
contains "$(val '{issue:7,kind:"design",title:"t",revision:1,run:"r",updated:"6.11.2026"}' design)" "'updated' must be a date YYYY-MM-DD" "bad date"
contains "$(val '{issue:7,kind:"design",title:"t",revision:1,run:"r",updated:"2026-11-06",status:"x"}' design)" "key 'status' is not allowed" "extra key"
contains "$(val '{kind:"design",issue:7,title:"t",revision:1,run:"r",updated:"2026-11-06"}' design)" "must be in the order" "keys out of order"
contains "$(val '{}' deviations)" "kind deviations is not supported yet" "deviations is refused"
contains "$(fm "try{F.parse('# no front matter\n')}catch(e){console.log(e.message)}")" "front matter is missing" "missing block"
contains "$(fm "try{F.parse('---\n- a\n---\n')}catch(e){console.log(e.message)}")" "not a mapping" "a list is not front matter"
finish
