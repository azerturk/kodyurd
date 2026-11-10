import type { SpaceBuilding, SpaceDiagramNode, SpaceDoc, SpaceSource } from "../space-types";

export interface CityRelationship {
  id: string;
  from: string;
  to: string;
  title: string;
  summary: string;
  source: SpaceSource;
  kind: "call" | "data" | "dependency" | "message";
}

function nodeBuilding(node: SpaceDiagramNode, buildings: SpaceBuilding[], cityOwned: boolean): string | undefined {
  if (cityOwned) {
    const name = node.label.trim().toLowerCase();
    const matches = buildings.filter((building) => [building.id, building.title, building.moduleRef].some((key) => key.toLowerCase() === name));
    if (matches.length === 1) return matches[0].id;
  }
  const path = node.source?.path.replaceAll("\\", "/");
  if (!path || /\.(md|markdown|mdx|rst|adoc|txt)$/i.test(path)) return undefined;
  const matches = buildings.filter(({ moduleRef }) => path === moduleRef || path.startsWith(`${moduleRef}/`))
    .sort((a, b) => b.moduleRef.length - a.moduleRef.length);
  return matches[0] && matches[0].moduleRef.length !== matches[1]?.moduleRef.length ? matches[0].id : undefined;
}

/** Only explicit, sourced relationships between uniquely resolved modules reach the map. */
export function cityRelationships(space: Pick<SpaceDoc, "city" | "flows" | "diagrams">): CityRelationship[] {
  const byId = new Map(space.city.buildings.map((building) => [building.id, building]));
  const links = new Map<string, CityRelationship>();
  const add = (id: string, from: string, to: string, label: string | undefined, summary: string,
    source: SpaceSource | undefined, kind: CityRelationship["kind"]): void => {
    const pair = `${from}\u0000${to}`;
    const left = byId.get(from);
    const right = byId.get(to);
    if (!left || !right || !source?.startLine || from === to || links.has(pair) || links.size >= 36) return;
    links.set(pair, { id, from, to, title: label || `${left.title} → ${right.title}`, summary, source, kind });
  };
  for (const flow of space.flows) {
    if (flow.scope !== "system") continue;
    for (let i = 1; i < flow.path.length; i++) {
      const [from, to] = [flow.path[i - 1], flow.path[i]];
      const source = [to.source, from.source, flow.source].find((item) => item?.startLine);
      const kind = flow.kind === "data" ? "data" : flow.kind === "depends" ? "dependency" : "call";
      add(`overview-flow:${flow.id}:${i}`, from.ref, to.ref, to.caption, flow.title, source, kind);
    }
  }
  for (const diagram of space.diagrams) {
    if (links.size >= 36) break;
    const cityOwned = diagram.owner === "city";
    if (diagram.kind !== "graph" || !cityOwned && !byId.has(diagram.owner)) continue;
    const nodes = new Map(diagram.nodes.map((node) => [node.id, nodeBuilding(node, space.city.buildings, cityOwned)]));
    diagram.edges.forEach((edge, index) => {
      const from = nodes.get(edge.from);
      const to = nodes.get(edge.to);
      if (!from || !to) return;
      const kind = edge.kind === "async" || edge.kind === "return" || edge.kind === "dashed" ? "message" : "call";
      add(`overview-diagram:${diagram.id}:${index}`, from, to, edge.label, diagram.title, edge.source, kind);
    });
  }
  return [...links.values()];
}
