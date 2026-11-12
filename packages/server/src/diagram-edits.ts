import { promises as fs } from "node:fs";
import path from "node:path";
import { SpaceDiagram, type SpaceLayout, type TSpaceDocument } from "@kodyurd/scene-schema";
import { AgentError } from "./agents.js";
import { atomicJson, projectDir } from "./project-files.js";
import { layoutDiagram } from "./space-layout/index.js";
import { normalizeDiagram } from "./space-pipeline.js";

/**
 * Diagrams the user corrected, imported or drew. They are kept beside the generated city and laid
 * over it on read, so the generated document stays as it was written and a new generation keeps the
 * user's work. A corrected diagram keeps the citation of every item the saved diagram already had;
 * whatever the user adds carries no source.
 */

type Diagram = TSpaceDocument["diagrams"][number];
type Payload = { space: TSpaceDocument; layout: SpaceLayout };

export const USER_DIAGRAM_LIMIT = 40;

const editsPath = (dataDir: string, projectId: string): string => path.join(projectDir(dataDir, projectId), "diagram-edits.json");
const relationKey = ({ id, from, to }: Diagram["edges"][number]): string => id ?? JSON.stringify([from, to]);

export async function readDiagramEdits(dataDir: string, projectId: string): Promise<Diagram[]> {
  const raw = await fs.readFile(editsPath(dataDir, projectId), "utf8").then((text) => JSON.parse(text) as { diagrams?: unknown }).catch(() => undefined);
  if (!Array.isArray(raw?.diagrams)) return [];
  return raw.diagrams.flatMap((item) => {
    const parsed = SpaceDiagram.safeParse(item);
    return parsed.success && parsed.data.origin === "user" ? [parsed.data] : [];
  }).slice(0, USER_DIAGRAM_LIMIT);
}

/** Checks what the editor sent against the scene schema and restores the citations the saved diagram had. */
export function userDiagram(input: unknown, space: TSpaceDocument, id: string, saved?: Diagram): Diagram {
  const draft = normalizeDiagram({ ...(typeof input === "object" && input !== null ? input : {}), id, claims: undefined });
  if (!draft) throw new AgentError("DIAGRAM_INVALID", "A diagram needs a title and at least two named items.");
  const owner = String(draft.owner);
  const ownerKnown = owner === "city" || space.city.buildings.some((building) => building.id === owner.split(":")[0]);
  const savedNodes = new Map(saved?.nodes.map((node) => [node.id, node]));
  const savedEdges = new Map(saved?.edges.map((edge) => [relationKey(edge), edge]));
  const nodes = (draft.nodes as Diagram["nodes"]).map((node) => {
    const before = savedNodes.get(node.id);
    const fields = node.fields?.map((field) => ({ ...field, source: before?.fields?.find(({ name }) => name === field.name)?.source }));
    return { ...node, fields, source: before?.source };
  });
  const edges = (draft.edges as Diagram["edges"]).map((edge) => ({ ...edge, source: savedEdges.get(relationKey(edge))?.source }));
  const nodeIds = new Set(nodes.map(({ id: nodeId }) => nodeId));
  const edgeIds = new Set(edges.flatMap(({ id: edgeId }) => edgeId ? [edgeId] : []));
  const claims = saved?.claims?.filter(({ target }) => target.kind === "node" ? nodeIds.has(target.id) : edgeIds.has(target.id));
  const parsed = SpaceDiagram.safeParse({
    ...draft, owner: ownerKnown ? owner : "city", nodes, edges, claims: claims?.length ? claims : undefined,
    source: saved?.source, origin: "user"
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AgentError("DIAGRAM_INVALID", `This diagram cannot be saved: ${issue?.message ?? "it does not match the scene schema"}.`);
  }
  return parsed.data;
}

export async function saveDiagramEdit(dataDir: string, projectId: string, diagram: Diagram): Promise<void> {
  const others = (await readDiagramEdits(dataDir, projectId)).filter(({ id }) => id !== diagram.id);
  if (others.length >= USER_DIAGRAM_LIMIT) {
    throw new AgentError("DIAGRAM_LIMIT", `A workspace keeps up to ${USER_DIAGRAM_LIMIT} edited diagrams. Remove one before adding another.`);
  }
  await fs.mkdir(projectDir(dataDir, projectId), { recursive: true });
  await atomicJson(editsPath(dataDir, projectId), { diagrams: [diagram, ...others] });
}

export async function removeDiagramEdit(dataDir: string, projectId: string, id: string): Promise<boolean> {
  const edits = await readDiagramEdits(dataDir, projectId);
  if (!edits.some((diagram) => diagram.id === id)) return false;
  await atomicJson(editsPath(dataDir, projectId), { diagrams: edits.filter((diagram) => diagram.id !== id) });
  return true;
}

/** Lays the user's diagrams over an assembled city: a matching id replaces that diagram, others are added. */
export function applyDiagramEdits({ space, layout }: Payload, edits: Diagram[]): Payload {
  if (!edits.length) return { space, layout };
  const owners = new Set(["city", ...space.city.buildings.map(({ id }) => id)]);
  const diagrams = [...space.diagrams];
  const layouts = { ...layout.diagrams };
  const searchIndex = [...space.navigation.searchIndex];
  for (const edit of edits) {
    const diagram = owners.has(edit.owner.split(":")[0]) ? edit : { ...edit, owner: "city" };
    const at = diagrams.findIndex(({ id }) => id === diagram.id);
    if (at >= 0) diagrams[at] = diagram;
    else if (diagrams.length < 120) {
      diagrams.push(diagram);
      if (searchIndex.length < 2000) searchIndex.push({ label: diagram.title, kind: "diagram", ref: diagram.id, keywords: ["edited", diagram.kind] });
    } else continue;
    layouts[diagram.id] = layoutDiagram(diagram);
  }
  return { space: { ...space, diagrams, navigation: { ...space.navigation, searchIndex } }, layout: { ...layout, diagrams: layouts } };
}
