import type { SpaceDiagram } from "../space-types";

/** An accessible view of the current draft, including links that loop back to the same item. */
export function DiagramDraftPreview({ diagram }: { diagram: SpaceDiagram }) {
  const names = new Map(diagram.nodes.map(({ id, label }) => [id, label || "Unnamed item"]));
  return <details className="kd-editor-preview">
    <summary>Draft preview · {diagram.nodes.length} items · {diagram.edges.length} links</summary>
    <div className="kd-editor-preview-content">
      <p>Changes appear here before you save.</p>
      <ol aria-label="Draft items">
        {diagram.nodes.map((node) => <li key={node.id}>
          <strong>{node.label || "Unnamed item"}</strong>
          {node.group && <small>{node.group}</small>}
          {!!node.fields?.length && <ul>{node.fields.map((field, index) => <li key={`${field.name}:${index}`}>
            {field.name}: {field.type}{field.keys?.length ? ` · ${field.keys.join(", ")}` : ""}
          </li>)}</ul>}
        </li>)}
      </ol>
      {!!diagram.edges.length && <ul aria-label="Draft links">
        {diagram.edges.map((edge, index) => <li key={edge.id ?? index}>
          <strong>{names.get(edge.from) ?? "Missing item"} → {names.get(edge.to) ?? "Missing item"}</strong>
          {(edge.label || edge.guard || edge.cardinality) && <span>{[
            edge.label, edge.guard && `When ${edge.guard}`, edge.cardinality && `${edge.cardinality.from} to ${edge.cardinality.to}`
          ].filter(Boolean).join(" · ")}</span>}
        </li>)}
      </ul>}
    </div>
  </details>;
}
