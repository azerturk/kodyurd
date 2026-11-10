import { useEffect, useMemo, useRef, useState } from "react";
import type { SpaceAssessmentQuestion, SpaceCardinality, SpaceDiagram, SpaceDiagramClaim, SpaceSource } from "../space-types";
import { claimsForItem, connectionsForNode, diagramItems, diagramKindTitle, type DiagramItem } from "./diagram-explanation";
import type { ReadingEvidence } from "./document-navigation";

type ReplayTarget = NonNullable<SpaceAssessmentQuestion["replay"]>;
type ReplayEvidence = Extract<ReadingEvidence, { kind: "replay" }>;
type OpenSource = (source: SpaceSource, title?: string) => void;
const claimTitle: Record<SpaceDiagramClaim["kind"], string> = {
  responsibility: "Responsibility", input: "Input", output: "Output", guard: "Condition",
  invariant: "Invariant", decision: "Design decision", disagreement: "Evidence disagreement"
};
const sourceTitle: Record<SpaceDiagramClaim["evidence"][number]["kind"], string> = {
  code: "Code evidence", docs: "Documentation", test: "Test example"
};
const relationTitle = (relation?: string): string => relation === "async" ? "Async message"
  : relation === "return" ? "Return" : relation === "dashed" ? "Dashed link" : "Directed link";
const cardinalityTitle: Record<SpaceCardinality, string> = {
  "1": "Exactly one", "0..1": "Zero or one", "1..*": "One or more", "0..*": "Zero or more"
};
const lineLabel = ({ path, startLine, endLine }: SpaceSource): string => !startLine ? path
  : `${path}:${startLine}${endLine && endLine !== startLine ? `–${endLine}` : ""}`;

export function DiagramViewSwitch({ mode, onChange }: { mode: "inspect" | "explain"; onChange: (mode: "inspect" | "explain") => void }) {
  return <div role="group" aria-label="Diagram view" className="kd-diagram-view-switch">
    <button type="button" aria-pressed={mode === "inspect"} onClick={() => onChange("inspect")}>Inspect</button>
    <button type="button" aria-pressed={mode === "explain"} onClick={() => onChange("explain")}>Explain</button>
  </div>;
}

function Claim({ claim, openSource, openReplay }: { claim: SpaceDiagramClaim; openSource: OpenSource; openReplay: (target: ReplayTarget) => boolean }) {
  const [replayMissing, setReplayMissing] = useState(false);
  const stale = claim.evidence.some((item) => item.stale);
  return <article className="kd-explain-claim">
    <h4>{claimTitle[claim.kind]} {stale && <span className="kd-explain-stale">Source changed</span>}</h4>
    <p>{claim.text}</p>
    <ul className="kd-explain-citations" aria-label="Claim evidence">
      {claim.evidence.map((source) => <li key={`${source.kind}:${source.path}:${source.startLine}:${source.endLine}`}>
        <button type="button" onClick={() => openSource(source)}>
          <span>{sourceTitle[source.kind]}{source.stale ? " · Changed since generation" : ""}</span>
          <code>{lineLabel(source)}</code>
        </button>
      </li>)}
    </ul>
    {claim.replay && <button type="button" className="kd-learn-action" onClick={() => setReplayMissing(!openReplay(claim.replay!))}>
      {stale ? "Replay saved example" : "Open exact event in Replay"} →
    </button>}
    {replayMissing && <p role="status">The linked event could not be opened in this revision.</p>}
  </article>;
}

export function DiagramExplanation({
  diagram, owner, selectedRef, select, close, fit, openSource, openReplay, showInspect, relatedReplays, ask, topDown, toggleProjection
}: {
  diagram: SpaceDiagram;
  owner: string;
  selectedRef?: string;
  select: (ref: string) => void;
  close: () => void;
  fit: () => void;
  openSource: OpenSource;
  openReplay: (target: ReplayTarget) => boolean;
  showInspect: () => void;
  relatedReplays: ReplayEvidence[];
  ask?: () => void;
  topDown?: boolean;
  toggleProjection?: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const selectionHeading = useRef<HTMLHeadingElement>(null);
  const focusSelection = useRef(false);
  const [listKind, setListKind] = useState<"all" | "node" | "edge">("all");
  const [indexOpen, setIndexOpen] = useState(!selectedRef);
  const [replayMissing, setReplayMissing] = useState<string>();
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [diagram.id]);
  useEffect(() => {
    if (!focusSelection.current) return;
    focusSelection.current = false;
    selectionHeading.current?.focus();
  }, [selectedRef]);
  const items = useMemo(() => diagramItems(diagram), [diagram]);
  const nodes = useMemo(() => new Map(items.filter((item) => item.kind === "node").map((node) => [node.id, node])), [items]);
  const selection = items.find((item) => item.ref === selectedRef);
  const isDataModel = diagram.kind === "erd";
  const fields = selection?.kind === "node" ? selection.fields : undefined;
  const claims = selection ? claimsForItem(diagram, selection) : [];
  const source = selection?.source ?? (!selection ? diagram.source : undefined);
  const connections = selection?.kind === "node" ? connectionsForNode(items, selection.id) : [];
  const linkedClaims = new Set(claims.flatMap(({ replay }) => replay ? [JSON.stringify(replay)] : []));
  const replayLinks = relatedReplays.filter(({ target }) => !linkedClaims.has(JSON.stringify(target)));
  const selectRelated = (ref: string): void => {
    focusSelection.current = ref !== selectedRef;
    select(ref);
  };
  const buttonFor = (item: DiagramItem) => <button type="button" aria-pressed={item.ref === selectedRef}
    onClick={() => selectRelated(item.ref)}>
    <span>{item.label}</span>
    <small>{item.kind === "node" ? item.group ?? (isDataModel ? "Entity" : "Node") : item.cardinality
      ? `${item.cardinality.from} to ${item.cardinality.to}` : relationTitle(item.relation)}</small>
  </button>;
  const nodeButton = (id: string) => {
    const node = nodes.get(id);
    return node ? <button className="kd-doc-link" type="button" onClick={() => selectRelated(node.ref)}>{node.label}</button> : id;
  };
  return <aside className="kd-learn-card kd-replay-inspector kd-explanation" aria-label="Diagram explanation">
    <div className="kd-learn-heading">
      <div className="kd-learn-eyebrow"><span /> {diagramKindTitle[diagram.kind]} · {owner}</div>
      <button type="button" className="kd-learn-icon" onClick={close} aria-label="Close diagram">×</button>
    </div>
    <h2 ref={heading} tabIndex={-1}>{diagram.title}</h2>
    <DiagramViewSwitch mode="explain" onChange={(mode) => { if (mode === "inspect") showInspect(); }} />
    {diagram.note && <p className="kd-explain-note">{diagram.note}</p>}
    <section className="kd-explain-selection" aria-label="Current selection">
      <div className="kd-learn-eyebrow">{selection?.kind === "edge" ? "Relationship" : selection ? isDataModel ? "Entity" : "Selected node" : "Diagram overview"}</div>
      <h3 ref={selectionHeading} tabIndex={-1} aria-live="polite">{selection?.label ?? (isDataModel ? "Choose an entity or relationship" : "Choose a node or link")}</h3>
      {!selection && <p>{isDataModel ? "Select an entity to inspect its fields and keys, or a relationship to read both cardinalities." :
        "Select an item in the graph or the diagram index to see its relationships and evidence."}</p>}
      {selection?.kind === "node" && selection.group && <p>Group · {selection.group}</p>}
      {selection?.kind === "edge" && <dl className="kd-explain-direction">
        <div><dt>From</dt><dd>{nodeButton(selection.from)}{selection.cardinality && <> · {cardinalityTitle[selection.cardinality.from]} ({selection.cardinality.from})</>}</dd></div>
        <div><dt>To</dt><dd>{nodeButton(selection.to)}{selection.cardinality && <> · {cardinalityTitle[selection.cardinality.to]} ({selection.cardinality.to})</>}</dd></div>
        <div><dt>Type</dt><dd>{selection.cardinality ? selection.relation === "solid" ? "Identifying" :
          selection.relation === "dashed" ? "Non-identifying" : "Entity relationship" : relationTitle(selection.relation)}</dd></div>
        {selection.guard && <div><dt>Condition</dt><dd>{selection.guard}</dd></div>}
      </dl>}
      {source && <button type="button" className="kd-learn-action kd-explain-source" onClick={() => openSource(source)}>
        {/\.md$/i.test(source.path) ? "Read document section" : "Read linked source"} <code>{lineLabel(source)}</code>
      </button>}
      {selection && !claims.length && !isDataModel && <p className="kd-lesson-muted">No authored explanation was saved for this item.</p>}
    </section>
    {fields && fields.length > 0 && <section className="kd-explain-section" aria-label="Entity fields">
      <h3>Entity fields</h3>
      <div className="kd-doc-table" role="region" aria-label="Fields and keys" tabIndex={0}>
        <table><thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Keys</th></tr></thead>
          <tbody>{fields.map((field) => <tr key={field.name}>
            <th scope="row">{field.source ? <button type="button" className="kd-doc-link" onClick={() => openSource(field.source!, field.name)}
              aria-label={`${field.name} source ${lineLabel(field.source)}`}><code>{field.name}</code></button> : <code>{field.name}</code>}
              {field.note && <div className="kd-lesson-muted">{field.note}</div>}</th>
            <td><code>{field.type}</code></td><td>{field.keys?.join(", ") ?? "—"}</td>
          </tr>)}</tbody></table>
      </div>
      {fields.some((field) => field.keys?.length) && <p className="kd-lesson-muted">PK · Primary key · FK · Foreign key · UK · Unique key</p>}
    </section>}
    {claims.length > 0 && <section className="kd-explain-section" aria-label="Evidence trail">
      <h3>Evidence trail</h3>
      {claims.map((claim) => <Claim key={claim.id} claim={claim} openSource={openSource} openReplay={openReplay} />)}
    </section>}
    {connections.length > 0 && <details className="kd-diagram-directory kd-explain-index">
      <summary>Connected relationships · {connections.length}</summary>
      <ul>{connections.map((item) => <li key={item.ref}>{buttonFor(item)}</li>)}</ul>
    </details>}
    {replayLinks.length > 0 && <details className="kd-diagram-directory kd-explain-index">
      <summary>Replay events sharing this source · {replayLinks.length}</summary>
      <ul>{replayLinks.map(({ target, label, context }) => {
        const key = `${target.flow}:${target.scenario}:${target.stepIndex}`;
        return <li key={key}>
          <button type="button" onClick={() => setReplayMissing(openReplay(target) ? undefined : key)}>
            <span>▷ {label}</span>{context && <small>{context}</small>}
          </button>
          {replayMissing === key && <p role="status">The linked event could not be opened in this revision.</p>}
        </li>;
      })}</ul>
    </details>}
    <details className="kd-diagram-directory kd-explain-index" open={indexOpen} onToggle={(event) => setIndexOpen(event.currentTarget.open)}>
      <summary>Diagram index · {items.length}</summary>
      <label className="kd-scenario-picker">Items to show
        <select value={listKind} onChange={(event) => setListKind(event.target.value as typeof listKind)}>
          <option value="all">All items</option><option value="node">{isDataModel ? "Entities" : "Nodes"}</option><option value="edge">Relationships</option>
        </select>
      </label>
      <ul>{items.filter((item) => listKind === "all" || item.kind === listKind).map((item) =>
        <li key={item.ref}>{buttonFor(item)}</li>)}</ul>
    </details>
    <div className="kd-lesson-actions">
      <button type="button" className="kd-learn-action" onClick={fit}>Fit diagram</button>
      {toggleProjection && <button type="button" className="kd-learn-action" aria-pressed={Boolean(topDown)} onClick={toggleProjection}>Top view</button>}
      {ask && <button type="button" className="kd-learn-action" onClick={ask}>Ask the guide</button>}
    </div>
  </aside>;
}
