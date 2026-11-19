import { useCallback, useEffect, useRef, useState } from "react";
import type { DiagramEditStatus, SpaceDiagram } from "../space-types";
import StudioDialog from "../screens/StudioDialog";
import { DiagramDraftPreview } from "./DiagramDraftPreview";
import { DiagramEditNotice } from "./DiagramEditNotice";
import { diagramTitle } from "./diagram-explanation";
import { mermaidExportWarnings, toDrawio, toMermaid } from "./diagram-export";
import { diagramChanges, editorProblem, editorSnapshot, editorValue, recordEditor, redoEditor, undoEditor, type EditorHistory } from "./diagram-editor-state";
import "./diagram-editor.css";

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

/** Corrects, draws and exports one diagram. Saving sends it through the same schema gate as generated diagrams. */
export function DiagramEditor({ diagram, isNew, canRestore, positions, buildings, save, restore, close, baseStatus }: {
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
  baseStatus?: DiagramEditStatus;
}) {
  const [history, setHistory] = useState<EditorHistory>(() => ({ past: [], present: editorSnapshot(diagram), future: [] }));
  const { diagram: draft, fieldText } = history.present;
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string>();
  const [confirmation, setConfirmation] = useState<"close" | "restore">();
  const titleInput = useRef<HTMLInputElement>(null);
  const kind = draft.kind;
  const hints = HINTS[kind];
  const generated = !isNew && !diagram.id.startsWith("user-");
  const restoreGenerated = generated && baseStatus?.state !== "missing" && baseStatus?.hasGenerated !== false;
  const next = editorValue(history.present);
  const changes = diagramChanges(diagram, next);
  const dirty = isNew || JSON.stringify(editorSnapshot(diagram)) !== JSON.stringify(history.present);
  const exportWarnings = mermaidExportWarnings(next);
  const setDraft = (update: SpaceDiagram | ((current: SpaceDiagram) => SpaceDiagram)): void => setHistory((current) =>
    recordEditor(current, { ...current.present, diagram: typeof update === "function" ? update(current.present.diagram) : update }));
  const setFieldText = (update: Record<string, string>): void => setHistory((current) =>
    recordEditor(current, { ...current.present, fieldText: update }));
  const requestClose = useCallback((): void => {
    if (working) return;
    if (dirty) setConfirmation("close");
    else close();
  }, [working, dirty, close]);

  useEffect(() => { titleInput.current?.focus(); }, []);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (confirmation) return;
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        requestClose();
      } else if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === "KeyZ" && !working) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setHistory(event.shiftKey ? redoEditor : undoEditor);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [confirmation, requestClose, working]);

  const setNode = (id: string, change: Partial<Node>): void =>
    setDraft((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...change } : node) }));
  const setEdge = (index: number, change: Partial<Edge>): void =>
    setDraft((current) => ({ ...current, edges: current.edges.map((edge, at) => at === index ? { ...edge, ...change } : edge) }));
  const addNode = (): void => setDraft((current) => {
    let number = current.nodes.length + 1;
    while (current.nodes.some(({ id }) => id === `item-${number}`) || diagram.nodes.some(({ id }) => id === `item-${number}`)
      || Object.hasOwn(fieldText, `item-${number}`)) number++;
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

  const run = (action: () => Promise<void>): void => {
    setWorking(true);
    setMessage(undefined);
    action().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "The change could not be saved."))
      .finally(() => setWorking(false));
  };
  const submit = (): void => {
    const problem = editorProblem(next);
    if (problem) return setMessage(problem);
    run(() => save(next));
  };
  const download = (): void => {
    const url = URL.createObjectURL(new Blob([toDrawio(next, positions)], { type: "application/xml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${draft.title.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "diagram"}.drawio`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const copyMermaid = (): void => {
    navigator.clipboard.writeText(toMermaid(next)).then(() => setMessage("Mermaid text copied."),
      () => setMessage("The browser did not allow copying. Select the text in a document instead."));
  };

  return <><aside className="kd-learn-card kd-replay-inspector kd-explanation kd-diagram-editor" aria-label="Diagram editor">
    <div className="kd-learn-heading">
      <div className="kd-learn-eyebrow"><span /> {isNew ? "New diagram" : "Edit diagram"} · {diagramTitle(draft)}</div>
      <button type="button" className="kd-learn-icon" onClick={requestClose} disabled={working} aria-label="Close editor">×</button>
    </div>
    <p className="kd-lesson-muted">{generated
      ? "Unchanged items keep their evidence. Changed items are marked as your corrections."
      : "Your additions have no generated source citations."}</p>
    <DiagramEditNotice status={baseStatus} editable={canRestore} />
    <div className="kd-editor-toolbar">
      <button type="button" className="kd-learn-action" disabled={working || !history.past.length} onClick={() => setHistory(undoEditor)} title="Ctrl+Z">Undo</button>
      <button type="button" className="kd-learn-action" disabled={working || !history.future.length} onClick={() => setHistory(redoEditor)} title="Ctrl+Shift+Z">Redo</button>
      <span role="status">{isNew ? "Unsaved diagram" : dirty ? "Unsaved changes" : "No changes"}</span>
    </div>
    <fieldset className="kd-editor-controls" disabled={working}>
    <label className="kd-editor-field">Title
      <input ref={titleInput} value={draft.title} maxLength={100} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
    </label>
    {isNew && <div className="kd-editor-row">
      <label className="kd-editor-field">Kind
        <select value={kind} onChange={(event) => {
          const nextKind = event.target.value as Kind;
          setDraft({ ...draft, kind: nextKind, edges: nextKind === "erd" ? draft.edges.map((edge) => ({
            ...edge, cardinality: edge.cardinality ?? { from: "1", to: "0..*" }
          })) : draft.edges });
        }}>
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
            <input aria-label="Item name" value={node.label} maxLength={kind === "matrix" ? 140 : withFields(kind) ? 64 : 60}
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
            {(kind === "erd" || kind === "class" && edge.cardinality) ? <>
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
          {(kind === "state" || edge.guard) && <input aria-label="Link condition" placeholder="Condition" value={edge.guard ?? ""} maxLength={80}
            onChange={(event) => setEdge(index, { guard: event.target.value })} />}
        </li>)}
      </ul>
      <button type="button" className="kd-learn-action" onClick={addEdge} disabled={draft.nodes.length < 2 || draft.edges.length >= 80}>Add link</button>
    </section>}

    </fieldset>
    <DiagramDraftPreview diagram={next} />
    {changes.length > 0 && <details className="kd-editor-changes"><summary>Changes before saving · {changes.length}</summary>
      <ul>{changes.map((change) => <li key={change}>{change}</li>)}</ul>
    </details>}
    {message && <p role="status" className="kd-editor-message">{message}</p>}
    <div className="kd-lesson-actions">
      <button type="button" className="kd-learn-action kd-editor-save" onClick={submit} disabled={working}>{working ? "Saving…" : "Save diagram"}</button>
      <button type="button" className="kd-learn-action" onClick={requestClose} disabled={working}>Cancel</button>
    </div>
    <div className="kd-lesson-actions">
      <button type="button" className="kd-learn-action" onClick={copyMermaid}>Copy as Mermaid</button>
      <button type="button" className="kd-learn-action" onClick={download}>Download .drawio</button>
    </div>
    <p className="kd-editor-export-note">{exportWarnings.join(" ")} Mermaid simplifies punctuation and some notation details. Citations and Explain claims stay in Kodyurd. diagrams.net keeps a graph with field text; it does not preserve every notation.</p>
    {canRestore && restore && <div className="kd-lesson-actions">
      <button type="button" className="kd-learn-action" onClick={() => setConfirmation("restore")} disabled={working}>
        {restoreGenerated ? "Restore current generated diagram" : "Remove saved diagram"}
      </button>
    </div>}
  </aside>
    {confirmation && <StudioDialog title={confirmation === "close" ? "Discard unsaved changes?" : restoreGenerated ? "Restore current generated diagram?" : "Remove this saved diagram?"}
      onClose={() => setConfirmation(undefined)} busy={working}>
      <p>{confirmation === "close" ? "Your changes have not been saved." : restoreGenerated ? "Your saved corrections will be replaced by the current generated diagram." : "This saved diagram will be removed from the city."}</p>
      <div className="studio-actions">
        <button type="button" className="studio-button" data-initial-focus onClick={() => setConfirmation(undefined)}>Keep editing</button>
        <button type="button" className="studio-button" onClick={() => {
          const action = confirmation;
          setConfirmation(undefined);
          if (action === "close") close();
          else if (restore) run(restore);
        }}>{confirmation === "close" ? "Discard changes" : restoreGenerated ? "Restore diagram" : "Remove diagram"}</button>
      </div>
    </StudioDialog>}
  </>;
}
