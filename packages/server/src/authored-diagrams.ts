import { createHash } from "node:crypto";
import { SpaceDiagram, type TSpaceDocument, type TSpaceSourceRef } from "@kodyurd/scene-schema";
import { indexMarkdown, type DocSection } from "./analyzer.js";
import type { SourceReader } from "./source-evidence.js";

type Diagram = TSpaceDocument["diagrams"][number];
type Node = Diagram["nodes"][number];
type Edge = Diagram["edges"][number];
type Line = { text: string; source: TSpaceSourceRef };
type DiagramBody = { nodes: Map<string, Node>; edges: Edge[] };
type NodeSpec = Omit<Node, "source">;

const DOC_LIMIT = 48;
const DOC_CHARS = 256 * 1024;
const READ_CHARS = 512 * 1024;
const DIAGRAM_LIMIT = 12;
const NODE_LIMIT = 24;
const EDGE_LIMIT = 48;
const idPattern = "[A-Za-z_][A-Za-z0-9_-]{0,63}?";
const message = new RegExp(`^(${idPattern})\\s*(-->>|->>)\\s*(${idPattern})\\s*:\\s*(.+)$`);
const stateId = `(?:${idPattern}|\\[\\*\\])`;
const transition = new RegExp(`^(${stateId})\\s*-->\\s*(${stateId})(?:\\s*:\\s*(.+))?$`);
const entityName = `(?:${idPattern}|"[^"\\n]{1,64}")`;
const entityDeclaration = new RegExp(`^(${entityName})\\s*(\\{)?$`);
const entityRelation = new RegExp(`^(${entityName})\\s+(\\|\\||\\|o|}o|}\\|)(--|\\.\\.)(\\|\\||o\\||o\\{|\\|\\{)\\s+(${entityName})\\s*:\\s*(.+)$`);
const entityField = /^([A-Za-z][A-Za-z0-9_\[\](),?-]{0,59})\s+(\*)?([A-Za-z_][A-Za-z0-9_\[\]()-]{0,63})(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK)){0,2}))?(?:\s+("[^"]+"))?$/;
const endpointCardinality: Record<string, NonNullable<Edge["cardinality"]>["from"]> = {
  "||": "1", "|o": "0..1", "o|": "0..1", "}o": "0..*", "o{": "0..*", "}|": "1..*", "|{": "1..*"
};

function plain(value: string, max: number): string | undefined {
  const text = value.trim().replace(/^"([^"]+)"$/, "$1").trim();
  return text && text.length <= max && !/["<>\\\u0000-\u001f]|&(?:#[\da-fx]+|[a-z]+);/i.test(text) ? text : undefined;
}

function nodeSpec(token: string): NodeSpec | undefined {
  const item = /^([A-Za-z_][A-Za-z0-9_-]{0,63})(.*)$/.exec(token.trim());
  if (!item) return undefined;
  const [, id, shape] = item;
  if (!shape) return { id, label: id };
  const store = shape.startsWith("[(") && shape.endsWith(")]");
  const decision = shape.startsWith("{") && shape.endsWith("}");
  const box = shape.startsWith("[") && shape.endsWith("]");
  if (!store && !decision && !box) return undefined;
  const label = plain(store ? shape.slice(2, -2) : shape.slice(1, -1), 80);
  if (!label || /[\[\]{}|]/.test(label)) return undefined;
  return { id, label, hint: store ? "store" : decision ? "decision" : undefined, icon: store ? "database" : undefined };
}

function putNode(body: DiagramBody, node: NodeSpec, source: TSpaceSourceRef): boolean {
  const previous = body.nodes.get(node.id);
  if (previous && node.label !== node.id && previous.label !== node.id && previous.label !== node.label) return false;
  const addsLabel = previous?.label === node.id && node.label !== node.id;
  const addsHint = !previous?.hint && node.hint && previous?.label === node.label;
  if (!previous || addsLabel || addsHint) body.nodes.set(node.id, { ...node, group: node.group ?? previous?.group, source });
  return body.nodes.size <= NODE_LIMIT;
}

function putEdge(body: DiagramBody, edge: Edge): boolean {
  body.edges.push({ ...edge, id: `e-${body.edges.length + 1}` });
  return body.edges.length <= EDGE_LIMIT;
}

function flowchart(lines: Line[], body: DiagramBody): boolean {
  let group: string | undefined;
  const groups = new Set<string>();
  for (const { text, source } of lines) {
    if (text.startsWith("subgraph ")) {
      const scope = nodeSpec(text.slice("subgraph ".length));
      if (group || !scope || scope.hint || groups.has(scope.id) || scope.label.length > 40) return false;
      groups.add(scope.id);
      group = scope.label;
      continue;
    }
    if (text === "end") {
      if (!group) return false;
      group = undefined;
      continue;
    }
    const relation = /^(.*?)\s*(-->|-\.->)\s*(?:\|([^|]+)\|\s*)?(.+)$/.exec(text);
    if (relation) {
      const from = nodeSpec(relation[1]);
      const to = nodeSpec(relation[4]);
      const label = relation[3] === undefined ? undefined : plain(relation[3], 48);
      if (!from || !to || relation[3] !== undefined && !label) return false;
      if (!putNode(body, { ...from, group }, source) || !putNode(body, { ...to, group }, source)) return false;
      if (!putEdge(body, { from: from.id, to: to.id, label, kind: relation[2] === "-.->" ? "dashed" : "solid", source })) return false;
      continue;
    }
    const node = nodeSpec(text);
    // A bare unrecognized keyword is not a supported statement or declaration.
    if (!node || /^[A-Za-z_][A-Za-z0-9_-]*$/.test(text)) return false;
    if (!putNode(body, { ...node, group }, source)) return false;
  }
  return group === undefined && ![...groups].some((id) => body.nodes.has(id));
}

function sequence(lines: Line[], body: DiagramBody): boolean {
  const alternatives: { condition: string; hasMessage: boolean }[] = [];
  for (const { text, source } of lines) {
    const participant = /^(participant|actor)\s+([A-Za-z_][\w-]{0,63})(?:\s+as\s+(.+))?$/.exec(text);
    if (participant) {
      const id = participant[2];
      const label = plain(participant[3] ?? id, 80);
      const actor = participant[1] === "actor";
      if (!label || !putNode(body, { id, label, hint: actor ? "actor" : undefined, icon: actor ? "user" : undefined }, source)) return false;
      continue;
    }
    const branch = /^(alt|else)(?:\s+(.+))?$/.exec(text);
    if (branch) {
      const condition = plain(branch[2] ?? "", 80);
      if (!condition) return false;
      if (branch[1] === "else" && !alternatives.pop()?.hasMessage) return false;
      if (alternatives.length >= 4) return false;
      alternatives.push({ condition, hasMessage: false });
      continue;
    }
    if (text === "end") {
      if (!alternatives.pop()?.hasMessage) return false;
      continue;
    }
    const event = message.exec(text);
    if (!event) return false;
    const [, from, arrow, to, raw] = event;
    const label = plain(raw, 48);
    const guard = alternatives.map(({ condition }) => condition).join(" / ") || undefined;
    if (!label || guard && guard.length > 80) return false;
    if (!putNode(body, { id: from, label: from }, source) || !putNode(body, { id: to, label: to }, source)) return false;
    if (!putEdge(body, { from, to, label, guard, kind: arrow === "-->>" ? "dashed" : "solid", source })) return false;
    for (const branch of alternatives) branch.hasMessage = true;
  }
  return alternatives.length === 0;
}

function stateMachine(lines: Line[], body: DiagramBody): boolean {
  for (const { text, source } of lines) {
    const state = /^state\s+"([^"]+)"\s+as\s+([A-Za-z_][\w-]{0,63})$/.exec(text);
    if (state) {
      const label = plain(state[1], 80);
      if (!label || !putNode(body, { id: state[2], label, hint: "state" }, source)) return false;
      continue;
    }
    const event = transition.exec(text);
    if (!event || event[1] === "[*]" && event[2] === "[*]") return false;
    const guard = event[3] === undefined ? undefined : plain(event[3], 80);
    if (event[3] !== undefined && !guard) return false;
    const from: NodeSpec = event[1] === "[*]" ? { id: "$start", label: "Start", hint: "initial" }
      : { id: event[1], label: event[1], hint: "state" };
    const to: NodeSpec = event[2] === "[*]" ? { id: "$end", label: "End", hint: "terminal" }
      : { id: event[2], label: event[2], hint: "state" };
    if (!putNode(body, from, source) || !putNode(body, to, source)) return false;
    if (!putEdge(body, { from: from.id, to: to.id, guard, source })) return false;
  }
  return true;
}

function entityRelationship(lines: Line[], body: DiagramBody): boolean {
  const defined = new Set<string>();
  let fields: NonNullable<Node["fields"]> | undefined;
  for (const { text, source } of lines) {
    if (fields) {
      if (text === "}") { fields = undefined; continue; }
      const field = entityField.exec(text);
      if (!field || fields.length >= 40) return false;
      const [, type, primary, name, rawKeys, rawNote] = field;
      if (fields.some((column) => column.name === name)) return false;
      const keys = new Set(rawKeys?.split(/\s*,\s*/) as NonNullable<NonNullable<Node["fields"]>[number]["keys"]> | undefined);
      if (primary) keys.add("PK");
      const note = rawNote && plain(rawNote, 160);
      if (rawNote && !note) return false;
      fields.push({ name, type, keys: keys.size ? [...keys] : undefined, note, source });
      continue;
    }
    const relation = entityRelation.exec(text);
    if (relation) {
      const [, left, leftEnd, line, rightEnd, right, rawLabel] = relation;
      const from = plain(left, 64);
      const to = plain(right, 64);
      const label = plain(rawLabel, 48);
      if (!from || !to || !label) return false;
      if (!putNode(body, { id: from, label: from }, source) || !putNode(body, { id: to, label: to }, source)) return false;
      if (!putEdge(body, { from, to, label, kind: line === "--" ? "solid" : "dashed", source,
        cardinality: { from: endpointCardinality[leftEnd], to: endpointCardinality[rightEnd] } })) return false;
      continue;
    }
    const declaration = entityDeclaration.exec(text);
    const label = declaration && plain(declaration[1], 64);
    if (!label || defined.has(label) || text === "end") return false;
    defined.add(label);
    fields = declaration[2] ? [] : undefined;
    body.nodes.set(label, { id: label, label, fields, source });
    if (body.nodes.size > NODE_LIMIT) return false;
  }
  return !fields;
}

function parseBlock(path: string, owner: string, doc: string[], block: DocSection): Diagram | undefined {
  const { startLine, endLine } = block;
  if (endLine - startLine > 96) return undefined;
  const raw = doc.slice(startLine, endLine - 1);
  if (raw.some((line) => line.length > 256)) return undefined;
  const lines = raw.map((line, index) => {
    const number = startLine + index + 1;
    return { text: line.trim(), source: { path, startLine: number, endLine: number } };
  }).filter(({ text }) => text && !/^%%(?!\{)/.test(text));
  const type = lines.shift()?.text;
  const kind = /^(flowchart|graph) (TB|TD|BT|RL|LR)$/.test(type ?? "") ? "graph"
    : type === "sequenceDiagram" ? "sequence"
      : type === "stateDiagram" || type === "stateDiagram-v2" ? "state"
        : type === "erDiagram" ? "erd" : undefined;
  if (!kind) return undefined;
  const parse = kind === "graph" ? flowchart : kind === "sequence" ? sequence : kind === "state" ? stateMachine : entityRelationship;
  const body: DiagramBody = { nodes: new Map(), edges: [] };
  if (!parse(lines, body) || kind !== "erd" && !body.edges.length) return undefined;
  const id = `authored-live-${createHash("sha256").update(JSON.stringify([path, startLine, raw])).digest("hex").slice(0, 24)}`;
  const note = "Imported from the current workspace document."
    + (kind === "sequence" && body.edges.some(({ guard }) => guard) ? " Alternative messages retain their conditions and authored order." : "");
  const result = SpaceDiagram.safeParse({ id, owner, kind, origin: "mermaid", note,
    title: plain((block.title ?? "").slice(0, 100), 100) ?? (path.split("/").at(-1) ?? "Authored diagram").slice(0, 100),
    source: { path, startLine, endLine }, nodes: [...body.nodes.values()], edges: body.edges });
  return result.success ? result.data : undefined;
}

/** Add only bounded, fully supported diagrams from Markdown paths recorded in the saved city. */
export async function readAuthoredDiagrams(space: TSpaceDocument, read: SourceReader): Promise<Diagram[]> {
  const diagrams: Diagram[] = [];
  const limit = Math.min(DIAGRAM_LIMIT, 120 - space.diagrams.length);
  if (limit <= 0) return diagrams;
  const paths = [...new Set(space.meta.coverage.map(({ doc }) => doc.replaceAll("\\", "/")).filter((doc) => /\.md$/i.test(doc)))];
  const ids = new Set(space.diagrams.map(({ id }) => id));
  let chars = 0;
  for (const path of paths.slice(0, DOC_LIMIT)) {
    const lines = await read(path);
    if (!lines) continue;
    const text = lines.join("\n");
    chars += text.length;
    if (chars > READ_CHARS) break;
    if (text.length > DOC_CHARS) continue;
    const owner = space.city.buildings.filter(({ moduleRef }) => path.startsWith(`${moduleRef}/`))
      .sort((a, b) => b.moduleRef.length - a.moduleRef.length)[0]?.id ?? "city";
    for (const block of indexMarkdown(text).sections) {
      if (block.kind !== "mermaid") continue;
      const diagram = parseBlock(path, owner, lines, block);
      if (!diagram || ids.has(diagram.id)) continue;
      const hasSaved = space.diagrams.some(({ source, kind }) => kind === diagram.kind && source?.path.replaceAll("\\", "/") === path
        && source.startLine !== undefined && source.startLine >= block.startLine && (source.endLine ?? source.startLine) <= block.endLine);
      if (hasSaved) continue;
      ids.add(diagram.id);
      diagrams.push(diagram);
      if (diagrams.length >= limit) return diagrams;
    }
  }
  return diagrams;
}
