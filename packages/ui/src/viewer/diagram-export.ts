import type { SpaceDiagram } from "../space-types";

/**
 * A diagram as Mermaid text or as a diagrams.net file. Both keep the names, groups, fields and
 * relationships; source citations and Explain claims stay in Kodyurd.
 */

type Node = SpaceDiagram["nodes"][number];
type Edge = SpaceDiagram["edges"][number];

const quoted = (text: string): string => `"${text.replace(/["\r\n]+/g, " ").trim()}"`;
const plain = (text: string): string => text.replace(/[\r\n:;{}[\]()<>|"#]+/g, " ").replace(/\s+/g, " ").trim();
const word = (text: string): string => text.replace(/[^\p{L}\p{N}_]+/gu, "_").replace(/^_+|_+$/g, "") || "item";

function aliases(nodes: Node[], prefix = "n"): Map<string, string> {
  return new Map(nodes.map((node, index) => [node.id, `${prefix}${index + 1}`]));
}

function flowchart(diagram: SpaceDiagram, direction: "LR" | "TB"): string[] {
  const alias = aliases(diagram.nodes);
  const lines = [`flowchart ${direction}`];
  const groups = [...new Set(diagram.nodes.flatMap(({ group }) => group ? [group] : []))];
  const shape = (node: Node): string => `${alias.get(node.id)}[${quoted(node.label)}]`;
  for (const [index, group] of groups.entries()) {
    lines.push(`  subgraph g${index + 1}[${quoted(group)}]`);
    for (const node of diagram.nodes.filter((item) => item.group === group)) lines.push(`    ${shape(node)}`);
    lines.push("  end");
  }
  for (const node of diagram.nodes.filter(({ group }) => !group)) lines.push(`  ${shape(node)}`);
  for (const edge of diagram.edges) {
    const arrow = edge.kind === "dashed" || edge.kind === "async" || edge.kind === "return" ? "-.->" : "-->";
    const text = plain([edge.label, edge.guard && `[${edge.guard}]`].filter(Boolean).join(" "));
    lines.push(`  ${alias.get(edge.from)} ${arrow}${text ? `|${text}|` : ""} ${alias.get(edge.to)}`);
  }
  return lines;
}

function sequence(diagram: SpaceDiagram): string[] {
  const alias = aliases(diagram.nodes, "p");
  const lines = ["sequenceDiagram"];
  for (const node of diagram.nodes) lines.push(`  ${node.hint === "actor" ? "actor" : "participant"} ${alias.get(node.id)} as ${plain(node.label)}`);
  for (const edge of diagram.edges) {
    const arrow = edge.kind === "return" ? "-->>" : edge.kind === "async" ? "-)" : "->>";
    lines.push(`  ${alias.get(edge.from)}${arrow}${alias.get(edge.to)}: ${plain(edge.label ?? "") || "message"}`);
  }
  return lines;
}

function stateMachine(diagram: SpaceDiagram): string[] {
  const alias = aliases(diagram.nodes, "s");
  const lines = ["stateDiagram-v2"];
  for (const node of diagram.nodes) lines.push(`  state ${quoted(node.label)} as ${alias.get(node.id)}`);
  for (const node of diagram.nodes.filter(({ hint }) => hint === "initial")) lines.push(`  [*] --> ${alias.get(node.id)}`);
  for (const edge of diagram.edges) {
    const text = plain([edge.label, edge.guard && `[${edge.guard}]`].filter(Boolean).join(" "));
    lines.push(`  ${alias.get(edge.from)} --> ${alias.get(edge.to)}${text ? `: ${text}` : ""}`);
  }
  for (const node of diagram.nodes.filter(({ hint }) => hint === "terminal")) lines.push(`  ${alias.get(node.id)} --> [*]`);
  return lines;
}

const leftEnd = { "1": "||", "0..1": "|o", "1..*": "}|", "0..*": "}o" } as const;
const rightEnd = { "1": "||", "0..1": "o|", "1..*": "|{", "0..*": "o{" } as const;

function entities(diagram: SpaceDiagram): string[] {
  const name = new Map(diagram.nodes.map((node) => [node.id, word(node.label)]));
  const lines = ["erDiagram"];
  for (const node of diagram.nodes) {
    if (!node.fields?.length) {
      lines.push(`  ${name.get(node.id)}`);
      continue;
    }
    lines.push(`  ${name.get(node.id)} {`);
    for (const field of node.fields) lines.push(`    ${word(field.type)} ${word(field.name)}${field.keys?.length ? ` ${field.keys.join(", ")}` : ""}`);
    lines.push("  }");
  }
  for (const edge of diagram.edges) {
    if (!edge.cardinality) continue;
    const line = edge.kind === "dashed" ? ".." : "--";
    lines.push(`  ${name.get(edge.from)} ${leftEnd[edge.cardinality.from]}${line}${rightEnd[edge.cardinality.to]} ${name.get(edge.to)} : ${quoted(edge.label ?? "relates to")}`);
  }
  return lines;
}

function classes(diagram: SpaceDiagram): string[] {
  const name = new Map(diagram.nodes.map((node) => [node.id, word(node.label)]));
  const lines = ["classDiagram"];
  for (const node of diagram.nodes) {
    lines.push(`  class ${name.get(node.id)}${node.fields?.length ? " {" : ""}`);
    if (!node.fields?.length) continue;
    for (const field of node.fields) {
      const method = /\(.*\)$/.test(field.name);
      lines.push(`    +${method ? `${field.name}${field.type === "method" ? "" : ` ${plain(field.type)}`}` : `${plain(field.type)} ${word(field.name)}`}`);
    }
    lines.push("  }");
  }
  // Inheritance and realization point at the parent, the way Mermaid draws them.
  const arrows: Record<string, { arrow: string; reversed?: boolean }> = {
    extends: { arrow: "<|--", reversed: true }, implements: { arrow: "<|..", reversed: true },
    owns: { arrow: "*--" }, has: { arrow: "o--" }, uses: { arrow: "..>" }
  };
  for (const edge of diagram.edges) {
    const relation = arrows[edge.label ?? ""];
    const [left, right] = relation?.reversed ? [edge.to, edge.from] : [edge.from, edge.to];
    const text = relation ? "" : plain(edge.label ?? "");
    lines.push(`  ${name.get(left)} ${relation?.arrow ?? (edge.kind === "dashed" ? "..>" : "-->")} ${name.get(right)}${text ? ` : ${text}` : ""}`);
  }
  return lines;
}

function mindmap(diagram: SpaceDiagram): string[] {
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of diagram.edges) {
    if (hasParent.has(edge.to)) continue;
    hasParent.add(edge.to);
    children.set(edge.from, [...children.get(edge.from) ?? [], edge.to]);
  }
  const labels = new Map(diagram.nodes.map((node) => [node.id, plain(node.label) || "topic"]));
  const root = diagram.nodes.find(({ id }) => !hasParent.has(id)) ?? diagram.nodes[0];
  const lines = ["mindmap"];
  const seen = new Set<string>();
  const walk = (id: string, depth: number): void => {
    if (seen.has(id) || depth > 6) return;
    seen.add(id);
    lines.push(`${"  ".repeat(depth + 1)}${depth === 0 ? `root((${labels.get(id)}))` : labels.get(id)}`);
    for (const child of children.get(id) ?? []) walk(child, depth + 1);
  };
  walk(root.id, 0);
  return lines;
}

export function toMermaid(diagram: SpaceDiagram): string {
  const lines = diagram.kind === "sequence" ? sequence(diagram)
    : diagram.kind === "state" ? stateMachine(diagram)
      : diagram.kind === "erd" ? entities(diagram)
        : diagram.kind === "class" ? classes(diagram)
          : diagram.kind === "mindmap" ? mindmap(diagram)
            : diagram.kind === "timeline" ? ["timeline", `  title ${plain(diagram.title)}`, ...diagram.nodes.map((node) => `  ${plain(node.label)}`)]
              : flowchart(diagram, diagram.kind === "stack" ? "TB" : "LR");
  return `${lines.join("\n")}\n`;
}

const xml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\r\n]+/g, " ");
// diagrams.net reads a label as HTML, so its text is escaped once for HTML and once for the attribute.
const html = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A diagrams.net file with each item where the city laid it out, grouped by its container. */
export function toDrawio(diagram: SpaceDiagram, positions: { id: string; x: number; y: number; w: number; h: number }[] = []): string {
  const place = new Map(positions.map((item) => [item.id, item]));
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  diagram.nodes.forEach((node, index) => {
    const at = place.get(node.id) ?? { x: 40 + (index % 4) * 220, y: 40 + Math.floor(index / 4) * 130, w: 170, h: 70 };
    const text = [node.label, ...(node.fields ?? []).map((field) => `${field.name}: ${field.type}${field.keys?.length ? ` ${field.keys.join(" ")}` : ""}`)];
    const height = Math.max(Math.round(at.h), 30 + (node.fields?.length ?? 0) * 18);
    const style = node.hint === "decision" ? "rhombus;whiteSpace=wrap;html=1;" : node.hint === "store" ? "shape=cylinder3;whiteSpace=wrap;html=1;"
      : `rounded=1;whiteSpace=wrap;html=1;${node.fields?.length ? "align=left;spacingLeft=8;verticalAlign=top;" : ""}`;
    cells.push(`<mxCell id="n${index + 1}" value="${xml(text.map(html).join("<br>"))}" style="${style}" vertex="1" parent="1">`
      + `<mxGeometry x="${Math.round(at.x)}" y="${Math.round(at.y)}" width="${Math.round(at.w)}" height="${height}" as="geometry"/></mxCell>`);
  });
  const alias = aliases(diagram.nodes);
  diagram.edges.forEach((edge, index) => {
    const label = [edge.cardinality && `${edge.cardinality.from} → ${edge.cardinality.to}`, edge.label, edge.guard && `[${edge.guard}]`].filter(Boolean).join(" ");
    const dashed = edge.kind === "dashed" || edge.kind === "async" || edge.kind === "return" ? "dashed=1;" : "";
    cells.push(`<mxCell id="e${index + 1}" value="${xml(html(label))}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;${dashed}" edge="1" parent="1" `
      + `source="${alias.get(edge.from)}" target="${alias.get(edge.to)}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
  });
  return `<mxfile host="Kodyurd"><diagram name="${xml(diagram.title)}"><mxGraphModel><root>${cells.join("")}</root></mxGraphModel></diagram></mxfile>\n`;
}
