import type { SpaceDiagram } from "../space-types";

/** Keep authored and source-linked prose; only unmistakable unsourced generation details fold away. */
export function diagramNote(diagram?: Pick<SpaceDiagram, "note" | "origin" | "source">): { content?: string; diagnostic?: string } {
  const note = diagram?.note;
  if (!note) return {};
  if (diagram.origin === "user" || diagram.origin === "docs" || diagram.origin === "mermaid" || diagram.source?.startLine) return { content: note };
  return /\bevidence packet\b|\bpacket-only\b|\bvisual reference\b|\bzod\b|\bDELIVERABLE_(?:INVALID|INCOMPLETE)\b/i.test(note)
    ? { diagnostic: note } : { content: note };
}
