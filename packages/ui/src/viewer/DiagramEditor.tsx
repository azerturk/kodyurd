import { useState } from "react";
import type { SpaceDiagram } from "../space-types";
import { diagramTitle } from "./diagram-explanation";
import { toDrawio, toMermaid } from "./diagram-export";

type Node = SpaceDiagram["nodes"][number];
type Edge = SpaceDiagram["edges"][number];
type Kind = SpaceDiagram["kind"];
type Cardinality = NonNullable<Edge["cardinality"]>["from"];

export const EDITABLE_KINDS: { kind: Kind; label: string }[] = [
  { kind: "graph", label: "Component map" }, { kind: "sequence", label: "Sequence diagram" }, { kind: "state", label: "State machine" },
  { kind: "erd", label: "Data model" }, { kind: "class", label: "Class diagram" }, { kind: "mindmap", label: "Mind map" },
  { kind: "timeline", label: "Timeline" }, { kind: "stack", label: "Layer map" }
];

const HINTS: Partial<Record<Kind, NonNullable<Node["hint"]>[]>> = {
  graph: ["service", "store", "external", "ui", "actor", "queue", "decision"],
  sequence: ["actor", "service", "store", "external"],
  state: ["initial", "state", "terminal"]
};
const LINES: NonNullable<Edge["kind"]>[] = ["solid", "dashed", "async", "return"];
const CARDINALITIES: Cardinality[] = ["1", "0..1", "1..*", "0..*"];
const withFields = (kind: Kind): boolean => kind === "erd" || kind === "class";

/** A first diagram to draw on: two named items and, where the kind needs one, a relationship. */
export function starterDiagram(kind: Kind, owner: string, title: string): SpaceDiagram {
  const names = kind === "state" ? ["Start", "Done"] : kind === "sequence" ? ["Caller", "Service"]
    : kind === "erd" ? ["Parent", "Child"] : kind === "class" ? ["Base", "Derived"]
      : kind === "mindmap" ? ["Subject", "Topic"] : kind === "timeline" ? ["First", "Next"] : kind === "stack" ? ["Base layer", "Top layer"]
        : ["Component A", "Component B"];
  const nodes: Node[] = names.map((label, index) => ({
    id: `item-${index + 1}`, label,
    hint: kind === "state" ? (index === 0 ? "initial" : "terminal") : undefined,
    fields: withFields(kind) ? [{ name: "id", type: kind === "erd" ? "TEXT" : "string", keys: kind === "erd" ? ["PK"] : undefined }] : undefined
  }));
  const linked = kind !== "timeline" && kind !== "stack";
  const edges: Edge[] = linked ? [{
    id: "link-1", from: kind === "class" ? "item-2" : "item-1", to: kind === "class" ? "item-1" : "item-2",
    label: kind === "class" ? "extends" : kind === "erd" ? "has" : undefined,
    cardinality: kind === "erd" ? { from: "1", to: "0..*" } : undefined
  }] : [];
  return { id: "new", owner, title, kind, nodes, edges, origin: "user" };
}

const fieldsText = (node: Node): string => (node.fields ?? []).map(({ name, type, keys }) =>
  `${name}: ${type}${keys?.length ? ` ${keys.join(" ")}` : ""}`).join("\n");

function readFields(text: string, keyed: boolean): Node["fields"] {
  const fields = text.split("\n").flatMap((line) => {
    const at = line.lastIndexOf(":");
    const name = (at > 0 ? line.slice(0, at) : line).trim().slice(0, 64);
    const words = (at > 0 ? line.slice(at + 1) : "").trim().split(/\s+/).filter(Boolean);
    const keys = keyed ? words.filter((item): item is "PK" | "FK" | "UK" => item === "PK" || item === "FK" || item === "UK") : [];
    const type = words.filter((item) => !keys.includes(item as "PK")).join(" ").slice(0, 60) || (keyed ? "TEXT" : "value");
    return name ? [{ name, type, keys: keys.length ? keys : undefined }] : [];
  });
  return fields.length ? fields.filter(({ name }, index) => fields.findIndex((item) => item.name === name) === index).slice(0, 40) : undefined;
}

/** Corrects, draws and exports one diagram. Saving sends it through the same schema gate as generated diagrams. */
export function DiagramEditor({ diagram, isNew, canRestore, positions, buildings, save, restore, close }: {
  diagram: SpaceDiagram;
  /** Not saved yet: a new drawing or an import. */
  isNew: boolean;
  /** A saved edit exists, so the diagram can go back to what was generated, or be removed if the user drew it. */
  canRestore: boolean;
  positions?: { id: string; x: number; y: number; w: number; h: number }[];
  buildings: { id: string; title: string }[];
  save: (diagram: SpaceDiagram) => Promise<void>;
  restore?: () => Promise<void>;
  close: () => void;
}) {
  const [draft, setDraft] = useState<SpaceDiagram>(diagram);
  const [fieldText, setFieldText] = useState<Record<string, string>>(() => Object.fromEntries(diagram.nodes.map((node) => [node.id, fieldsText(node)])));
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string>();
  const kind = draft.kind;
  const hints = HINTS[kind];
  const generated = !isNew && !diagram.id.startsWith("user-");

  const setNode = (id: string, change: Partial<Node>): void =>
    setDraft((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...change } : node) }));
  const setEdge = (index: number, change: Partial<Edge>): void =>
    setDraft((current) => ({ ...current, edges: current.edges.map((edge, at) => at === index ? { ...edge, ...change } : edge) }));
  const addNode = (): void => setDraft((current) => {
    let number = current.nodes.length + 1;
    while (current.nodes.some(({ id }) => id === `item-${number}`)) number++;
    return { ...current, nodes: [...current.nodes, { id: `item-${number}`, label: `Item ${number}` }] };
  });
  const removeNode = (id: string): void => setDraft((current) => ({
    ...current, nodes: current.nodes.filter((node) => node.id !== id), edges: current.edges.filter((edge) => edge.from !== id && edge.to !== id)
  }));
  const addEdge = (): void => setDraft((current) => {
    if (current.nodes.length < 2) return current;
    let number = current.edges.length + 1;
    while (current.edges.some(({ id }) => id === `link-${number}`)) number++;
    return { ...current, edges: [...current.edges, {
      id: `link-${number}`, from: current.nodes[0].id, to: current.nodes[1].id,
      cardinality: kind === "erd" ? { from: "1", to: "0..*" } : undefined
    }] };
  });

  /** The draft as it will be sent: blank labels dropped, field text read back into fields. */
  const result = (): SpaceDiagram => {
    const nodes = draft.nodes.filter(({ label }) => label.trim()).map((node) => ({
      ...node, label: node.label.trim(), group: node.group?.trim() || undefined,
      fields: withFields(kind) ? readFields(fieldText[node.id] ?? "", kind === "erd") : undefined
    }));
    const ids = new Set(nodes.map(({ id }) => id));
    const edges = draft.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to).map((edge) => ({
      ...edge, label: edge.label?.trim() || undefined, guard: edge.guard?.trim() || undefined,
      cardinality: kind === "erd" ? edge.cardinality ?? { from: "1" as const, to: "0..*" as const } : undefined
    }));
    return { ...draft, title: draft.title.trim(), note: draft.note?.trim() || undefined, nodes, edges };
  };
  const run = (action: () => Promise<void>): void => {
    setWorking(true);
    setMessage(undefined);
    action().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "The change could not be saved."))
      .finally(() => setWorking(false));
  };
  const submit = (): void => {
    const next = result();
    if (!next.title) return setMessage("Give the diagram a title.");
    if (next.nodes.length < (kind === "erd" ? 1 : 2)) return setMessage("A diagram needs at least two named items.");
    run(() => save(next));
  };
  const download = (): void => {
    const url = URL.createObjectURL(new Blob([toDrawio(result(), positions)], { type: "application/xml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${draft.title.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "diagram"}.drawio`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const copyMermaid = (): void => {
    navigator.clipboard.writeText(toMermaid(result())).then(() => setMessage("Mermaid text copied."),
      () => setMessage("The browser did not allow copying. Select the text in a document instead."));
  };

  return <aside className="kd-learn-card kd-replay-inspector kd-explanation kd-diagram-editor" aria-label="Diagram editor">
    <div className="kd-learn-heading">
      <div className="kd-learn-eyebrow"><span /> {isNew ? "New diagram" : "Edit diagram"} · {diagramTitle(draft)}</div>
      <button type="button" className="kd-learn-icon" onClick={close} aria-label="Close editor">×</button>
    </div>
    <p className="kd-lesson-muted">{generated
      ? "Items you keep hold their source citations. Items and links you add have none."
      : "This diagram is yours: it shows no source citations."}</p>
    <label className="kd-editor-field">Title
      <input value={draft.title} maxLength={100} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
    </label>
    {isNew && <div className="kd-editor-row">
      <label className="kd-editor-field">Kind
        <select value={kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as Kind })}>
          {EDITABLE_KINDS.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}
        </select>
      </label>
      <label className="kd-editor-field">Shown in
        <select value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })}>
          <option value="city">City</option>
          {buildings.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
        </select>
      </label>
    </div>}
    <label className="kd-editor-field">Note
      <textarea rows={2} value={draft.note ?? ""} maxLength={240} onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
    </label>

    <section className="kd-explain-section" aria-label="Items">
      <h3>Items · {draft.nodes.length}</h3>
      <ul className="kd-editor-list">
        {draft.nodes.map((node) => <li key={node.id}>
          <div className="kd-editor-row">
            <input aria-label="Item name" value={node.label} maxLength={withFields(kind) ? 64 : 60}
              onChange={(event) => setNode(node.id, { label: event.target.value })} />
            <button type="button" className="kd-learn-icon" aria-label={`Remove ${node.label}`} onClick={() => removeNode(node.id)}>×</button>
          </div>
          {(kind === "graph" || hints) && <div className="kd-editor-row">
            {kind === "graph" && <input aria-label="Group" placeholder="Group" value={node.group ?? ""} maxLength={40}
              onChange={(event) => setNode(node.id, { group: event.target.value })} />}
            {hints && <select aria-label="Role" value={node.hint ?? ""} onChange={(event) => setNode(node.id, { hint: (event.target.value || undefined) as Node["hint"] })}>
              <option value="">No role</option>
              {hints.map((hint) => <option key={hint} value={hint}>{hint}</option>)}
            </select>}
          </div>}
          {withFields(kind) && <textarea aria-label={kind === "erd" ? "Fields, one per line" : "Members, one per line"} rows={3}
            placeholder={kind === "erd" ? "id: TEXT PK" : "total(): number"} value={fieldText[node.id] ?? ""}
            onChange={(event) => setFieldText({ ...fieldText, [node.id]: event.target.value })} />}
        </li>)}
      </ul>
      <button type="button" className="kd-learn-action" onClick={addNode} disabled={draft.nodes.length >= 40}>Add item</button>
    </section>

    {kind !== "timeline" && kind !== "stack" && <section className="kd-explain-section" aria-label="Links">
      <h3>Links · {draft.edges.length}</h3>
      <ul className="kd-editor-list">
        {draft.edges.map((edge, index) => <li key={edge.id ?? index}>
          <div className="kd-editor-row">
            <select aria-label="From" value={edge.from} onChange={(event) => setEdge(index, { from: event.target.value })}>
              {draft.nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
            </select>
            <span aria-hidden="true">→</span>
            <select aria-label="To" value={edge.to} onChange={(event) => setEdge(index, { to: event.target.value })}>
              {draft.nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
            </select>
            <button type="button" className="kd-learn-icon" aria-label="Remove link"
              onClick={() => setDraft({ ...draft, edges: draft.edges.filter((_, at) => at !== index) })}>×</button>
          </div>
          <div className="kd-editor-row">
            <input aria-label="Link label" placeholder="Label" value={edge.label ?? ""} maxLength={48}
              onChange={(event) => setEdge(index, { label: event.target.value })} />
            {kind === "erd" ? <>
              <select aria-label="Cardinality at the start" value={edge.cardinality?.from ?? "1"}
                onChange={(event) => setEdge(index, { cardinality: { from: event.target.value as Cardinality, to: edge.cardinality?.to ?? "0..*" } })}>
                {CARDINALITIES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select aria-label="Cardinality at the end" value={edge.cardinality?.to ?? "0..*"}
                onChange={(event) => setEdge(index, { cardinality: { from: edge.cardinality?.from ?? "1", to: event.target.value as Cardinality } })}>
                {CARDINALITIES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </> : <select aria-label="Line" value={edge.kind ?? "solid"} onChange={(event) => setEdge(index, { kind: event.target.value as Edge["kind"] })}>
              {LINES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>}
          </div>
        </li>)}
      </ul>
      <button type="button" className="kd-learn-action" onClick={addEdge} disabled={draft.nodes.length < 2 || draft.edges.length >= 80}>Add link</button>
    </section>}

    {message && <p role="status" className="kd-editor-message">{message}</p>}
    <div className="kd-lesson-actions">
      <button type="button" className="kd-learn-action kd-editor-save" onClick={submit} disabled={working}>{working ? "Saving…" : "Save diagram"}</button>
      <button type="button" className="kd-learn-action" onClick={close} disabled={working}>Cancel</button>
    </div>
    <div className="kd-lesson-actions">
      <button type="button" className="kd-learn-action" onClick={copyMermaid}>Copy as Mermaid</button>
      <button type="button" className="kd-learn-action" onClick={download}>Download .drawio</button>
    </div>
    {canRestore && restore && <div className="kd-lesson-actions">
      <button type="button" className="kd-learn-action" onClick={() => run(restore)} disabled={working}>
        {generated ? "Restore the generated diagram" : "Delete this diagram"}
      </button>
    </div>}
  </aside>;
}
