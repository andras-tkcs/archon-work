// The machine form of the document scheme: one entry per kind, matching templates/<kind>.md.
// validate-docs.ts checks files against it; part 11 of the shared tests checks the templates against it.
import type { Kind } from "./layout.ts";

export type DocKind = Exclude<Kind, "deviations">;
export const DOC_KINDS: DocKind[] = ["design", "plan", "plan-test", "before", "after"];

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
  blocks?: Blocks;
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
export const LINK_TARGETS = ["design.md", "plan.md", "plan-test.md", "before.md", "after.md", "deviations.md"];

const revisionLog: Section = { title: "Revision log", required: true };

export const SCHEMA: Record<DocKind, Schema> = {
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
    blocks: { section: "Decisions", prefix: "D", labels: ["- Choice:", "- Rejected:", "- Why:", "- Source:"] },
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
    blocks: { section: "Cases", prefix: "T", labels: ["- Covers:", "- Level:", "- Phase:", "- Check:"] },
  },
  before: { h1: "Before implementing ", fixed: [], sections: [], items: { labels: ["Why:", "Steps:", "Secret:", "**Done when:**"] } },
  after: { h1: "After implementing ", fixed: [], sections: [], items: { labels: ["Why:", "Steps:", "**Report:**"] } },
};
