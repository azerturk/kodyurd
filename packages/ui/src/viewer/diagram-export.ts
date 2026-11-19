import type { SpaceDiagram } from "../space-types";

/**
 * A diagram as Mermaid text or as a diagrams.net graph. Each notation has limits, surfaced by
 * the editor; source citations and Explain claims stay in Kodyurd.
 */

type Node = SpaceDiagram["nodes"][number];
type Edge = SpaceDiagram["edges"][number];

const quoted = (text: string): string => `"${text.replace(/["\r\n]+/g, " ").trim()}"`;
const plain = (text: string): string => text.replace(/[\r\n:;{}[\]()<>|"#]+/g, " ").replace(/\s+/g, " ").trim();
const word = (text: string): string => text.replace(/[^\p{L}\p{N}_]+/gu, "_").replace(/^_+|_+$/g, "") || "item";

/** Mermaid entity/class identifiers must remain distinct even when their labels normalize alike. */
function names(nodes: { id: string; label: string }[]): Map<string, string> {
  const used = new Set<string>();
  return new Map(nodes.map(({ id, label }) => {
    const safe = label.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "item";
    const base = (/^[A-Za-z_]/.test(safe) ? safe : `item_${safe}`).slice(0, 54);
    let name = base;
    let suffix = 1;
    while (used.has(name)) name = `${base}_${++suffix}`;
    used.add(name);
    return [id, name];
  }));
}

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
  const name = names(diagram.nodes);
  const lines = ["erDiagram"];
  for (const node of diagram.nodes) {
    if (!node.fields?.length) {
      lines.push(`  ${name.get(node.id)}`);
      continue;
    }
    lines.push(`  ${name.get(node.id)} {`);
    const fieldNames = names(node.fields.map((field, index) => ({ id: String(index), label: field.name })));
    for (const [index, field] of node.fields.entries()) lines.push(`    ${word(field.type)} ${fieldNames.get(String(index))}${field.keys?.length ? ` ${field.keys.join(", ")}` : ""}${field.note ? ` ${quoted(field.note)}` : ""}`);
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
  const name = names(diagram.nodes);
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
    const leftEnd = edge.cardinality && ` "${relation?.reversed ? edge.cardinality.to : edge.cardinality.from}"`;
    const rightEnd = edge.cardinality && `"${relation?.reversed ? edge.cardinality.from : edge.cardinality.to}" `;
    lines.push(`  ${name.get(left)}${leftEnd || ""} ${relation?.arrow ?? (edge.kind === "dashed" ? "..>" : "-->")} ${rightEnd || ""}${name.get(right)}${text ? ` : ${text}` : ""}`);
  }
  return lines;
}

function mindmapTree(diagram: SpaceDiagram): boolean {
  if (diagram.edges.length !== diagram.nodes.length - 1) return false;
  const parents = new Set<string>();
  for (const { to } of diagram.edges) {
    if (parents.has(to)) return false;
    parents.add(to);
  }
  const roots = diagram.nodes.filter(({ id }) => !parents.has(id));
  if (roots.length !== 1) return false;
  const visited = new Set<string>();
  const pending = [roots[0].id];
  while (pending.length && visited.size <= diagram.nodes.length) {
    const id = pending.pop()!;
    if (visited.has(id)) return false;
    visited.add(id);
    pending.push(...diagram.edges.filter(({ from }) => from === id).map(({ to }) => to));
  }
  return visited.size === diagram.nodes.length;
}

function mindmap(diagram: SpaceDiagram): string[] {
  if (!mindmapTree(diagram)) return flowchart(diagram, "LR");
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of diagram.edges) {
    hasParent.add(edge.to);
    children.set(edge.from, [...children.get(edge.from) ?? [], edge.to]);
  }
  const labels = new Map(diagram.nodes.map((node) => [node.id, plain(node.label) || "topic"]));
  const root = diagram.nodes.find(({ id }) => !hasParent.has(id)) ?? diagram.nodes[0];
  const lines = ["mindmap"];
  const seen = new Set<string>();
  const walk = (id: string, depth: number): void => {
    if (seen.has(id)) return;
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
            : diagram.kind === "timeline" && !diagram.edges.length ? ["timeline", `  title ${plain(diagram.title)}`, ...diagram.nodes.map((node) => `  ${plain(node.label)}`)]
              : flowchart(diagram, diagram.kind === "stack" ? "TB" : "LR");
  return `${lines.join("\n")}\n`;
}

/** Format limits are visible before copying; no disconnected items or extra links are silently omitted. */
export function mermaidExportWarnings(diagram: SpaceDiagram): string[] {
  const warnings: string[] = [];
  if ((diagram.kind === "class" || diagram.kind === "erd") && diagram.nodes.some((node) => names(diagram.nodes).get(node.id) !== node.label))
    warnings.push("Mermaid uses distinct identifiers for names with spaces, punctuation or duplicates.");
  if (diagram.kind === "mindmap" && !mindmapTree(diagram)) warnings.push("Mermaid uses a flowchart to keep every item and link in this mind map.");
  if (diagram.kind === "timeline" && diagram.edges.length) warnings.push("Mermaid uses a flowchart to keep the timeline's links.");
  if (diagram.kind === "stack" || diagram.kind === "matrix") warnings.push(`Mermaid uses a flowchart for this ${diagram.kind === "stack" ? "layer map" : "decision table"}.`);
  if (diagram.kind === "erd" || diagram.kind === "class") {
    const identifiers = names(diagram.nodes);
    if (diagram.nodes.some((node) => identifiers.get(node.id) !== node.label)) warnings.push("Mermaid converts some names to unique identifiers.");
  }
  if (diagram.kind === "mindmap" && mindmapTree(diagram) && diagram.edges.some(({ label, guard, kind }) => label || guard || kind && kind !== "solid"))
    warnings.push("Mermaid mind maps keep the hierarchy; link labels and line styles stay in Kodyurd.");
  return warnings;
}

const xml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\r\n]+/g, " ");
// diagrams.net reads a label as HTML, so its text is escaped once for HTML and once for the attribute.
const html = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A diagrams.net file with each item where the city laid it out, grouped by its container. */
export function toDrawio(diagram: SpaceDiagram, positions: { id: string; x: number; y: number; w: number; h: number }[] = []): string {
  const place = new Map(positions.map((item) => [item.id, item]));
  const nodePlaces = new Map(diagram.nodes.map((node, index) => [node.id,
    place.get(node.id) ?? { x: 40 + (index % 4) * 220, y: 40 + Math.floor(index / 4) * 130, w: 170, h: 70 }]));
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const groups = new Map<string, { id: string; x: number; y: number }>();
  for (const group of new Set(diagram.nodes.flatMap((node) => node.group ? [node.group] : []))) {
    const members = diagram.nodes.filter((node) => node.group === group).map((node) => nodePlaces.get(node.id)!);
    const x = Math.min(...members.map((item) => item.x)) - 20;
    const y = Math.min(...members.map((item) => item.y)) - 36;
    const w = Math.max(...members.map((item) => item.x + item.w)) - x + 20;
    const h = Math.max(...members.map((item) => item.y + item.h)) - y + 20;
    const id = `g${groups.size + 1}`;
    groups.set(group, { id, x, y });
    cells.push(`<mxCell id="${id}" value="${xml(html(group))}" style="swimlane;html=1;startSize=26;" vertex="1" parent="1">`
      + `<mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(w)}" height="${Math.round(h)}" as="geometry"/></mxCell>`);
  }
  diagram.nodes.forEach((node, index) => {
    const at = nodePlaces.get(node.id)!;
    const group = node.group ? groups.get(node.group) : undefined;
    const text = [node.label, ...(node.fields ?? []).map((field) => `${field.name}: ${field.type}${field.keys?.length ? ` ${field.keys.join(" ")}` : ""}`)];
    const height = Math.max(Math.round(at.h), 30 + (node.fields?.length ?? 0) * 18);
    const style = node.hint === "decision" ? "rhombus;whiteSpace=wrap;html=1;" : node.hint === "store" ? "shape=cylinder3;whiteSpace=wrap;html=1;"
      : `rounded=1;whiteSpace=wrap;html=1;${node.fields?.length ? "align=left;spacingLeft=8;verticalAlign=top;" : ""}`;
    cells.push(`<mxCell id="n${index + 1}" value="${xml(text.map(html).join("<br>"))}" style="${style}" vertex="1" parent="${group?.id ?? "1"}">`
      + `<mxGeometry x="${Math.round(at.x - (group?.x ?? 0))}" y="${Math.round(at.y - (group?.y ?? 0))}" width="${Math.round(at.w)}" height="${height}" as="geometry"/></mxCell>`);
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
