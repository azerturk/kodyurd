import type { DocExcerpt } from "../api";
import type { SpaceAssessmentQuestion, SpaceDiagram, SpaceFlow, SpaceSource } from "../space-types";
import type { ReplayTrace } from "./flow-replay";

/** Paths the reader opens as documents. Keep in step with the server's `source-paths.ts`. */
export const isDocumentPath = (path: string): boolean => /\.(?:md|markdown|mdx|rst|adoc|asciidoc)$/i.test(path);

export interface DocumentTarget {
  path: string;
  anchor?: string;
  from?: number;
  to?: number;
}

export function diagramForDocumentFence(diagrams: SpaceDiagram[], path: string, start: number, end: number, lines: string[]): SpaceDiagram | undefined {
  const syntax = lines.find((line) => line.trim() && !line.trimStart().startsWith("%%"))?.trim() ?? "";
  const kind = /^sequenceDiagram\b/i.test(syntax) ? "sequence" : /^stateDiagram\b/i.test(syntax) ? "state"
    : /^erDiagram\b/i.test(syntax) ? "erd" : /^classDiagram\b/i.test(syntax) ? "class" : /^mindmap\b/i.test(syntax) ? "mindmap"
      : /^(?:gantt|journey|timeline)\b/i.test(syntax) ? "timeline"
        : /^(?:flowchart|graph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/i.test(syntax) ? "graph" : undefined;
  if (!kind) return undefined;
  const coversFence = (source?: SpaceSource): boolean => Boolean(source?.path === path && source.startLine !== undefined &&
    source.startLine >= start - 2 && source.startLine <= end && (source.endLine ?? source.startLine) >= start);
  const candidates = diagrams.filter((diagram) => diagram.kind === kind);
  return candidates.find(({ source }) => coversFence(source)) ?? candidates.find(({ nodes, edges, claims }) =>
    nodes.some(({ source }) => coversFence(source)) || edges.some(({ source }) => coversFence(source)) ||
    claims?.some(({ evidence }) => evidence.some((source) => !source.stale && coversFence(source))));
}

export function documentLink(current: string, rawTarget: string): DocumentTarget | null {
  const target = rawTarget.trim().replace(/^<(.+)>$/, "$1");
  const hash = target.indexOf("#");
  try {
    const path = decodeURIComponent(hash < 0 ? target : target.slice(0, hash));
    const anchor = hash < 0 ? "" : decodeURIComponent(target.slice(hash + 1));
    const parts = current.replaceAll("\\", "/").split("/");
    if ((!path && !anchor) || /[:\\?\x00-\x1f]/.test(path) || path.startsWith("/") || /[\x00-\x1f]/.test(anchor)) return null;
    if (path) {
      parts.pop();
      for (const part of path.split("/")) {
        if (part === ".") continue;
        if (part === "..") {
          if (!parts.length) return null;
          parts.pop();
        } else if (part) {
          parts.push(part);
        }
      }
    }
    if (!parts.length || parts.some((part) => !part || part.startsWith(".") || /[:\\\x00-\x1f]/.test(part))) return null;
    const resolvedPath = parts.join("/");
    const lines = /^L([1-9]\d{0,8})(?:-L?([1-9]\d{0,8}))?$/i.exec(anchor);
    if (lines) {
      const from = Number(lines[1]);
      const to = lines[2] ? Number(lines[2]) : from;
      return to >= from ? { path: resolvedPath, from, to } : null;
    }
    return anchor && isDocumentPath(resolvedPath) ? { path: resolvedPath, anchor } : { path: resolvedPath };
  } catch {
    return null;
  }
}

export function documentSection(sections: DocExcerpt["sections"], anchor: string) {
  const assigned = new Set<string>();
  for (const section of sections ?? []) {
    const base = section.title?.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-");
    if (!base) continue;
    let slug = base;
    for (let i = 1; assigned.has(slug); i += 1) slug = `${base}-${i}`;
    if (slug === anchor.toLowerCase()) return section;
    assigned.add(slug);
  }
  return undefined;
}

type ReplayTarget = NonNullable<SpaceAssessmentQuestion["replay"]>;
type EvidenceCard = { label: string; context?: string; source: SpaceSource };
export type ReadingEvidence = EvidenceCard & (
  | { kind: "diagram"; id: string; itemRef?: string }
  | { kind: "replay"; target: ReplayTarget }
);

export function readingEvidenceKey(item: ReadingEvidence): string {
  return item.kind === "diagram" ? item.itemRef ?? item.id
    : [item.target.flow, item.target.scenario, item.target.stepIndex].join(":");
}

export function indexReadingEvidence(
  diagrams: SpaceDiagram[],
  replays: { flow: SpaceFlow; traces: ReplayTrace[] }[]
): Map<string, ReadingEvidence[]> {
  const index = new Map<string, ReadingEvidence[]>();
  const add = (entry: ReadingEvidence): void => {
    const path = entry.source.path.replaceAll("\\", "/");
    const list = index.get(path);
    if (list) list.push(entry);
    else index.set(path, [entry]);
  };
  for (const diagram of diagrams) {
    const { id, title, source } = diagram;
    if (source) add({ kind: "diagram", id, label: title, source });
    if (diagram.kind === "stack" || diagram.kind === "timeline") continue;
    for (const node of diagram.nodes) {
      if (node.source) add({ kind: "diagram", id, itemRef: `stage:diagram:${id}:node:${node.id}`, label: node.label, context: title, source: node.source });
    }
    const names = new Map(diagram.nodes.map((node) => [node.id, node.label]));
    for (const [i, edge] of diagram.edges.entries()) {
      if (!edge.source) continue;
      const label = edge.label ?? `${names.get(edge.from) ?? edge.from} → ${names.get(edge.to) ?? edge.to}`;
      add({ kind: "diagram", id, itemRef: `stage:diagram:${id}:edge:${edge.id ?? i}`, label, context: title, source: edge.source });
    }
    for (const claim of diagram.claims ?? []) {
      const { kind, id: targetId } = claim.target;
      const target = kind === "node" ? diagram.nodes.find((node) => node.id === targetId) : diagram.edges.find((edge) => edge.id === targetId);
      if (!target) continue;
      const label = target.label ?? ("from" in target ? `${names.get(target.from) ?? target.from} → ${names.get(target.to) ?? target.to}` : title);
      for (const citation of claim.evidence) {
        if (citation.stale) continue;
        add({ kind: "diagram", id, itemRef: `stage:diagram:${id}:${kind}:${targetId}`, label, context: `${title} · Explain`, source: citation });
      }
    }
  }
  for (const { flow, traces } of replays) {
    if (flow.source) add({ kind: "replay", target: { flow: flow.id }, label: flow.title, source: flow.source });
    for (const trace of traces) {
      for (const [stepIndex, step] of trace.steps.entries()) {
        const { caption, actor, source } = step.point;
        if (!source) continue;
        add({ kind: "replay", target: { flow: flow.id, scenario: trace.id, step: step.id, stepIndex },
          label: caption ?? actor ?? `Step ${stepIndex + 1}`,
          context: `${flow.title} · ${trace.title} · Step ${stepIndex + 1}`, source });
      }
    }
  }
  return index;
}

export function evidenceInRange(source: SpaceSource, from: number, to: number): boolean {
  return source.startLine !== undefined && source.startLine <= to && (source.endLine ?? source.startLine) >= from;
}

export function relatedReadingEvidence(entries: ReadingEvidence[], from: number, to: number): ReadingEvidence[] {
  const score = (entry: ReadingEvidence): number => {
    const { startLine, endLine } = entry.source;
    const here = evidenceInRange(entry.source, from, to);
    const targeted = entry.kind === "diagram" ? Boolean(entry.itemRef) : entry.target.stepIndex !== undefined;
    if (!startLine) return 0;
    const distance = here ? 0 : Math.min(Math.abs(startLine - to), Math.abs((endLine ?? startLine) - from));
    return (here ? 100_000 : 0) + (targeted ? 10_000 : 0) - Math.min(8_000, distance * 10 + (endLine ?? startLine) - startLine);
  };
  const selected: ReadingEvidence[] = [];
  const groups = new Map<string, number>();
  const seen = new Set<string>();
  for (const entry of [...entries].sort((a, b) => score(b) - score(a))) {
    const target = readingEvidenceKey(entry);
    if (seen.has(target)) continue;
    const key = entry.kind === "diagram" ? `diagram:${entry.id}` : `replay:${entry.target.flow}`;
    const count = groups.get(key) ?? 0;
    if (count >= 2) continue;
    seen.add(target);
    selected.push(entry);
    groups.set(key, count + 1);
    if (selected.length === 8) break;
  }
  return selected;
}

export function evidenceViaSourceLinks(
  index: Map<string, ReadingEvidence[]>,
  targets: DocumentTarget[],
  direct: ReadingEvidence[]
): ReadingEvidence[] {
  const known = new Set(direct.map(readingEvidenceKey));
  const found: ReadingEvidence[] = [];
  for (const target of [...targets].sort((a, b) => Number(Boolean(b.from)) - Number(Boolean(a.from)))) {
    if (isDocumentPath(target.path)) continue;
    const entries = index.get(target.path);
    if (!entries) continue;
    const { from, to } = target;
    const candidates = from === undefined ? entries : entries.filter(({ source }) => evidenceInRange(source, from, to ?? from));
    for (const entry of relatedReadingEvidence(candidates, from ?? 1, to ?? from ?? 1)) {
      const key = readingEvidenceKey(entry);
      if (known.has(key)) continue;
      known.add(key);
      found.push(entry);
      if (found.length === 6) return found;
    }
  }
  return found;
}
