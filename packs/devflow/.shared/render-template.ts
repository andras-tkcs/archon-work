// Fills templates/<kind>.md: replaces {{placeholders}}, expands <!-- repeat <key>: … --> blocks from
// arrays and strips the guide comments. Fails on a missing value and on a leftover {{.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NONE, NO_MANUAL_STEPS, SCHEMA, type Kind } from "./doc-schema.ts";

export type Values = Record<string, string | Record<string, string>[]>;

export function templateText(kind: Kind): string {
  return readFileSync(join(import.meta.dir, "templates", `${kind}.md`), "utf8");
}

function fill(text: string, values: Record<string, unknown>, where: string): string {
  return text.replace(/\{\{([a-z_]+)\}\}/g, (_, key: string) => {
    const v = values[key];
    if (typeof v !== "string" && typeof v !== "number") throw new Error(`${where}: no value for {{${key}}}`);
    return String(v);
  });
}

// The body of <kind>.md (no front matter) from <values>.
export function render(kind: Kind, values: Values): string {
  const lines = templateText(kind).split("\n");
  const out: string[] = [];
  let i = 0;
  let section = "";
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("## ")) section = line.slice(3);
    const repeat = /^<!-- repeat ([a-z_]+):/.exec(line);
    if (line.startsWith("<!-- guide:") || repeat) {
      while (!lines[i].includes("-->")) i++;
      i++;
      if (!repeat) continue;
      const block: string[] = [];
      while (i < lines.length && !(lines[i].startsWith("## ") && block.length > 0)) block.push(lines[i++]);
      while (block.length && block[block.length - 1] === "") block.pop();
      const items = values[repeat[1]];
      if (!Array.isArray(items)) throw new Error(`${kind}: no list for <!-- repeat ${repeat[1]} -->`);
      if (items.length === 0) {
        const s = SCHEMA[kind].sections.find((x) => x.title === section);
        if (SCHEMA[kind].items) out.push(NO_MANUAL_STEPS);
        else if (s?.none) out.push(NONE);
        else throw new Error(`${kind}: ${repeat[1]} needs at least one item`);
      } else {
        const sep = block.length > 1 ? [""] : [];
        items.forEach((item, k) => out.push(...(k ? sep : []), ...fill(block.join("\n"), { n: String(k + 1), ...values, ...item }, kind).split("\n")));
      }
      out.push("");
      continue;
    }
    out.push(fill(line, values, kind));
    i++;
  }
  const text = out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n");
  if (text.includes("{{")) throw new Error(`${kind}: a placeholder is left`);
  return text;
}
