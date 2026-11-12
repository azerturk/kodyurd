import type { TSpaceDocument, DiagramLayout, LDiagramNode, LDiagramEdge } from "@kodyurd/scene-schema";

/**
 * Deterministic diagram layouter (P3) — written in-repo, no dependencies.
 *
 * graph:    longest-path layering (cycle-safe) and barycenter ordering.
 *           Small maps fold into two rows with routes in the open gaps.
 * sequence: lifelines (actors as columns, messages as ordered horizontal arrows).
 * state:    reachability layers from explicit initial states, preserving retries.
 * erd:      graph layers with room for entity fields and relationship cardinality.
 * class:    the same cards for classes, their members and typed relations.
 * mindmap:  the root in the middle, each branch in its own wedge around it.
 * stack:    vertical layers, bottom-up.
 * timeline: horizontal chain.
 * matrix:   grid, grouped by `group` (columns), insertion order inside.
 *
 * Determinism: input order is the only tiebreaker; no randomness anywhere.
 * Output units are canvas-ish pixels; the engine scales panels uniformly.
 */

type SpaceDiagramT = TSpaceDocument["diagrams"][number];

const NODE_H = 44;
const GAP_X = 70;
const GAP_Y = 26;
const PAD = 36;
const COMPACT_GAP_X = 90;
const COMPACT_GAP_Y = 124;

const nodeW = (label: string) => Math.max(96, Math.min(240, 24 + label.length * 8));

function layerByLongestPath(diagram: SpaceDiagramT): Map<string, number> {
  const ids = diagram.nodes.map((n) => n.id);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  const seen = new Set<string>();
  for (const e of diagram.edges) {
    const key = `${e.from}->${e.to}`;
    if (e.from === e.to || seen.has(key)) continue;
    seen.add(key);
    out.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  // Kahn order; leftover nodes (cycles) are appended in input order, which
  // breaks each cycle deterministically at its first-listed node.
  const order: string[] = [];
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const indegWork = new Map(indeg);
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of out.get(id)!) {
      const left = (indegWork.get(next) ?? 0) - 1;
      indegWork.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  for (const id of ids) if (!order.includes(id)) order.push(id);

  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const id of order) {
    for (const next of out.get(id)!) {
      if (order.indexOf(next) > order.indexOf(id)) {
        layer.set(next, Math.max(layer.get(next)!, layer.get(id)! + 1));
      }
    }
  }
  return layer;
}

function orderLayersByBarycenter(
  diagram: SpaceDiagramT,
  layer: Map<string, number>
): Map<number, string[]> {
  const layers = new Map<number, string[]>();
  for (const n of diagram.nodes) {
    const l = layer.get(n.id)!;
    const list = layers.get(l) ?? [];
    list.push(n.id);
    layers.set(l, list);
  }
  const neighbors = (id: string, side: "in" | "out") =>
    diagram.edges.filter((e) => (side === "in" ? e.to === id : e.from === id))
      .map((e) => (side === "in" ? e.from : e.to));
  const maxLayer = Math.max(...[...layers.keys()], 0);
  for (let sweep = 0; sweep < 4; sweep++) {
    const forward = sweep % 2 === 0;
    for (let l = forward ? 1 : maxLayer - 1; forward ? l <= maxLayer : l >= 0; forward ? l++ : l--) {
      const prev = layers.get(forward ? l - 1 : l + 1) ?? [];
      const index = new Map(prev.map((id, i) => [id, i]));
      const list = layers.get(l) ?? [];
      const scored = list.map((id, i) => {
        const ns = neighbors(id, forward ? "in" : "out").filter((n) => index.has(n));
        const bary = ns.length === 0 ? i : ns.reduce((s, n) => s + index.get(n)!, 0) / ns.length;
        return { id, bary, i };
      });
      scored.sort((a, b) => a.bary - b.bary || a.i - b.i);
      layers.set(l, scored.map((s) => s.id));
    }
  }
  return layers;
}

function stateLayers(diagram: SpaceDiagramT): Map<string, number> {
  const roots = diagram.nodes.filter((node) => node.hint === "initial").map((node) => node.id);
  if (!roots.length) return layerByLongestPath(diagram);
  const layer = new Map(roots.map((id) => [id, 0]));
  const queue = [...roots];
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i];
    for (const edge of diagram.edges) {
      if (edge.from !== from || layer.has(edge.to)) continue;
      layer.set(edge.to, layer.get(from)! + 1);
      queue.push(edge.to);
    }
  }
  const fallback = layerByLongestPath(diagram);
  const next = Math.max(...layer.values(), 0) + 1;
  const disconnected = diagram.nodes.filter((node) => !layer.has(node.id));
  const first = Math.min(...disconnected.map((node) => fallback.get(node.id)!));
  for (const node of disconnected) layer.set(node.id, next + fallback.get(node.id)! - first);
  return layer;
}

export function usesCompactGraphLayout(diagram: SpaceDiagramT): boolean {
  return diagram.kind === "graph" && diagram.nodes.length >= 4 && diagram.nodes.length <= 8;
}

function centeredOffset(index: number, total: number, max: number): number {
  if (total <= 1) return 0;
  return (index / (total - 1) * 2 - 1) * Math.min(max, (total - 1) * 5);
}

function layoutCompactGraph(diagram: SpaceDiagramT): DiagramLayout {
  const layers = orderLayersByBarycenter(diagram, layerByLongestPath(diagram));
  const order = Array.from(layers.keys()).sort((a, b) => a - b).flatMap((rank) => layers.get(rank)!);
  const widths = new Map(diagram.nodes.map((node) => [node.id, nodeW(node.label)]));
  const colWidth = Math.max(...widths.values());
  const cols = Math.ceil(order.length / 2);
  const nodes: LDiagramNode[] = [];
  const slots = new Map<string, { node: LDiagramNode; row: number; col: number }>();
  order.forEach((id, i) => {
    const row = i < cols ? 0 : 1;
    // Fold at the right edge so the main route can continue straight down.
    const col = row === 0 ? i : 2 * cols - i - 1;
    const w = widths.get(id)!;
    const node = { id, x: PAD + col * (colWidth + COMPACT_GAP_X) + (colWidth - w) / 2,
      y: PAD + row * (NODE_H + COMPACT_GAP_Y), w, h: NODE_H };
    nodes.push(node);
    slots.set(id, { node, row, col });
  });

  const pairs = diagram.edges.map(({ from, to }) => [from, to].sort().join("\0"));
  const totals = new Map<string, number>();
  const used = new Map<string, number>();
  for (const pair of pairs) totals.set(pair, (totals.get(pair) ?? 0) + 1);

  const gutterTop = PAD + NODE_H;
  const gutterBottom = gutterTop + COMPACT_GAP_Y;
  const across = diagram.edges.filter(({ from, to }) => slots.get(from)!.row !== slots.get(to)!.row).length;
  let crossLane = 0;
  const edges = diagram.edges.map(({ from, to, label }, i): LDiagramEdge => {
    const a = slots.get(from)!;
    const b = slots.get(to)!;
    const ax = a.node.x + a.node.w / 2;
    const bx = b.node.x + b.node.w / 2;
    const y = a.node.y + NODE_H / 2;
    const pair = pairs[i];
    const index = used.get(pair) ?? 0;
    used.set(pair, index + 1);
    const offset = centeredOffset(index, totals.get(pair)!, 12);

    if (from === to) {
      const sideX = a.node.x + a.node.w;
      const anchorY = a.row === 0 ? gutterTop : gutterBottom;
      const turnY = anchorY + (a.row === 0 ? 22 : -22) + offset;
      return { from, to, label, points: [
        { x: sideX, y: y + offset }, { x: sideX + 22, y: y + offset },
        { x: sideX + 22, y: turnY }, { x: ax + offset, y: turnY }, { x: ax + offset, y: anchorY }
      ] };
    }
    if (a.row === b.row && Math.abs(a.col - b.col) === 1) {
      const leftToRight = b.col > a.col;
      const startX = leftToRight ? a.node.x + a.node.w : a.node.x;
      const endX = leftToRight ? b.node.x : b.node.x + b.node.w;
      return { from, to, label, points: [
        { x: startX, y: y + offset }, { x: (startX + endX) / 2, y: y + offset }, { x: endX, y: y + offset }
      ] };
    }
    const startY = a.row === 0 ? gutterTop : gutterBottom;
    const endY = b.row === 0 ? gutterTop : gutterBottom;
    const sameRow = a.row === b.row;
    const laneY = sameRow
      ? startY + (a.row === 0 ? 23 : -23) + offset
      : (gutterTop + gutterBottom) / 2 + centeredOffset(crossLane++, across, 24);
    const x1 = ax + offset;
    const x2 = bx + offset;
    const points = x1 === x2
      ? [{ x: x1, y: startY }, { x: x1, y: laneY }, { x: x1, y: endY }]
      : [
        { x: x1, y: startY }, { x: x1, y: laneY }, { x: (x1 + x2) / 2, y: laneY },
        { x: x2, y: laneY }, { x: x2, y: endY }
      ];
    return { from, to, label, points };
  });
  return {
    id: diagram.id,
    width: 2 * PAD + cols * colWidth + (cols - 1) * COMPACT_GAP_X,
    height: 2 * PAD + 2 * NODE_H + COMPACT_GAP_Y,
    nodes,
    edges,
    lanes: []
  };
}

function layoutGraph(diagram: SpaceDiagramT, layer = layerByLongestPath(diagram)): DiagramLayout {
  const layers = orderLayersByBarycenter(diagram, layer);
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const nodes: LDiagramNode[] = [];
  const colX: number[] = [];
  const entityMap = diagram.kind === "erd" || diagram.kind === "class";
  const gapX = entityMap ? 154 : GAP_X;
  const gapY = entityMap ? 82 : GAP_Y;
  const widthFor = (id: string): number => entityMap ? Math.max(210, nodeW(byId.get(id)!.label)) : nodeW(byId.get(id)!.label);
  const heightFor = (id: string): number => {
    if (!entityMap) return NODE_H;
    const fieldCount = byId.get(id)!.fields?.length ?? 0;
    return 58 + Math.min(6, Math.max(1, fieldCount)) * 27;
  };
  let x = PAD;
  const maxLayer = Math.max(...[...layers.keys()], 0);
  for (let l = 0; l <= maxLayer; l++) {
    const list = layers.get(l) ?? [];
    const w = Math.max(...list.map(widthFor), 96);
    colX[l] = x;
    let y = PAD;
    for (const id of list) {
      const h = heightFor(id);
      nodes.push({ id, x, y, w, h });
      y += h + gapY;
    }
    x += w + gapX;
  }
  // Center each column vertically.
  const maxBottom = Math.max(...nodes.map((n) => n.y + n.h), PAD);
  for (let l = 0; l <= maxLayer; l++) {
    const col = nodes.filter((n) => n.x === colX[l]);
    const bottom = Math.max(...col.map((n) => n.y + n.h), PAD);
    const shift = (maxBottom - bottom) / 2;
    for (const n of col) n.y += shift;
  }
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const edges: LDiagramEdge[] = diagram.edges.map((e) => {
    const a = pos.get(e.from)!;
    const b = pos.get(e.to)!;
    const start = { x: a.x + a.w, y: a.y + a.h / 2 };
    const end = { x: b.x, y: b.y + b.h / 2 };
    const midX = (start.x + end.x) / 2;
    const points =
      b.x > a.x
        ? [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]
        : [ // back-edge: route below both nodes
            { x: a.x + a.w / 2, y: a.y + a.h },
            { x: a.x + a.w / 2, y: maxBottom + 24 },
            { x: b.x + b.w / 2, y: maxBottom + 24 },
            { x: b.x + b.w / 2, y: b.y + b.h }
          ];
    return { from: e.from, to: e.to, points, label: e.label };
  });
  const width = x - gapX + PAD;
  const height = maxBottom + PAD + (edges.some((e) => e.points.length === 4 && e.points[1].y > maxBottom) ? 48 : 0);
  return { id: diagram.id, width, height, nodes, edges, lanes: [] };
}

function layoutSequence(diagram: SpaceDiagramT): DiagramLayout {
  const laneGap = 170;
  const headerY = PAD;
  const firstMsgY = headerY + NODE_H + 30;
  const msgGap = 46;
  const nodes: LDiagramNode[] = diagram.nodes.map((n, i) => ({
    id: n.id,
    x: PAD + i * laneGap,
    y: headerY,
    w: Math.min(nodeW(n.label), laneGap - 30),
    h: NODE_H
  }));
  const laneX = new Map(nodes.map((n) => [n.id, n.x + n.w / 2]));
  const edges: LDiagramEdge[] = diagram.edges.map((e, i) => {
    const y = firstMsgY + i * msgGap;
    return {
      from: e.from,
      to: e.to,
      points: [
        { x: laneX.get(e.from) ?? PAD, y },
        { x: laneX.get(e.to) ?? PAD, y }
      ],
      label: e.label
    };
  });
  return {
    id: diagram.id,
    width: PAD * 2 + Math.max(diagram.nodes.length - 1, 0) * laneGap + 140,
    height: firstMsgY + diagram.edges.length * msgGap + PAD,
    nodes,
    edges,
    lanes: nodes.map((n) => ({ nodeId: n.id, x: n.x + n.w / 2 }))
  };
}

function layoutStack(diagram: SpaceDiagramT): DiagramLayout {
  const w = Math.max(...diagram.nodes.map((n) => nodeW(n.label)), 180) + 60;
  const nodes: LDiagramNode[] = diagram.nodes.map((n, i) => ({
    id: n.id,
    x: PAD,
    // First node = bottom layer (bottom-up stacks read upward).
    y: PAD + (diagram.nodes.length - 1 - i) * (NODE_H + 12),
    w,
    h: NODE_H
  }));
  return {
    id: diagram.id,
    width: PAD * 2 + w,
    height: PAD * 2 + diagram.nodes.length * (NODE_H + 12) - 12,
    nodes,
    edges: [],
    lanes: []
  };
}

function layoutTimeline(diagram: SpaceDiagramT): DiagramLayout {
  const nodes: LDiagramNode[] = [];
  let x = PAD;
  for (const n of diagram.nodes) {
    const w = nodeW(n.label);
    nodes.push({ id: n.id, x, y: PAD + 24, w, h: NODE_H });
    x += w + 56;
  }
  const edges: LDiagramEdge[] = nodes.slice(1).map((b, i) => {
    const a = nodes[i];
    const y = a.y + a.h / 2;
    return { from: a.id, to: b.id, points: [{ x: a.x + a.w, y }, { x: b.x, y }] };
  });
  return { id: diagram.id, width: x - 56 + PAD, height: PAD * 2 + 24 + NODE_H, nodes, edges, lanes: [] };
}

function layoutMatrix(diagram: SpaceDiagramT): DiagramLayout {
  const groups: string[] = [];
  for (const n of diagram.nodes) {
    const g = n.group ?? "";
    if (!groups.includes(g)) groups.push(g);
  }
  const colW = Math.max(...diagram.nodes.map((n) => nodeW(n.label)), 120) + 20;
  const counters = new Map<string, number>();
  const nodes: LDiagramNode[] = diagram.nodes.map((n) => {
    const g = n.group ?? "";
    const col = groups.indexOf(g);
    const row = counters.get(g) ?? 0;
    counters.set(g, row + 1);
    return { id: n.id, x: PAD + col * colW, y: PAD + 30 + row * (NODE_H + 10), w: colW - 20, h: NODE_H };
  });
  const rows = Math.max(...[...counters.values()], 1);
  return {
    id: diagram.id,
    width: PAD * 2 + groups.length * colW - 20,
    height: PAD * 2 + 30 + rows * (NODE_H + 10) - 10,
    nodes,
    edges: [],
    lanes: []
  };
}

function layoutMindmap(diagram: SpaceDiagramT): DiagramLayout {
  const ids = new Set(diagram.nodes.map(({ id }) => id));
  const children = new Map<string, string[]>();
  const placed = new Set<string>();
  for (const { from, to } of diagram.edges) {
    if (from === to || placed.has(to) || !ids.has(from) || !ids.has(to)) continue;
    placed.add(to);
    children.set(from, [...(children.get(from) ?? []), to]);
  }
  const root = diagram.nodes.find(({ id }) => !placed.has(id)) ?? diagram.nodes[0];
  // A branch takes a share of the circle in proportion to its leaves.
  const leaves = new Map<string, number>();
  const count = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const total = (children.get(id) ?? []).reduce((sum, child) => sum + count(child, seen), 0) || 1;
    leaves.set(id, total);
    return total;
  };
  count(root.id, new Set());
  const center = new Map<string, { x: number; y: number }>();
  const RING_X = 300;
  const RING_Y = 170;
  const place = (id: string, depth: number, start: number, end: number): void => {
    const angle = (start + end) / 2;
    center.set(id, depth === 0 ? { x: 0, y: 0 } : { x: Math.cos(angle) * RING_X * depth, y: Math.sin(angle) * RING_Y * depth });
    let cursor = start;
    for (const child of children.get(id) ?? []) {
      if (center.has(child)) continue;
      const span = (end - start) * (leaves.get(child) ?? 1) / (leaves.get(id) ?? 1);
      place(child, depth + 1, cursor, cursor + span);
      cursor += span;
    }
  };
  place(root.id, 0, -Math.PI / 2, Math.PI * 1.5);
  // Topics outside the tree keep a row of their own below it.
  const loose = diagram.nodes.filter(({ id }) => !center.has(id));
  const floor = Math.max(...[...center.values()].map(({ y }) => y), 0) + RING_Y;
  loose.forEach(({ id }, index) => center.set(id, { x: (index - (loose.length - 1) / 2) * 260, y: floor }));
  const box = diagram.nodes.map(({ id, label }) => {
    const { x, y } = center.get(id)!;
    const w = nodeW(label);
    return { id, x: x - w / 2, y: y - NODE_H / 2, w, h: NODE_H };
  });
  const left = Math.min(...box.map(({ x }) => x));
  const top = Math.min(...box.map(({ y }) => y));
  const nodes: LDiagramNode[] = box.map((node) => ({ ...node, x: node.x - left + PAD, y: node.y - top + PAD }));
  const at = new Map(nodes.map((node) => [node.id, node]));
  const edges: LDiagramEdge[] = diagram.edges.flatMap(({ from, to, label }) => {
    const a = at.get(from);
    const b = at.get(to);
    return a && b ? [{ from, to, label, points: [{ x: a.x + a.w / 2, y: a.y + a.h / 2 }, { x: b.x + b.w / 2, y: b.y + b.h / 2 }] }] : [];
  });
  return {
    id: diagram.id,
    width: Math.max(...nodes.map(({ x, w }) => x + w)) + PAD,
    height: Math.max(...nodes.map(({ y, h }) => y + h)) + PAD,
    nodes, edges, lanes: []
  };
}

export function layoutDiagram(diagram: SpaceDiagramT): DiagramLayout {
  switch (diagram.kind) {
    case "sequence":
      return layoutSequence(diagram);
    case "state":
      return layoutGraph(diagram, stateLayers(diagram));
    case "erd":
    case "class":
      return layoutGraph(diagram);
    case "mindmap":
      return layoutMindmap(diagram);
    case "stack":
      return layoutStack(diagram);
    case "timeline":
      return layoutTimeline(diagram);
    case "matrix":
      return layoutMatrix(diagram);
    case "graph":
      return usesCompactGraphLayout(diagram) ? layoutCompactGraph(diagram) : layoutGraph(diagram);
  }
}
