import type { SpaceDiagram } from "../space-types";

type Node = SpaceDiagram["nodes"][number];
type Field = NonNullable<Node["fields"]>[number];

export interface EditorSnapshot {
  diagram: SpaceDiagram;
  fieldText: Record<string, string>;
}

export interface EditorHistory {
  past: EditorSnapshot[];
  present: EditorSnapshot;
  future: EditorSnapshot[];
}

export const fieldsText = (node: Node): string => (node.fields ?? []).map(({ name, type, keys }) =>
  `${name}: ${type}${keys?.length ? ` ${keys.join(" ")}` : ""}`).join("\n");

export function editorSnapshot(diagram: SpaceDiagram): EditorSnapshot {
  return { diagram, fieldText: Object.fromEntries(diagram.nodes.map((node) => [node.id, fieldsText(node)])) };
}

function readFields(text: string, keyed: boolean, original: Node["fields"]): Node["fields"] {
  const fields = text.split("\n").flatMap((line): Field[] => {
    if (!line.trim()) return [];
    const at = line.lastIndexOf(":");
    const name = (at > 0 ? line.slice(0, at) : line).trim();
    const words = (at > 0 ? line.slice(at + 1) : "").trim().split(/\s+/).filter(Boolean);
    const keys = words.filter((item): item is "PK" | "FK" | "UK" => item === "PK" || item === "FK" || item === "UK");
    const type = words.filter((item) => !keys.includes(item as "PK")).join(" ") || (keyed ? "TEXT" : "value");
    const before = original?.find((field) => field.name === name && field.type === type &&
      JSON.stringify(field.keys ?? []) === JSON.stringify(keys));
    return [before ?? { name, type, keys: keys.length ? keys : undefined }];
  });
  return fields.length ? fields : undefined;
}

/** Keep the complete saved object unless the user actually edits a field's text. */
export function editorValue({ diagram, fieldText }: EditorSnapshot): SpaceDiagram {
  if (diagram.kind !== "erd" && diagram.kind !== "class") return diagram;
  return { ...diagram, nodes: diagram.nodes.map((node) => {
    const text = fieldText[node.id] ?? "";
    return text === fieldsText(node) ? node : { ...node, fields: readFields(text, diagram.kind === "erd", node.fields) };
  }) };
}

export function editorProblem(diagram: SpaceDiagram): string | undefined {
  if (!diagram.title.trim()) return "Give the diagram a title.";
  if (diagram.nodes.length < (diagram.kind === "erd" ? 1 : 2)) return "A diagram needs at least two named items.";
  if (diagram.nodes.some((node) => !node.label.trim())) return "Name every item, or remove the blank item.";
  for (const node of diagram.nodes) {
    const fields = node.fields ?? [];
    if (fields.length > 40) return `${node.label} has more than 40 fields.`;
    if (new Set(fields.map(({ name }) => name)).size !== fields.length) return `${node.label} has repeated field names.`;
    if (fields.some(({ name, type }) => !name || name.length > 64 || !type || type.length > 60)) return `Check the field names and types in ${node.label}.`;
  }
  const ids = new Set(diagram.nodes.map(({ id }) => id));
  if (diagram.edges.some(({ from, to }) => !ids.has(from) || !ids.has(to))) return "Choose an existing item at both ends of every link.";
  if (diagram.kind === "erd" && diagram.edges.some((edge) => !edge.cardinality)) return "Choose cardinality at both ends of each data relationship.";
  return undefined;
}

export function recordEditor(history: EditorHistory, present: EditorSnapshot): EditorHistory {
  if (JSON.stringify(history.present) === JSON.stringify(present)) return history;
  return { past: [...history.past, history.present].slice(-60), present, future: [] };
}

export function undoEditor(history: EditorHistory): EditorHistory {
  const present = history.past.at(-1);
  return present ? { past: history.past.slice(0, -1), present, future: [history.present, ...history.future] } : history;
}

export function redoEditor(history: EditorHistory): EditorHistory {
  const present = history.future[0];
  return present ? { past: [...history.past, history.present], present, future: history.future.slice(1) } : history;
}

export function diagramChanges(before: SpaceDiagram, after: SpaceDiagram): string[] {
  const changes: string[] = [];
  if (before.title !== after.title) changes.push("Title changed");
  if (before.note !== after.note) changes.push("Note changed");
  if (before.kind !== after.kind) changes.push("Diagram kind changed");
  if (before.owner !== after.owner) changes.push("Location changed");
  const items = (oldItems: { id?: string }[], newItems: { id?: string }[], label: string): void => {
    const key = (item: { id?: string }, index: number): string => item.id ?? `index:${index}`;
    const oldById = new Map(oldItems.map((item, index) => [key(item, index), item]));
    const nextById = new Map(newItems.map((item, index) => [key(item, index), item]));
    const added = [...nextById.keys()].filter((id) => !oldById.has(id)).length;
    const removed = [...oldById.keys()].filter((id) => !nextById.has(id)).length;
    const edited = [...nextById].filter(([id, item]) => oldById.has(id) && JSON.stringify(oldById.get(id)) !== JSON.stringify(item)).length;
    if (added) changes.push(`${added} ${label}${added === 1 ? "" : "s"} added`);
    if (removed) changes.push(`${removed} ${label}${removed === 1 ? "" : "s"} removed`);
    if (edited) changes.push(`${edited} ${label}${edited === 1 ? "" : "s"} changed`);
    if (!added && !removed && oldItems.map(key).join("\0") !== newItems.map(key).join("\0")) changes.push(`${label === "item" ? "Item" : "Link"} order changed`);
  };
  items(before.nodes, after.nodes, "item");
  items(before.edges, after.edges, "link");
  return changes;
}
