// The machine form of the document scheme: one entry per kind, matching templates/<kind>.md.
// validate-docs.ts checks files against it; part 11 of the shared tests checks the templates against it.
import { KINDS, type Kind } from "./layout.ts";

export { DOC_KINDS, KINDS, type DocKind, type Kind } from "./layout.ts";

export interface Section {
  title: string;
  required: boolean;
  none?: boolean; // the section may be the single line `None.`
  labels?: string[]; // fixed label lines inside the section, in order
}

export interface Blocks {
  section: string; // the H2 that holds the blocks
  prefix: string; // ### <prefix><n>. <title>
  labels: string[]; // the block's lines start with these, in order
}

export interface Schema {
  h1: string; // the H1 is `# <h1><title>`
  fixed: RegExp[]; // the lines under the H1, before the first H2 (blank lines aside)
  sections: Section[]; // the H2s in order; empty for item kinds
  blocks?: Blocks[];
  items?: { labels: string[] }; // item kinds: `## <n>. <title>` blocks, the last label ends each
}

export const NONE = "None.";
export const NO_MANUAL_STEPS = "No manual steps.";
export const WARNING_LINE = /^> /; // the unresolved-findings note publish-plan puts under the Design line
export const DESIGN_LINE = /^Design: design\.md r(\d+)$/;
export const PLAN_LINE = /^Plan: plan\.md r(\d+)$/;
export const ACCEPTANCE_RE = /^- A(\d+)\. \S/;
export const DESIGN_ASSUMPTION_RE = /^- \*\*[^*]+\*\*: .+\. Why: .+\. Change it by running devflow-refine with: ".+"\.$/;
export const REVISION_RE = /^- r(\d+) \(\d{4}-\d{2}-\d{2}, run [^\s)]+\): \S/;
export const RULING_RE = /^- \*\*Q:\*\* .+ \*\*A:\*\* .+ \*\*Source:\*\* \S/;
export const RELATED_RE = /^- \S+ — \S/;
export const SOURCE_FORMS = [/^answer Q\d+ round [12]$/, /^ADR \S+$/, /^code \S+$/, /^rulings\.md$/, /^issue comment https?:\/\/\S+$/];
export const LEVELS = ["unit", "integration", "e2e"];
// deviations.md: the Outcome line, the table of phases that are not done, and the follow-up blocks.
export const OUTCOME_RE = /^(running|completed|stopped) — phases: (\d+) done, (\d+) stuck, (\d+) skipped\. Branch: \S+\. PR: .+\. Run: .+\.$/;
export const TABLE_HEAD = "| phase | state | reason | partial branch |";
export const TABLE_SEP = "|---|---|---|---|";
export const PHASE_STATES = ["stuck", "failed", "skipped", "conflict"];
export const STUCK_STATES = ["stuck", "failed", "conflict"];
export const FOLLOWUP_RE = /^### F(\d+) \(\d{4}-\d{2}-\d{2}, run [^\s)]+\): .+ → (done|stuck)$/;
export const FOLLOWUP_LINES = ["- Summary: ", "- Stuck: ", "- Decision: ", "- Deviation: "];
export const AFTER_POINTER = "See after.md; these steps are always yours.";
// Rule V2: a template or draft leftover anywhere in a file.
export const LEFTOVER_RE = /\{\{|<!-- guide|<!-- repeat|\bTODO\b|\bTBD\b/;
// Rule V7: a markdown link; its target is the capture.
export const LINK_RE = /\]\(([^)\s]+)\)/g;
// Quoted text (a reviewer's finding) made harmless for the rules that scan every line: V2 leftovers
// are broken up, and links become plain text, so quoting it cannot fail V2 or V7. The brace and link
// arms use lookaheads so overlapping input ("{{{", "[a](b](c)") leaves no match behind.
export const defuseQuoted = (s: string) =>
  s
    .replace(/\{(?=\{)/g, "{ ")
    .replace(/<!-- (guide|repeat)/g, "< !-- $1")
    .replace(/\b(TODO|TBD)\b/g, (m) => m.toLowerCase())
    .replace(/\](?=\()/g, "] ");
export const LINK_TARGETS = KINDS.map((k) => `${k}.md`);

const revisionLog: Section = { title: "Revision log", required: true };

export const SCHEMA: Record<Kind, Schema> = {
  design: {
    h1: "",
    fixed: [],
    sections: [
      { title: "Problem", required: true },
      { title: "Goal and non-goals", required: true, labels: ["**Goal:**", "**Non-goals:**"] },
      { title: "Decisions", required: true },
      { title: "Design", required: true },
      { title: "Impact", required: true },
      { title: "Acceptance", required: true },
      { title: "Assumptions", required: true, none: true },
      { title: "Risks", required: true, none: true },
      { title: "Related work", required: true, none: true },
      revisionLog,
      { title: "Proposed rulings", required: false },
    ],
    blocks: [{ section: "Decisions", prefix: "D", labels: ["- Choice:", "- Rejected:", "- Why:", "- Source:"] }],
  },
  plan: {
    h1: "",
    fixed: [DESIGN_LINE],
    sections: [
      { title: "Goal", required: true },
      { title: "Current state", required: false },
      { title: "Context", required: false },
      { title: "Design", required: true },
      { title: "Steps", required: false },
      { title: "Acceptance", required: false },
      { title: "Stop conditions", required: false },
      { title: "Phases and models", required: true },
      { title: "ADRs", required: false },
      { title: "Manual steps", required: false },
      { title: "Risks and open questions", required: true },
      { title: "Implementation manifest", required: true },
      { title: "Assumptions", required: true, none: true },
      revisionLog,
    ],
  },
  "plan-test": {
    h1: "Test plan for ",
    fixed: [DESIGN_LINE, PLAN_LINE],
    sections: [
      { title: "Strategy", required: true },
      { title: "Cases", required: true },
      { title: "Not tested", required: true, none: true },
      revisionLog,
    ],
    blocks: [{ section: "Cases", prefix: "T", labels: ["- Covers:", "- Level:", "- Phase:", "- Check:"] }],
  },
  before: { h1: "Before implementing ", fixed: [], sections: [], items: { labels: ["Why:", "Steps:", "Secret:", "**Done when:**"] } },
  after: { h1: "After implementing ", fixed: [], sections: [], items: { labels: ["Why:", "Steps:", "**Report:**"] } },
  deviations: {
    h1: "Deviations and decisions: ",
    fixed: [],
    sections: [
      { title: "Outcome", required: true },
      { title: "Stuck and skipped phases", required: true, none: true },
      { title: "Deviations from design and plan", required: true, none: true },
      { title: "Decisions taken", required: true, none: true },
      { title: "Tests", required: true },
      { title: "Before steps", required: true, none: true },
      { title: "After steps", required: true },
      { title: "Review and CI", required: true, none: true },
      { title: "Follow-ups", required: true, none: true },
    ],
    blocks: [
      { section: "Deviations from design and plan", prefix: "V", labels: ["- Phase:", "- Planned:", "- Done:", "- Why:"] },
      { section: "Decisions taken", prefix: "K", labels: ["- Phase:", "- Choice:", "- Alternatives:", "- Why:"] },
    ],
  },
};
