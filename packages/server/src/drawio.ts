import { inflateRawSync } from "node:zlib";
import { SpaceDiagram, type TSpaceDocument } from "@kodyurd/scene-schema";

/**
 * Reads the first page of a diagrams.net (.drawio) file as a graph: shapes become nodes, connectors
 * relationships and containers groups. Geometry and styling are left behind; the city lays the graph
 * out itself. Anything outside these bounds returns nothing.
 */

type Diagram = TSpaceDocument["diagrams"][number];

const MAX_CHARS = 600_000;
const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (match, code: string) => {
    if (code[0] !== "#") return entities[code.toLowerCase()] ?? match;
    const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : " ";
  });
}

/** A shape label is often HTML; keep its words only. */
function label(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const text = decode(decode(value).replace(/<[^>]{0,400}>/g, " ")).replace(/[\u0000-\u001f<>"\\]/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max).trim() : undefined;
}

function attributes(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of text.matchAll(/([A-Za-z_][\w:.-]{0,40})\s*=\s*"([^"]*)"/g)) result[match[1]] = match[2];
  return result;
}

/** The graph model of the first page, inflating the compressed form older files use. */
function pageModel(xml: string): string | undefined {
  if (xml.includes("<mxGraphModel")) return xml;
  const page = /<diagram\b[^>]*>([^<]{1,600000})<\/diagram>/.exec(xml)?.[1]?.trim();
  if (!page) return undefined;
  try {
    const model = decodeURIComponent(inflateRawSync(Buffer.from(page, "base64"), { maxOutputLength: 4_000_000 }).toString("utf8"));
    return model.includes("<mxGraphModel") ? model : undefined;
  } catch {
    return undefined;
  }
}

export function parseDrawio(xml: string, owner: string, title: string): Diagram | undefined {
  if (xml.length > MAX_CHARS) return undefined;
  const model = pageModel(xml);
  if (!model || model.length > 4_000_000) return undefined;

  interface Cell { id: string; value?: string; parent?: string; source?: string; target?: string; style: string; vertex: boolean; edge: boolean }
  const cells: Cell[] = [];
  let wrapper: Record<string, string> | undefined;
  for (const match of model.matchAll(/<(object|UserObject|mxCell)\b([^>]{0,20000})>/g)) {
    const attrs = attributes(match[2]);
    if (match[1] !== "mxCell") {
      wrapper = attrs;
      continue;
    }
    const id = attrs.id ?? wrapper?.id;
    if (id) cells.push({
      id, value: attrs.value ?? wrapper?.label, parent: attrs.parent, source: attrs.source, target: attrs.target,
      style: attrs.style ?? "", vertex: attrs.vertex === "1", edge: attrs.edge === "1"
    });
    wrapper = undefined;
    if (cells.length > 2000) return undefined;
  }

  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const edgeLabels = new Map<string, string>();
  const shapes = cells.filter((cell) => {
    if (!cell.vertex) return false;
    const text = label(cell.value, 60);
    if (cell.parent && byId.get(cell.parent)?.edge) {
      if (text && !edgeLabels.has(cell.parent)) edgeLabels.set(cell.parent, text.slice(0, 48));
      return false;
    }
    return Boolean(text);
  });
  const containers = new Set(shapes.filter((cell) => shapes.some((other) => other.parent === cell.id)).map(({ id }) => id));
  const members = shapes.filter((cell) => !containers.has(cell.id)).slice(0, 40);
  const nodeId = new Map(members.map((cell, index) => [cell.id, `n${index + 1}`]));
  const nodes = members.map((cell) => ({
    id: nodeId.get(cell.id)!, label: label(cell.value, 60)!,
    group: cell.parent && containers.has(cell.parent) ? label(byId.get(cell.parent)?.value, 40) : undefined
  }));
  const edges = cells.filter((cell) => cell.edge && cell.source && cell.target && nodeId.has(cell.source) && nodeId.has(cell.target)
    && cell.source !== cell.target).slice(0, 80).map((cell, index) => ({
    id: `e${index + 1}`, from: nodeId.get(cell.source!)!, to: nodeId.get(cell.target!)!,
    label: label(cell.value, 48) ?? edgeLabels.get(cell.id),
    kind: /(?:^|;)dashed=1(?:;|$)/.test(cell.style) ? "dashed" as const : undefined
  }));
  const parsed = SpaceDiagram.safeParse({ id: "import", owner, title, kind: "graph", nodes, edges, origin: "user" });
  return parsed.success ? parsed.data : undefined;
}
