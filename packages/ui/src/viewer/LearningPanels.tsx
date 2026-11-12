import type { DocExcerpt } from "../api";
import { useEffect, useId, useRef } from "react";
import type { SpaceDiagram, SpaceSource } from "../space-types";
import type { DiagramPlayback, FlowPlayback, SpaceFocus, SpaceHandle } from "./space-engine";
import { DocumentReader } from "./DocumentReader";
import { DiagramViewSwitch } from "./DiagramExplanation";
import { diagramTitle } from "./diagram-explanation";
import { ReplayComparison } from "./ReplayComparison";
import { evidenceInRange, readingEvidenceKey, type DocumentTarget, type ReadingEvidence } from "./document-navigation";
import type { ReplayTrace } from "./flow-replay";
import "./learning-panels.css";

type OpenSource = (source: SpaceSource, title?: string) => void;

export function FocusEntrance({
  title,
  flowTitle,
  startFlow,
  showMap,
  mapLabel = "Explore diagram",
  enter
}: {
  title: string;
  flowTitle?: string;
  startFlow?: () => void;
  showMap?: () => void;
  mapLabel?: string;
  enter?: () => void;
}) {
  return (
    <aside className="kd-learn-card kd-entrance" aria-label="Focus building">
      <div className="kd-learn-eyebrow"><span /> Start here</div>
      <h1>{title}</h1>
      {showMap && (
        <button type="button" className="kd-learn-action kd-learn-primary" onClick={showMap}>
          <span aria-hidden="true">◇</span> {mapLabel}
        </button>
      )}
      {(startFlow || enter) && <div className="kd-entrance-secondary">
        {startFlow && <button type="button" className={`kd-learn-action${showMap ? "" : " kd-learn-primary"}`} onClick={startFlow}
          aria-label={flowTitle ? `Replay scenario · ${flowTitle}` : undefined} title={flowTitle}>
          <span aria-hidden="true">▷</span> Replay scenario
        </button>}
        {enter && <button type="button" className="kd-learn-action" onClick={enter}>Enter building →</button>}
      </div>}
    </aside>
  );
}

export function ReplayPanels({
  replay,
  controls,
  openSource,
  traces,
  backToDiagram,
  practice,
  ask
}: {
  replay: FlowPlayback;
  controls: SpaceHandle["replay"] | undefined;
  openSource: OpenSource;
  traces: ReplayTrace[];
  backToDiagram?: { view: "Explain" | "Inspect"; open: () => void };
  practice?: () => void;
  ask?: () => void;
}) {
  const { title, scenarioId, scenarios, summary, actor, caption, detail, source, state } = replay;
  const current = Math.min(replay.steps, Math.max(1, replay.step + 1));
  const heading = useRef<HTMLHeadingElement>(null);
  const scenarioTitleId = useId();
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [replay.flowId]);
  const selectedTrace = traces.find(({ id }) => id === scenarioId);
  const scenarioTitle = scenarios.find(({ id }) => id === scenarioId)?.title ?? selectedTrace?.title;
  return (
    <>
      <aside className="kd-learn-card kd-replay-inspector" aria-label="Scenario details">
        <div className="kd-learn-heading">
          <div className="kd-learn-eyebrow"><span /> Scenario replay</div>
          <button type="button" className="kd-learn-icon" onClick={() => controls?.close()} aria-label="Close replay">×</button>
        </div>
        <h2 ref={heading} tabIndex={-1}>{title}</h2>
        {backToDiagram && <button className="kd-doc-link kd-diagram-back" type="button" onClick={backToDiagram.open}>← Back to {backToDiagram.view}</button>}
        {scenarioTitle && <div className="kd-replay-active-scenario" id={scenarioTitleId}>
          <span className="kd-learn-eyebrow">Active scenario</span>
          <strong>{scenarioTitle}</strong>
        </div>}
        {scenarios.length > 1 && (
          <label className="kd-scenario-picker">
            Change scenario
            <select value={scenarioId} title={scenarioTitle} aria-describedby={scenarioTitle ? scenarioTitleId : undefined}
              onChange={(event) => controls?.select(event.target.value)}>
              {scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.title}</option>)}
            </select>
          </label>
        )}
        {summary && <p className="kd-replay-summary">{summary}</p>}
        <div className="kd-replay-step" aria-live="polite">
          <div className="kd-learn-eyebrow">Step {current} of {replay.steps}{actor ? ` · ${actor}` : ""}</div>
          {caption && <h3>{caption}</h3>}
          {detail && <p>{detail}</p>}
        </div>
        {!!state?.length && (
          <dl className="kd-example-state">
            {state.map(({ key, value }, index) => (
              <div key={`${key}:${index}`}><dt>{key}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        )}
        <details className="kd-diagram-directory kd-replay-timeline">
          <summary>Replay steps · {replay.steps}</summary>
          <ol aria-label="Steps in this scenario">
            {replay.timeline.map(({ caption: stepTitle, actor: stepActor }, index) => (
              <li key={index}><button type="button" aria-current={index === replay.step ? "step" : undefined}
                onClick={() => controls?.seek(index)}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <span>{stepTitle}{stepActor && stepActor !== stepTitle && <small>{stepActor}</small>}</span>
              </button></li>
            ))}
          </ol>
        </details>
        {selectedTrace && traces.length > 1 && <ReplayComparison current={selectedTrace}
          alternatives={traces.filter(({ id }) => id !== scenarioId)} openAt={(id, step) => {
            if (id !== scenarioId) controls?.select(id);
            controls?.seek(step);
          }} />}
        {source && (
          <button type="button" className="kd-learn-action kd-learn-primary" onClick={() => openSource(source, caption ?? title)}>
            Open source <span aria-hidden="true">↗</span>
          </button>
        )}
        <div className="kd-lesson-actions">
          {practice && <button type="button" className="kd-learn-action" onClick={practice}>Practice</button>}
          {ask && <button type="button" className="kd-learn-action" onClick={ask}>Ask about this step</button>}
        </div>
      </aside>
      <div className="kd-replay-transport" aria-label="Scenario controls">
        <button type="button" disabled={replay.step <= 0} onClick={() => controls?.step(-1)}>‹ Back</button>
        <button type="button" className="kd-transport-primary" onClick={() => {
          if (replay.playing) controls?.pause();
          else controls?.play();
        }}>
          {replay.playing ? "Ⅱ Pause" : replay.finished ? "▷ Play again" : "▷ Play"}
        </button>
        <button type="button" disabled={replay.step >= replay.steps - 1} onClick={() => controls?.step(1)}>Step ›</button>
        <button type="button" onClick={() => controls?.restart()}>↻ Restart</button>
        <div className="kd-replay-progress">
          <progress aria-label="Playback progress" max={Math.max(1, replay.steps)} value={current} />
          <span>{current}/{replay.steps}</span>
        </div>
      </div>
    </>
  );
}

export function DiagramPanels({ inspect, controls, selection, clearSelection, openSource, openFlow, flowTitle, diagram, selectItem, showExplain, edit }: {
  inspect: DiagramPlayback;
  controls: SpaceHandle["inspect"] | undefined;
  selection?: SpaceFocus;
  clearSelection: () => void;
  openSource: OpenSource;
  openFlow?: () => void;
  flowTitle?: string;
  diagram?: SpaceDiagram;
  selectItem: (ref: string) => void;
  showExplain?: () => void;
  edit?: () => void;
}) {
  const plays = inspect.kind === "sequence" || !inspect.spatial;
  const title = inspect.kind === "sequence" ? "Sequence diagram" : diagramTitle({ kind: inspect.kind ?? "graph", id: inspect.diagramId });
  const nodeNames = new Map(diagram?.nodes.map((node) => [node.id, node.label]));
  const ref = (type: "node" | "edge", id: string) => `stage:diagram:${inspect.diagramId}:${type}:${id}`;
  const steps = Math.max(1, inspect.steps);
  const current = Math.min(steps, Math.max(1, inspect.step + 1));
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [inspect.diagramId]);
  return (
    <>
      <aside className="kd-learn-card kd-replay-inspector" aria-label={title}>
        <div className="kd-learn-heading">
          <div className="kd-learn-eyebrow"><span /> {title}</div>
          <button type="button" className="kd-learn-icon" onClick={() => controls?.close()} aria-label="Close diagram">×</button>
        </div>
        <h2 ref={heading} tabIndex={-1}>{inspect.title}</h2>
        {showExplain && <DiagramViewSwitch mode="inspect" onChange={(mode) => { if (mode === "explain") showExplain(); }} />}
        {inspect.caption ? <p aria-live="polite">{inspect.caption}</p> : <p>{
          inspect.kind === "sequence" ? "Step through messages and returns between participants." :
          inspect.kind === "state" ? "Select a state or transition to inspect its trigger and source." :
          inspect.kind === "matrix" ? "Compare the conditions and their outcomes. Select a row to inspect its source." :
          inspect.kind === "erd" ? "Select an entity or relationship. Open Explain to see every field and cardinality." :
          inspect.kind === "class" ? "Select a type or relationship. Open Explain to see every member." :
          inspect.kind === "mindmap" ? "Follow the branches out from the central topic. Select a topic to inspect its source." :
          inspect.kind === "timeline" ? "Read the entries in order. Select one to inspect its source." :
          inspect.kind === "stack" ? "Read the layers from the base up. Select a layer to inspect its source." :
          "Select a component or relationship to inspect it."
        }</p>}
        {diagram?.note && <p>{diagram.note}</p>}
        {diagram?.origin && <small className="kd-doc-origin">{diagram.origin === "code" ? "From code" : diagram.origin === "mermaid" ? "From a diagram in the docs"
          : diagram.origin === "user" ? "Edited in this workspace" : "From documentation"}</small>}
        {selection && <div className="kd-replay-step">
          <div className="kd-learn-eyebrow">{selection.kind === "edge" ? "Relationship" : "Component"}</div>
          <h3>{selection.title}</h3>
          {selection.summary && <p>{selection.summary}</p>}
          {selection.source && <button type="button" className="kd-learn-action" onClick={() => openSource(selection.source!, selection.title)}>Open selected source ↗</button>}
        </div>}
        {inspect.spatial && <button type="button" className="kd-learn-action" onClick={() => controls?.fit()}>Fit diagram</button>}
        {openFlow && <button type="button" className="kd-learn-action kd-learn-primary" onClick={openFlow}>▷ Start {flowTitle ?? "scenario"}</button>}
        {inspect.source && <button type="button" className="kd-learn-action" onClick={() => openSource(inspect.source!, inspect.caption ?? inspect.title)}>Read source ↗</button>}
        {edit && <button type="button" className="kd-learn-action" onClick={edit}>Edit diagram</button>}
        {inspect.spatial && diagram && <details className="kd-diagram-directory" open={diagram.kind === "matrix" || undefined}>
          <summary>{diagram.kind === "matrix" ? "Decision rows" : `Diagram index · ${diagram.nodes.length} items, ${diagram.edges.length} links`}</summary>
          {diagram.kind === "matrix" ? <div className="kd-doc-table" role="region" aria-label="Decision rows" tabIndex={0}>
            <table><thead><tr><th className="kd-doc-row-number" scope="col">#</th><th scope="col">Condition</th><th scope="col">Outcome</th></tr></thead><tbody>
              {diagram.edges.map((edge, i) => {
                const itemRef = ref("edge", edge.id ?? String(i));
                return <tr key={itemRef}><td className="kd-doc-row-number">{i + 1}</td><td><button type="button" className="kd-doc-link" aria-pressed={selection?.ref === itemRef} onClick={() => selectItem(itemRef)}>{nodeNames.get(edge.from) ?? edge.guard}</button></td>
                  <td>{nodeNames.get(edge.to)}</td></tr>;
              })}
            </tbody></table>
          </div> : <ul>
            {diagram.nodes.map((node) => <li key={node.id}><button type="button" aria-pressed={selection?.ref === ref("node", node.id)} onClick={() => selectItem(ref("node", node.id))}>{node.label}</button></li>)}
            {diagram.edges.map((edge, i) => {
              const itemRef = ref("edge", edge.id ?? String(i));
              return <li key={itemRef}><button type="button" aria-pressed={selection?.ref === itemRef} onClick={() => selectItem(itemRef)}>
                {nodeNames.get(edge.from)} → {nodeNames.get(edge.to)}{edge.label ? ` · ${edge.label}` : ""}</button></li>;
            })}
          </ul>}
        </details>}
      </aside>
      {plays && inspect.steps > 0 && (
        <div className="kd-replay-transport" aria-label="Diagram playback controls">
          <button type="button" disabled={inspect.step <= 0} onClick={() => { clearSelection(); controls?.step(-1); }}>‹ Back</button>
          <button type="button" className="kd-transport-primary" onClick={() => {
            clearSelection();
            if (inspect.playing) controls?.pause();
            else controls?.play();
          }}>
            {inspect.playing ? "Ⅱ Pause" : current === steps ? "▷ Play again" : "▷ Play"}
          </button>
          <button type="button" disabled={inspect.step >= steps - 1} onClick={() => { clearSelection(); controls?.step(1); }}>Step ›</button>
          <div className="kd-replay-progress">
            <progress aria-label="Diagram playback progress" max={steps} value={current} />
            <span>{current}/{steps}</span>
          </div>
        </div>
      )}
    </>
  );
}

export interface ReadingSelection {
  path: string;
  startLine?: number;
  endLine?: number;
  title?: string;
  excerpt?: DocExcerpt;
  error?: string;
  editorStatus?: string;
  pathLine?: string;
  document?: boolean;
  scrollTop?: number;
  openEvidencePanels?: string[];
}

export function SourceInspector({
  reading,
  close,
  back,
  openEditor,
  copyPath,
  documentActions,
  evidence,
  evidenceForLinks,
  openEvidence,
  onScroll,
  ask
}: {
  reading: ReadingSelection;
  close: () => void;
  back?: () => void;
  openEditor?: () => void;
  copyPath: () => void;
  documentActions?: Omit<Parameters<typeof DocumentReader>[0], "excerpt">;
  evidence: ReadingEvidence[];
  evidenceForLinks: (targets: DocumentTarget[]) => ReadingEvidence[];
  openEvidence: (item: ReadingEvidence) => void;
  onScroll?: (top: number) => void;
  ask?: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { heading.current?.focus(); }, [reading.path]);
  useEffect(() => { panel.current?.scrollTo(0, reading.scrollTop ?? 0); }, [reading.path, reading.startLine, reading.endLine, reading.scrollTop]);
  const file = reading.path.split(/[\\/]/).at(-1) ?? reading.path;
  const firstLine = reading.excerpt?.from ?? reading.startLine;
  const lastLine = reading.excerpt?.to ?? reading.endLine;
  const title = reading.title ?? (reading.document ? reading.excerpt?.sections?.[0]?.title : undefined) ?? file;
  const evidencePanel = (items: ReadingEvidence[], viaSourceLinks = false) => {
    if (!items.length) return null;
    const key = viaSourceLinks ? "source-links" : "direct";
    return <details className="kd-doc-evidence" data-reading-evidence={key} open={reading.openEvidencePanels?.includes(key) || undefined}>
    <summary>{viaSourceLinks ? "Via source links" : "Linked diagrams and replays"} <span>{items.length}</span></summary>
    <ul>
      {items.map((item) => {
        const { startLine, endLine } = item.source;
        const here = !viaSourceLinks && firstLine !== undefined && evidenceInRange(item.source, firstLine, lastLine ?? firstLine);
        return <li key={readingEvidenceKey(item)}>
          <button className="kd-doc-evidence-link" type="button" onClick={() => openEvidence(item)}>
            <span className="kd-learn-eyebrow">{item.kind === "diagram" ? "◇ Diagram" : "▷ Replay"}
              {startLine && <small className="kd-doc-evidence-range">{here ? "In view · " : ""}L{startLine}{endLine && endLine !== startLine ? `–${endLine}` : ""}</small>}
            </span>
            <strong>{item.label}</strong>
            {item.context && <small>{item.context}</small>}
            {viaSourceLinks && <small className="kd-source-path">{item.source.path}</small>}
          </button>
        </li>;
      })}
    </ul>
    </details>;
  };
  return (
    <aside ref={panel} onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)}
      className={`kd-learn-card kd-source-inspector${reading.document ? " kd-document-inspector" : ""}`} aria-label={reading.document ? "Document reader" : "Source inspector"}>
      <div className="kd-learn-heading">
        <div className="kd-learn-eyebrow"><span /> {reading.document ? "Document reader" : "Source inspector"}</div>
        <button type="button" className="kd-learn-icon" aria-label="Close source" onClick={close}>×</button>
      </div>
      {back && <button className="kd-doc-link kd-doc-back" type="button" onClick={back}>← Previous reading</button>}
      <h2 ref={heading} tabIndex={-1}>{title}</h2>
      <div className="kd-source-path" title={reading.path}>{reading.path}</div>
      {firstLine && (
        <div className="kd-source-range">{file} · {firstLine}{lastLine && lastLine !== firstLine ? `–${lastLine}` : ""}</div>
      )}
      {!reading.excerpt && !reading.error && <p role="status">Loading source…</p>}
      {reading.error && <p className="kd-source-notice">{reading.error}</p>}
      {reading.excerpt && reading.document && documentActions
        ? <DocumentReader excerpt={reading.excerpt} {...documentActions} linkedEvidence={(targets) => <>
          {evidencePanel(evidence)}
          {evidencePanel(evidenceForLinks(targets), true)}
        </>} />
        : (reading.excerpt || reading.error) && evidencePanel(evidence)}
      {reading.excerpt && (!reading.document || !documentActions) && (
        <pre className="kd-source-code" tabIndex={0} aria-label="Source excerpt">
          {reading.excerpt.text.split("\n").map((line, index) => (
            <span className="kd-source-line" key={index}>
              <span aria-hidden="true">{reading.excerpt!.from + index}</span>
              <code>{line || " "}</code>
            </span>
          ))}
        </pre>
      )}
      <div className="kd-lesson-actions">
        {openEditor && <button type="button" className="kd-learn-action kd-learn-primary" onClick={openEditor}>Open in editor ↗</button>}
        <button type="button" className="kd-learn-action" onClick={copyPath}>Copy path{firstLine ? ":line" : ""}</button>
        {ask && reading.excerpt && <button type="button" className="kd-learn-action" onClick={ask}>Ask about this {reading.document ? "section" : "source"}</button>}
      </div>
      {reading.editorStatus && <p className="kd-source-notice" role="status">{reading.editorStatus}</p>}
      {reading.pathLine && <input className="kd-drawer-input" aria-label="Resolved source location" readOnly value={reading.pathLine} onFocus={(event) => event.currentTarget.select()} />}
    </aside>
  );
}
