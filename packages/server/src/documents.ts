import { documentFormat, type DocumentFormat } from "./source-paths.js";

/**
 * reStructuredText and AsciiDoc are rewritten line for line into the Markdown
 * constructs the document index already understands. Headings, diagram blocks,
 * tables and step lists keep their original line numbers, so every citation
 * still points at the real file.
 */

const fenceLanguage = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlank = (line: string | undefined): boolean => line === undefined || line.trim() === "";
// A Markdown header separator with one group per cell of the given row.
const separatorFor = (row: string): string =>
  `|${"---|".repeat(Math.max(2, row.trim().replace(/^\||\|$/g, "").split("|").length))}`;

function asciidocLines(source: readonly string[]): string[] {
  const out: string[] = [];
  let block: string | undefined;    // closing delimiter of the open listing or literal block
  let language: string | undefined; // from a block attribute line such as [source,js] or [mermaid]
  let table = false;
  for (let i = 0; i < source.length; i++) {
    const raw = source[i];
    const line = raw.trim();
    if (block !== undefined) {
      const closes = line === block;
      out.push(closes ? "```" : raw);
      if (closes) block = undefined;
      continue;
    }
    const attribute = /^\[([^\]]*)\]$/.exec(line);
    if (attribute) {
      const [style = "", second = ""] = attribute[1].split(",").map((part) => part.trim().toLowerCase());
      language = style === "source" ? fenceLanguage(second)
        : ["mermaid", "plantuml", "ditaa", "graphviz"].includes(style) ? style : "";
      out.push(raw);
      continue;
    }
    if (/^(?:-{4,}|\.{4,})$/.test(line)) {
      out.push(`\`\`\`${language ?? ""}`);
      block = line;
      language = undefined;
      continue;
    }
    if (line) language = undefined;
    if (/^[|!,:]={3,}$/.test(line)) {
      const header = source[i + 1];
      if (table) out.push("");
      else if (header?.trim().startsWith("|")) {
        // Markdown wants the header row first: trade places with the opening delimiter.
        out.push(header, separatorFor(header));
        i += 1;
      } else out.push(raw);
      table = !table;
      continue;
    }
    const heading = /^(={1,6})\s+(\S.*)$/.exec(raw.trimEnd());
    const numbered = /^(\s*)\.{1,5}\s+(\S.*)$/.exec(raw);
    if (table && !line) out.push("|");
    else if (heading) out.push(`${"#".repeat(heading[1].length)} ${heading[2].trim()}`);
    else if (numbered) out.push(`${numbered[1]}1. ${numbered[2]}`);
    else out.push(raw);
  }
  return out;
}

function rstLines(source: readonly string[]): string[] {
  const out = [...source];
  const inBlock = new Array<boolean>(source.length).fill(false);

  // Section titles: text over an adornment line at least as long as the title.
  const adornment = /^([=\-~^"#*+])\1{2,}$/;
  const styles: string[] = [];
  for (let i = 0; i + 1 < source.length; i++) {
    const title = source[i].trimEnd();
    const under = source[i + 1].trimEnd();
    if (!title || /^\s/.test(title) || /^\.\.(?:\s|$)/.test(title) || adornment.test(title)) continue;
    if (!adornment.test(under) || under.length < title.length) continue;
    const over = i > 0 && source[i - 1].trimEnd() === under;
    const style = `${under[0]}${over ? "+" : ""}`;
    if (!styles.includes(style)) styles.push(style);
    out[i] = `${"#".repeat(Math.min(6, styles.indexOf(style) + 1))} ${title.trim()}`;
    out[i + 1] = "";
    if (over) out[i - 1] = "";
    i += 1;
  }

  // Directive bodies and literal blocks become fences, closed on the blank line that follows.
  for (let i = 0; i < source.length; i++) {
    const line = source[i];
    const directive = /^\s*\.\.\s+(code-block|code|sourcecode|mermaid|uml|plantuml|graphviz)::\s*([A-Za-z0-9_+#.-]*)\s*$/.exec(line);
    const literal = !directive && /::\s*$/.test(line) && !/^\s*\.\.(?:\s|$)/.test(line) && i + 2 < source.length && isBlank(source[i + 1]);
    if (!directive && !literal) continue;
    const base = indentOf(line);
    const open = directive ? i : i + 1;
    let end = open + 1;
    let lastContent = -1;
    while (end < source.length && (isBlank(source[end]) || indentOf(source[end]) > base)) {
      if (!isBlank(source[end])) lastContent = end;
      end += 1;
    }
    if (lastContent < 0) continue;
    const close = lastContent + 1 < end ? lastContent + 1 : -1;
    if (close < 0 && end < source.length) continue; // No blank line to close on: leave the block as text.
    const name = directive?.[1];
    const language = !directive ? "" : name === "mermaid" ? "mermaid" : name === "graphviz" ? "dot"
      : name === "uml" || name === "plantuml" ? "plantuml" : fenceLanguage(directive[2]);
    out[open] = `${" ".repeat(base)}\`\`\`${language}`;
    if (directive) for (let k = open + 1; k < lastContent && /^\s+:[\w-]+:/.test(source[k]); k++) out[k] = "";
    if (close >= 0) out[close] = "```";
    else out.push("```");
    for (let k = open; k <= (close >= 0 ? close : source.length - 1); k++) inBlock[k] = true;
    i = close >= 0 ? close : source.length;
  }

  // Grid tables and auto-numbered lists outside those blocks.
  const border = (index: number): boolean => !inBlock[index] && /^\+(?:[-=]+\+)+$/.test(source[index]?.trim() ?? "");
  const row = (index: number): boolean => !inBlock[index] && (source[index]?.trim().startsWith("|") ?? false);
  for (let i = 0; i < source.length; i++) {
    if (inBlock[i]) continue;
    if (border(i) && row(i + 1)) {
      // Markdown wants the header row first, then one separator line.
      if (border(i + 2) && source[i + 2].includes("=")) {
        out[i] = "";
        out[i + 2] = separatorFor(source[i + 1]);
        i += 3;
      } else {
        out[i] = source[i + 1];
        out[i + 1] = separatorFor(source[i + 1]);
        i += 2;
      }
      for (; border(i) || row(i); i++) if (border(i)) out[i] = "|";
      i -= 1;
      continue;
    }
    const numbered = /^(\s*)#\.\s+(\S.*)$/.exec(source[i]);
    if (numbered) out[i] = `${numbered[1]}1. ${numbered[2]}`;
  }
  return out;
}

/** The same lines in Markdown terms; at most one closing fence is added after the last line. */
export function asMarkdownLines(lines: readonly string[], format: DocumentFormat | undefined): string[] {
  if (format === "rst") return rstLines(lines);
  if (format === "asciidoc") return asciidocLines(lines);
  return [...lines];
}

export function asMarkdown(text: string, file: string): string {
  const format = documentFormat(file);
  return format === "rst" || format === "asciidoc" ? asMarkdownLines(text.split("\n"), format).join("\n") : text;
}
