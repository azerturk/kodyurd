import type { TSpaceDocument, TSpaceSourceRef } from "@kodyurd/scene-schema";

/** Shared pieces of the authored-diagram importers: one bounded, fully supported block or nothing. */
export type Diagram = TSpaceDocument["diagrams"][number];
export type Node = Diagram["nodes"][number];
export type Edge = Diagram["edges"][number];
/** One meaningful line of a diagram block: trimmed text, its indent, and its exact place in the file. */
export type Line = { text: string; indent: number; source: TSpaceSourceRef };
export type DiagramBody = { nodes: Map<string, Node>; edges: Edge[] };
export type NodeSpec = Omit<Node, "source">;
/** A notation parser fills the body and returns false for anything it does not fully support. */
export type Parser = (lines: Line[], body: DiagramBody) => boolean;

export const NODE_LIMIT = 24;
export const EDGE_LIMIT = 48;

export function plain(value: string, max: number): string | undefined {
  const text = value.trim().replace(/^"([^"]+)"$/, "$1").trim();
  return text && text.length <= max && !/["<>\\\u0000-\u001f]|&(?:#[\da-fx]+|[a-z]+);/i.test(text) ? text : undefined;
}

export function putNode(body: DiagramBody, node: NodeSpec, source: TSpaceSourceRef): boolean {
  const previous = body.nodes.get(node.id);
  if (previous && node.label !== node.id && previous.label !== node.id && previous.label !== node.label) return false;
  const addsLabel = previous?.label === node.id && node.label !== node.id;
  const addsHint = !previous?.hint && node.hint && previous?.label === node.label;
  if (!previous || addsLabel || addsHint) body.nodes.set(node.id, { ...node, group: node.group ?? previous?.group, source });
  return body.nodes.size <= NODE_LIMIT;
}

export function putEdge(body: DiagramBody, edge: Edge): boolean {
  body.edges.push({ ...edge, id: `e-${body.edges.length + 1}` });
  return body.edges.length <= EDGE_LIMIT;
}
