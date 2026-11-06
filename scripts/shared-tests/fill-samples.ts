// Writes a complete issue-7 document set to <dir>, each file rendered from its template with sample
// values plus front matter. scripts/fixtures/docs/valid holds the same set.
import { render } from "../../packs/devflow/.shared/render-template.ts";
import { serialize } from "../../packs/devflow/.shared/frontmatter.ts";
import { writeFileSync } from "node:fs";
const out = process.argv[2];
const title = "Export reports as CSV";
const fm = (kind: string, extra: any = {}) => ({ issue: 7, kind, title, revision: 1, ...extra, run: "run-7", updated: "2026-11-06" });
const manifest = `plan_slug: issue-7
feature_branch: feat/issue-7-csv-export
max_parallel: 2
review_model: medium
review_model_reason: three phases, none large
manual_before: []
manual_after:
- id: ma1-open
  title: Open an exported file
  why: only a person can check the spreadsheet import
phases:
- id: p1-export
  title: CSV writer
  depends_on: []
  complexity: S
  model: small
  touches:
  - src/export.py
  brief: Add write_csv(rows) to src/export.py.
  acceptance:
  - make test passes
- id: p1-export-tests
  title: CSV writer tests
  depends_on: [p1-export]
  complexity: S
  model: small
  touches:
  - tests/test_export.py
  brief: Add tests T1 and T2 of plan-test.md to tests/test_export.py.
  acceptance:
  - make test passes
- id: verify
  title: Verify the test plan
  depends_on: [p1-export, p1-export-tests]
  complexity: S
  model: small
  touches: []
  brief: Run every case of plan-test.md and the design's Acceptance.
  acceptance:
  - make test passes`;
writeFileSync(`${out}/design.md`, serialize(fm("design"), render("design", {
  title, problem: "Reports can only be viewed in the browser (src/report.py:40).",
  goal: "A person can download any report as a CSV file.", non_goals: "None.",
  decisions: [
    { title: "Comma as the separator", choice: "Use a comma.", rejected: "A semicolon, which some locales prefer.", why: "Every spreadsheet reads it.", source: "answer Q1 round 1" },
    { title: "Stream the rows", choice: "Write rows as they are read.", rejected: "Build the file in memory.", why: "Reports can be large.", source: "code src/report.py" },
  ],
  design: "A new function write_csv(rows) in src/export.py, called from the report page's Download button.",
  impact: "src/export.py, src/report.py; the changelog gets one line.",
  acceptance: [{ statement: "The Download button returns a CSV file with a header row." }, { statement: "A report of 100000 rows downloads without loading it all in memory." }],
  assumptions: [{ decision: "File name", choice: "report-<id>.csv", reason: "it matches the page URL", example: "name the file after the report title" }],
  risks: "None.",
  related: [{ url: "https://github.com/o/r/issues/3", relation: "asked for the same export" }],
  revision: "1", date: "2026-11-06", run: "run-7", change: "first design, from the answer to Q1",
})));
writeFileSync(`${out}/plan.md`, serialize(fm("plan", { design_revision: 1 }), render("plan", {
  title, design_revision: "1",
  goal: "Issue #7: a person can download any report as a CSV file.",
  current_state: "", context: "Reports render in src/report.py:40; there is no export.",
  design: "write_csv(rows) in src/export.py streams rows with the csv module (D1, D2).",
  steps: "1. Add write_csv.\n2. Add the tests.", acceptance: "- make test passes.", stop_conditions: "Stop if src/report.py has no row iterator.",
  phases_and_models: "| Phase | Title | Complexity | Depends on | Model | Why this model |\n|---|---|---|---|---|---|\n| p1-export | CSV writer | S | — | small | default |\n| p1-export-tests | CSV writer tests | S | p1-export | small | default |\n| verify | Verify the test plan | S | p1-export, p1-export-tests | small | default |\n\nFinal build review: **medium**. three phases, none large",
  adrs: "", manual_steps: "", risks: "The row iterator may not be lazy; p1-export stops if it is not.",
  manifest, assumptions: "None.", revision: "1", date: "2026-11-06", run: "run-7", change: "first plan, from design r1",
}).replace(/## (Current state|ADRs|Manual steps)\n\n/g, "")));
writeFileSync(`${out}/plan-test.md`, serialize(fm("plan-test", { design_revision: 1 }), render("plan-test", {
  title, design_revision: "1", plan_revision: "1",
  strategy: "Unit tests with pytest through verify.dod (make test); no fixtures beyond a 3-row table.",
  cases: [
    { title: "Header row", covers: "A1, D1", level: "unit", phase: "p1-export-tests", check: "pytest tests/test_export.py::test_header" },
    { title: "Large report streams", covers: "A2, D2", level: "integration", phase: "verify", check: "make test-large keeps memory under 100 MB" },
  ],
  not_tested: "None.", revision: "1", date: "2026-11-06", run: "run-7", change: "first test plan",
})));
writeFileSync(`${out}/before.md`, serialize(fm("before", { design_revision: 1 }), render("before", { title, items: [] })));
writeFileSync(`${out}/after.md`, serialize(fm("after", { design_revision: 1 }), render("after", { title, items: [
  { title: "Open an exported file", why: "only a person can check the spreadsheet import", steps: "1. Download a report from https://example.invalid/reports.\n2. Open it in a spreadsheet.", report: "CSV opens with a header row: pass/fail" },
] })));
writeFileSync(`${out}/deviations.md`, serialize(
  { issue: 7, kind: "deviations", title, revision: 1, plan_revision: 1, build_outcome: "stopped", branch: "feat/issue-7-csv-export", run: "run-7", updated: "2026-11-06" },
  render("deviations", {
    title, outcome: "stopped", done: "1", stuck: "1", skipped: "1", branch: "feat/issue-7-csv-export", pr: "no PR (stopped)", run_link: "run-7",
    table: "| phase | state | reason | partial branch |\n|---|---|---|---|\n| p1-export-tests | stuck | fast checks red after the last step | feat/issue-7-csv-export-partial-p1-export-tests |\n| verify | skipped | dependency p1-export-tests is stuck | — |",
    deviations: [{ title: "Rows are written in batches of 1000", phase: "p1-export", planned: "write rows one by one", actual: "write batches of 1000 rows", why: "one write per row was too slow on 100000 rows" }],
    decisions: [{ title: "Quote every field", phase: "p1-export", choice: "csv.QUOTE_ALL", alternatives: "csv.QUOTE_MINIMAL", why: "the design is silent; quoting everything is the safe choice for spreadsheets" }],
    tests: "- p1-export: none\n- p1-export-tests: T1 fail\n- verify: not run\n\nCases of plan-test.md with no passing result: T1, T2",
    before: "None.", review: "None.", followups: "None.",
  }),
));
