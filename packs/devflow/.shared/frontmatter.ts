// Front matter of the issue-folder files: parse, serialize (canonical key order), validate.
import { KINDS, PLAN_KINDS } from "./layout.ts";

export type FrontMatter = Record<string, unknown>;

export const KEY_ORDER = ["issue", "kind", "title", "revision", "design_revision", "run", "updated"] as const;

// Throws when the block is missing or is not a YAML mapping.
export function parse(text: string): { fm: FrontMatter; body: string } {
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) throw new Error("front matter is missing: the file must start with a --- block");
  let fm: unknown;
  try {
    fm = Bun.YAML.parse(m[1]);
  } catch (e) {
    throw new Error(`front matter is malformed: ${(e as Error).message}`);
  }
  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) throw new Error("front matter is malformed: it is not a mapping");
  let body = text.slice(m[0].length);
  if (body.startsWith("\n")) body = body.slice(1);
  return { fm: fm as FrontMatter, body };
}

function scalar(v: unknown): string {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)) return s;
  const plain =
    /^[A-Za-z0-9_][A-Za-z0-9_ ./-]*$/.test(s) && !/^(true|false|null|yes|no|on|off|~)$/i.test(s) && !/^[0-9.+-]+$/.test(s) && !/\s$/.test(s);
  return plain ? s : JSON.stringify(s);
}

export function serialize(fm: FrontMatter, body: string): string {
  const lines = KEY_ORDER.filter((k) => fm[k] !== undefined).map((k) => `${k}: ${scalar(fm[k])}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

const isPosInt = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 1;

// Every problem of the block for a file of <kind>; empty when it is valid.
export function validate(fm: FrontMatter, kind: string): string[] {
  if (kind === "deviations") return ["kind deviations is not supported yet"];
  if (!(KINDS as readonly string[]).includes(kind)) return [`unknown file kind '${kind}'`];
  const expected = KEY_ORDER.filter((k) => k !== "design_revision" || (PLAN_KINDS as readonly string[]).includes(kind));
  const errs: string[] = [];
  for (const k of expected) if (fm[k] === undefined || fm[k] === null || fm[k] === "") errs.push(`front matter key '${k}' is missing`);
  for (const k of Object.keys(fm)) {
    if (k === "design_revision" && kind === "design") errs.push("front matter 'design_revision' must not be present on a design");
    else if (!(expected as readonly string[]).includes(k)) errs.push(`front matter key '${k}' is not allowed`);
  }
  const present = Object.keys(fm).filter((k) => (expected as readonly string[]).includes(k));
  const order = expected.filter((k) => present.includes(k));
  if (errs.length === 0 && present.join(",") !== order.join(",")) errs.push(`front matter keys must be in the order ${expected.join(", ")}`);
  if (fm.kind !== undefined && fm.kind !== kind) errs.push(`front matter kind '${fm.kind}' does not match the file '${kind}.md'`);
  for (const k of ["issue", "revision", "design_revision"]) {
    if (fm[k] !== undefined && !isPosInt(fm[k])) errs.push(`front matter '${k}' must be a positive integer, got '${fm[k]}'`);
  }
  if (fm.updated !== undefined && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(fm.updated))) {
    errs.push(`front matter 'updated' must be a date YYYY-MM-DD, got '${fm.updated}'`);
  }
  return errs;
}
