// The only module that builds issue-folder names, paths and markers.
export const ISSUES_SUBDIR = "plans";
export const slugOf = (n: number) => `issue-${n}`; // issue-42
export const folderOf = (plansDir: string, n: number) => `${plansDir}/${ISSUES_SUBDIR}/${slugOf(n)}`; // plans/plans/issue-42
// The four files devflow-plan writes; with design.md they are the documents validate-docs checks.
export const PLAN_KINDS = ["plan", "plan-test", "before", "after"] as const;
export const DOC_KINDS = ["design", ...PLAN_KINDS] as const;
export const KINDS = [...DOC_KINDS, "deviations"] as const;
export type Kind = (typeof KINDS)[number];
export type DocKind = (typeof DOC_KINDS)[number];
export const mainFolderOf = (n: number) => `${ISSUES_SUBDIR}/${slugOf(n)}`; // plans/issue-42 on main and on feature branches
export const fileOf = (plansDir: string, n: number, kind: Kind) => `${folderOf(plansDir, n)}/${kind}.md`;
export const workflowName = (n: number) => `build-issue-${n}`;
export const workflowFile = (plansDir: string, n: number) => `${plansDir}/workflows/${workflowName(n)}.yaml`;
export const SLUG_RE = /^issue-([0-9]+)$/;
export const commentMarker = (n: number) => `<!-- devflow:${slugOf(n)} -->`;
