import type { SpaceDiagram, SpaceDiagramClaim, SpaceDiagramField, SpaceSource } from "../space-types";

export const diagramKindTitle: Record<SpaceDiagram["kind"], string> = {
  graph: "Component map", sequence: "Sequence", state: "State machine", matrix: "Decision table", stack: "Layer map", timeline: "Timeline",
  erd: "Data model (ERD)"
};

type Item = { id: string; ref: string; label: string; source?: SpaceSource };
type DiagramConnection = Item & { kind: "edge"; from: string; to: string; relation?: string; guard?: string; authoredId?: string;
  cardinality?: SpaceDiagram["edges"][number]["cardinality"] };
export type DiagramItem = (Item & { kind: "node"; group?: string; fields?: SpaceDiagramField[] }) | DiagramConnection;

export function diagramItems(diagram: SpaceDiagram): DiagramItem[] {
  const prefix = `stage:diagram:${diagram.id}`;
  const nodeLabels = new Map(diagram.nodes.map((node) => [node.id, node.label]));
  return [
    ...diagram.nodes.map((node): DiagramItem => ({ ...node, kind: "node", ref: `${prefix}:node:${node.id}` })),
    ...diagram.edges.map((edge, index): DiagramItem => {
      const id = edge.id ?? String(index);
      return {
        kind: "edge", id, authoredId: edge.id, ref: `${prefix}:edge:${id}`, from: edge.from, to: edge.to,
        label: edge.label ?? `${nodeLabels.get(edge.from) ?? edge.from} → ${nodeLabels.get(edge.to) ?? edge.to}`,
        relation: edge.kind, guard: edge.guard, cardinality: edge.cardinality, source: edge.source
      };
    })
  ];
}

export function claimsForItem(diagram: SpaceDiagram, item: DiagramItem): SpaceDiagramClaim[] {
  const id = item.kind === "node" ? item.id : item.authoredId;
  return id === undefined ? [] : (diagram.claims ?? []).filter((claim) => claim.target.kind === item.kind && claim.target.id === id);
}

export function connectionsForNode(items: DiagramItem[], nodeId: string): DiagramConnection[] {
  return items.filter((item): item is DiagramConnection => item.kind === "edge" && (item.from === nodeId || item.to === nodeId));
}
