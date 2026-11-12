import type { ReactNode } from "react";
import type { DocExcerpt } from "../api";
import type { SpaceDiagram } from "../space-types";
import { diagramForDocumentFence, documentLink, type DocumentTarget } from "./document-navigation";

const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const bullet = /^\s*(?:[-*+]\s+|(\d+)[.)]\s+)(.*)/;
const fence = /^\s{0,3}(`{3,}|~{3,})\s*([\w-]*)\s*$/;
const tableSeparator = /^\s*\|?\s*:?-{3,}.*\|.*-{3,}/;
const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());

export function DocumentReader({ excerpt, diagrams, linkedEvidence, openRange, openPath, openDiagram }: {
  excerpt: DocExcerpt;
  diagrams: SpaceDiagram[];
  linkedEvidence?: (targets: DocumentTarget[]) => ReactNode;
  openRange: (from: number, to?: number) => void;
  openPath: (target: DocumentTarget) => void;
  openDiagram: (id: string) => void;
}) {
  const sourceLinks: DocumentTarget[] = [];
  const inline = (line: string): ReactNode[] => line.split(/(`[^`]+`|\*\*[^*]+\*\*|!?\[[^\]]+\]\([^)]+\))/g).map((text, index) => {
    if (text.startsWith("`") && text.endsWith("`")) return <code key={index}>{text.slice(1, -1)}</code>;
    if (text.startsWith("**") && text.endsWith("**")) return <strong key={index}>{text.slice(2, -2)}</strong>;
    const link = /^(!?)\[([^\]]+)\]\(([^)]+)\)$/.exec(text);
    if (!link) return text;
    const target = link[1] ? null : documentLink(excerpt.path, link[3]);
    if (target && target.path !== excerpt.path) sourceLinks.push(target);
    return target ? <button className="kd-doc-link" type="button" key={index} onClick={() => openPath(target)}>{link[2]}</button> : link[2];
  });
  const lines = (excerpt.display ?? excerpt.text).split(/\r?\n/);
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const number = excerpt.from + index;
    index += 1;
    if (!line.trim()) continue;
    const title = heading.exec(line);
    if (title) {
      const Heading = title[1].length <= 2 ? "h3" : "h4";
      blocks.push(<Heading key={number}>{inline(title[2])}</Heading>);
      continue;
    }
    const fenced = fence.exec(line);
    if (fenced) {
      const content: string[] = [];
      const closing = new RegExp(`^\\s{0,3}${fenced[1][0]}{${fenced[1].length},}\\s*$`);
      while (index < lines.length && !closing.test(lines[index])) content.push(lines[index++]);
      if (index < lines.length) index += 1;
      const diagramBlock = fenced[2].toLowerCase() === "mermaid";
      const related = diagramBlock && diagramForDocumentFence(diagrams, excerpt.path, number, excerpt.from + index - 1, content);
      blocks.push(<div className="kd-doc-fence" key={number}>
        {related && <button className="kd-learn-action" type="button" onClick={() => openDiagram(related.id)}>Open {related.title} ↗</button>}
        <details open={!related}><summary>{diagramBlock ? "Diagram definition" : "Code example"} · line {number}</summary>
          <pre tabIndex={0}><code>{content.join("\n")}</code></pre></details>
      </div>);
      continue;
    }
    if (line.includes("|") && tableSeparator.test(lines[index] ?? "")) {
      index += 1;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().includes("|")) {
        const row = cells(lines[index++]);
        if (row.some(Boolean)) rows.push(row);
      }
      blocks.push(<div className="kd-doc-table" key={number} tabIndex={0} role="region" aria-label={`Table at line ${number}`}>
        <table><thead><tr>{cells(line).map((cell, i) => <th key={i} scope="col">{inline(cell)}</th>)}</tr></thead>
          <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{inline(cell)}</td>)}</tr>)}</tbody></table>
      </div>);
      continue;
    }
    const item = bullet.exec(line);
    if (item) {
      const List = item[1] ? "ol" : "ul";
      const items = [item[2]];
      for (let next = bullet.exec(lines[index] ?? ""); next && Boolean(next[1]) === Boolean(item[1]); next = bullet.exec(lines[index] ?? "")) {
        items.push(next[2]);
        index += 1;
      }
      blocks.push(<List key={number} start={item[1] ? Number(item[1]) : undefined}>{items.map((value, i) => <li key={i}>{inline(value)}</li>)}</List>);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [line.replace(/^\s*>\s?/, "")];
      while (/^\s*>/.test(lines[index] ?? "")) quote.push(lines[index++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={number}>{inline(quote.join(" "))}</blockquote>);
      continue;
    }
    blocks.push(<p key={number}>{inline(line)}</p>);
  }
  const activeSection = excerpt.sections?.find(({ startLine, endLine }) => startLine <= excerpt.from && endLine >= excerpt.from);
  const pageSize = excerpt.to - excerpt.from + 1;
  return <div className="kd-doc-reader">
    {!!excerpt.sections?.length && <label className="kd-scenario-picker">Document sections
      <select value={activeSection?.startLine ?? ""} onChange={(event) => {
        const section = excerpt.sections?.find(({ startLine }) => startLine === Number(event.target.value));
        if (section) openRange(section.startLine, section.endLine);
      }}>
        <option value="" disabled>Jump to a section</option>
        {excerpt.sections.map((section) => <option key={section.startLine} value={section.startLine}>{section.title ?? "Overview"} · {section.startLine}</option>)}
      </select>
    </label>}
    {linkedEvidence?.(sourceLinks)}
    <article className="kd-doc-content">{blocks}</article>
    {(excerpt.from > 1 || excerpt.to < excerpt.totalLines) && <nav className="kd-doc-pages" aria-label="Document pages">
      {excerpt.from > 1 && <button className="kd-learn-action" type="button" onClick={() => openRange(Math.max(1, excerpt.from - pageSize), excerpt.from - 1)}>← Previous lines</button>}
      {excerpt.to < excerpt.totalLines && <button className="kd-learn-action" type="button" onClick={() => openRange(excerpt.to + 1)}>Next lines →</button>}
    </nav>}
  </div>;
}
