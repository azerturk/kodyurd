import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { SpaceDiagram, type SpaceLayout, type TSpaceDocument } from "@kodyurd/scene-schema";
import { AgentError } from "./agents.js";
import { atomicJson, projectDir } from "./project-files.js";
import { layoutDiagram } from "./space-layout/index.js";
import { normalizeDiagram } from "./space-pipeline.js";

/**
 * Diagrams the user corrected, imported or drew. They are kept beside the generated city and laid
 * over it on read, so the generated document stays as it was written and a new generation keeps the
 * user's work. Only unchanged meanings keep their saved citations; user additions and changed
 * relationships cannot inherit evidence from a retained id.
 */

type Diagram = TSpaceDocument["diagrams"][number];
type Payload = { space: TSpaceDocument; layout: SpaceLayout };

export interface DiagramEditStatus { id: string; state: "changed" | "missing" | "unknown"; hasGenerated?: boolean }
export interface DiagramEditStore {
  diagrams: Diagram[];
  /** null marks a drawing/import with no generated base; absence marks an older untracked correction. */
  bases: Record<string, string | null>;
}

export const USER_DIAGRAM_LIMIT = 40;

const editsPath = (dataDir: string, projectId: string): string => path.join(projectDir(dataDir, projectId), "diagram-edits.json");
const relationKey = (edge: Diagram["edges"][number]): string => edge.id ?? JSON.stringify([
  edge.from, edge.to, edge.label ?? "", edge.guard ?? "", edge.kind ?? "solid", edge.cardinality?.from, edge.cardinality?.to
]);
type Field = NonNullable<Diagram["nodes"][number]["fields"]>[number];

const fieldMeaning = (field: Field) => [field.name, field.type, [...(field.keys ?? [])].sort(), field.note ?? ""];
const nodeMeaning = (node: Diagram["nodes"][number]) => JSON.stringify([
  node.label, node.group ?? "", node.hint,
  [...(node.fields ?? [])].sort((a, b) => a.name.localeCompare(b.name, "en")).map(fieldMeaning)
]);
const edgeMeaning = (edge: Diagram["edges"][number]) => JSON.stringify([
  edge.from, edge.to, edge.label ?? "", edge.guard ?? "", edge.kind ?? "solid",
  edge.cardinality?.from, edge.cardinality?.to
]);

export async function readDiagramEditStore(dataDir: string, projectId: string): Promise<DiagramEditStore> {
  const raw = await fs.readFile(editsPath(dataDir, projectId), "utf8").then((text) => JSON.parse(text) as { diagrams?: unknown; bases?: unknown }).catch(() => undefined);
  if (!Array.isArray(raw?.diagrams)) return { diagrams: [], bases: {} };
  const diagrams = raw.diagrams.flatMap((item) => {
    const parsed = SpaceDiagram.safeParse(item);
    return parsed.success && parsed.data.origin === "user" ? [parsed.data] : [];
  }).slice(0, USER_DIAGRAM_LIMIT);
  const rawBases = raw.bases && typeof raw.bases === "object" && !Array.isArray(raw.bases) ? raw.bases as Record<string, unknown> : {};
  const bases = Object.fromEntries(diagrams.flatMap(({ id }) => {
    const value = Object.hasOwn(rawBases, id) ? rawBases[id] : undefined;
    return value === null || typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? [[id, value]] : [];
  })) as Record<string, string | null>;
  return { diagrams, bases };
}

export async function readDiagramEdits(dataDir: string, projectId: string): Promise<Diagram[]> {
  return (await readDiagramEditStore(dataDir, projectId)).diagrams;
}

/** Stable across JSON key order; transient source freshness is checked separately. */
export function diagramBaseFingerprint(diagram: Diagram): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([key, item]) => key !== "stale" && item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([key, item]) => [key, canonical(item)]));
    return value;
  };
  return createHash("sha256").update(JSON.stringify(canonical(diagram))).digest("hex");
}

/** Compare before applying overlays. Re-saving a correction never silently accepts a new base. */
export function diagramEditStatuses(space: Pick<TSpaceDocument, "diagrams">, store: DiagramEditStore): DiagramEditStatus[] {
  const generated = new Map(space.diagrams.map((diagram) => [diagram.id, diagram]));
  return store.diagrams.flatMap(({ id }): DiagramEditStatus[] => {
    if (store.bases[id] === null) return [];
    if (!Object.hasOwn(store.bases, id)) return [{ id, state: "unknown", hasGenerated: generated.has(id) }];
    const current = generated.get(id);
    if (!current) return [{ id, state: "missing" }];
    return store.bases[id] !== diagramBaseFingerprint(current) ? [{ id, state: "changed" }] : [];
  });
}

/** Accept schema-valid editor data without lossy agent normalization, then restore trusted evidence. */
export function userDiagram(input: unknown, space: TSpaceDocument, id: string, saved?: Diagram): Diagram {
  const candidate = { ...(typeof input === "object" && input !== null ? input : {}), id, claims: undefined, origin: "user" };
  const valid = SpaceDiagram.safeParse(candidate);
  const draft = valid.success ? valid.data : normalizeDiagram(candidate);
  if (!draft) throw new AgentError("DIAGRAM_INVALID", "A diagram needs a title and at least two named items.");
  const owner = String(draft.owner);
  const ownerKnown = owner === "city" || space.city.buildings.some((building) => building.id === owner.split(":")[0]);
  const resolvedOwner = ownerKnown ? owner : "city";
  const sameContext = Boolean(saved && saved.kind === draft.kind && saved.owner === resolvedOwner);
  const savedNodes = new Map(saved?.nodes.map((node) => [node.id, node]));
  const savedEdges = new Map<string, Diagram["edges"]>();
  for (const edge of saved?.edges ?? []) savedEdges.set(relationKey(edge), [...(savedEdges.get(relationKey(edge)) ?? []), edge]);
  const unchangedNodes = new Set<string>();
  const nodes = (draft.nodes as Diagram["nodes"]).map((node) => {
    const before = savedNodes.get(node.id);
    const unchanged = sameContext && before && nodeMeaning(node) === nodeMeaning(before);
    if (unchanged) unchangedNodes.add(node.id);
    const fields = node.fields?.map((field) => {
      const original = before?.fields?.find(({ name }) => name === field.name);
      const matching = sameContext && before?.label === node.label && original &&
        JSON.stringify(fieldMeaning(field)) === JSON.stringify(fieldMeaning(original));
      return { ...field, source: matching ? original.source : undefined };
    });
    return { ...node, fields, source: unchanged ? before.source : undefined };
  });
  const unchangedEdges = new Set<string>();
  let unchangedEdgeCount = 0;
  const edges = (draft.edges as Diagram["edges"]).map((edge) => {
    const before = savedEdges.get(relationKey(edge))?.shift();
    const unchanged = sameContext && before && edgeMeaning(edge) === edgeMeaning(before) &&
      unchangedNodes.has(edge.from) && unchangedNodes.has(edge.to);
    if (unchanged) {
      unchangedEdges.add(relationKey(edge));
      unchangedEdgeCount++;
    }
    return { ...edge, source: unchanged ? before.source : undefined };
  });
  const claims = saved?.claims?.filter(({ target }) => target.kind === "node"
    ? unchangedNodes.has(target.id) : unchangedEdges.has(target.id));
  const unchangedDiagram = saved && sameContext && saved.title === draft.title && (saved.note ?? "") === (draft.note ?? "") &&
    unchangedNodes.size === saved.nodes.length && nodes.length === saved.nodes.length &&
    unchangedEdgeCount === saved.edges.length && edges.length === saved.edges.length;
  const parsed = SpaceDiagram.safeParse({
    ...draft, owner: resolvedOwner, nodes, edges, claims: claims?.length ? claims : undefined,
    source: unchangedDiagram ? saved.source : undefined, origin: "user"
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AgentError("DIAGRAM_INVALID", `This diagram cannot be saved: ${issue?.message ?? "it does not match the scene schema"}.`);
  }
  return parsed.data;
}

export async function saveDiagramEdit(dataDir: string, projectId: string, diagram: Diagram, generatedBase?: Diagram | null): Promise<void> {
  const stored = await readDiagramEditStore(dataDir, projectId);
  const existing = stored.diagrams.some(({ id }) => id === diagram.id);
  const others = stored.diagrams.filter(({ id }) => id !== diagram.id);
  if (others.length >= USER_DIAGRAM_LIMIT) {
    throw new AgentError("DIAGRAM_LIMIT", `A workspace keeps up to ${USER_DIAGRAM_LIMIT} edited diagrams. Remove one before adding another.`);
  }
  const bases = { ...stored.bases };
  if (!existing && generatedBase !== undefined) bases[diagram.id] = generatedBase ? diagramBaseFingerprint(generatedBase) : null;
  await fs.mkdir(projectDir(dataDir, projectId), { recursive: true });
  await atomicJson(editsPath(dataDir, projectId), { diagrams: [diagram, ...others], bases });
}

export async function removeDiagramEdit(dataDir: string, projectId: string, id: string): Promise<boolean> {
  const { diagrams: edits, bases } = await readDiagramEditStore(dataDir, projectId);
  if (!edits.some((diagram) => diagram.id === id)) return false;
  await atomicJson(editsPath(dataDir, projectId), { diagrams: edits.filter((diagram) => diagram.id !== id),
    bases: Object.fromEntries(Object.entries(bases).filter(([key]) => key !== id)) });
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
    const at = diagrams.findIndex(({ id }) => id === edit.id);
    const owner = owners.has(edit.owner.split(":")[0]) ? edit.owner : "city";
    // Reconcile older corrections, too: retained ids alone never prove their changed meanings.
    const diagram = userDiagram({ ...edit, owner }, space, edit.id, at >= 0 ? diagrams[at] : undefined);
    if (at >= 0) diagrams[at] = diagram;
    else if (diagrams.length < 120) {
      diagrams.push(diagram);
      if (searchIndex.length < 2000) searchIndex.push({ label: diagram.title, kind: "diagram", ref: diagram.id, keywords: ["edited", diagram.kind] });
    } else continue;
    for (let index = 0; index < searchIndex.length; index++) {
      if (searchIndex[index].kind === "diagram" && searchIndex[index].ref === diagram.id) {
        searchIndex[index] = { ...searchIndex[index], label: diagram.title };
      }
    }
    layouts[diagram.id] = layoutDiagram(diagram);
  }
  return { space: { ...space, diagrams, navigation: { ...space.navigation, searchIndex } }, layout: { ...layout, diagrams: layouts } };
}
