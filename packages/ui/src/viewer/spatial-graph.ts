import * as pc from "playcanvas";
import type { DiagramLayout, SpaceDiagram, SpaceSource } from "../space-types";

interface Position {
  x: number;
  z: number;
  y?: number;
}

export interface SpatialNode extends Position {
  id: string;
  label: string;
  width: number;
  depth: number;
  visualHeight?: number;
  icon?: string;
  kind?: string;
  group?: string;
  summary?: string;
  source?: SpaceSource;
}

export interface SpatialEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  detail?: string;
  kind?: string;
  cardinality?: SpaceDiagram["edges"][number]["cardinality"];
  source?: SpaceSource;
}

type Material = (color: string, emissive?: string, strength?: number) => pc.StandardMaterial;
type ContactShadow = (parent: pc.Entity, x: number, z: number, width: number, depth: number, y: number) => void;
type Part = (
  parent: pc.Entity, type: "box" | "sphere" | "cone" | "cylinder",
  sx: number, sy: number, sz: number, x: number, y: number, z: number,
  material: pc.StandardMaterial
) => pc.Entity;

interface SpatialLink {
  edge: SpatialEdge;
  points: Position[];
  pieces: pc.Entity[];
  label: Position;
}

export interface SpatialView {
  x: number;
  z: number;
  width: number;
  depth: number;
  height?: number;
  groupLabels: { label: string; x: number; z: number }[];
  linkShapes: SpatialLink[];
  paint(node?: string, edge?: string, visitedNodes?: ReadonlySet<string>, visitedEdges?: ReadonlySet<string>): void;
  pulse(edge: string | undefined, t: number): void;
}

export function spatialDiagram(diagram: SpaceDiagram, layout: DiagramLayout): { nodes: SpatialNode[]; edges: SpatialEdge[] } {
  const metadata = new Map(diagram.nodes.map((node) => [node.id, node]));
  const sources = new Set(diagram.edges.map(({ from }) => from));
  const targets = new Set(diagram.edges.map(({ to }) => to));
  const roots = diagram.nodes.filter(({ id }) => sources.has(id) && !targets.has(id));
  const stateKind = (id: string): string | undefined => {
    if (diagram.kind !== "state") return undefined;
    if (roots.length === 1 && roots[0].id === id) return "initial";
    if (targets.has(id) && !sources.has(id)) return "terminal";
    return "state";
  };
  const scale = Math.min(0.025, 36 / Math.max(1, layout.width), 21 / Math.max(1, layout.height));
  const nodes = layout.nodes.flatMap((position) => {
    const node = metadata.get(position.id);
    if (!node) return [];
    return [{
      id: node.id,
      label: node.label,
      width: position.w * scale * 0.90,
      depth: diagram.kind === "erd" ? position.h * scale * 0.90 : Math.min(1.52, position.h * scale * 0.99),
      x: (position.x + position.w / 2 - layout.width / 2) * scale,
      z: (position.y + position.h / 2 - layout.height / 2) * scale * (diagram.kind === "matrix" ? 1.55 : 1),
      icon: node.icon,
      kind: node.hint ?? stateKind(node.id),
      group: node.group,
      source: node.source ?? diagram.source
    }];
  });
  const groups = new Map<string, SpatialNode[]>();
  for (const node of nodes) {
    const group = node.group ?? "";
    const members = groups.get(group) ?? [];
    members.push(node);
    groups.set(group, members);
  }
  const compactGroups = diagram.kind === "graph" && nodes.length >= 4 && nodes.length <= 8 && groups.size <= 4;
  if (groups.size > 1 && groups.size <= 6) {
    let x = 0;
    for (const group of groups.values()) {
      if (compactGroups) {
        const columns = Math.ceil(group.length / 3);
        const rows = Math.ceil(group.length / columns);
        const columnWidth = Math.max(...group.map((node) => node.width)) + 2;
        for (const [i, node] of group.entries()) {
          node.x = i % columns * columnWidth;
          node.z = (Math.floor(i / columns) - (rows - 1) / 2) * 4.2;
        }
      }
      const left = Math.min(...group.map((node) => node.x - node.width / 2));
      const right = Math.max(...group.map((node) => node.x + node.width / 2));
      for (const node of group) node.x += x - left;
      x += right - left + 2.6;
    }
    for (const node of nodes) node.x -= (x - 2.6) / 2;
  }
  return {
    nodes,
    edges: diagram.edges.map((edge, index) => ({
      id: edge.id ?? String(index),
      from: edge.from,
      to: edge.to,
      label: edge.label ?? edge.guard,
      detail: edge.cardinality ? `${edge.cardinality.from} to ${edge.cardinality.to}` : edge.guard,
      kind: edge.kind,
      cardinality: edge.cardinality,
      source: edge.source ?? diagram.source
    }))
  };
}

function connector(from: SpatialNode, to: SpatialNode, lane: number): Position[] {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (from.id === to.id) {
    const x = from.x + from.width / 2;
    const z = from.z - from.depth / 2;
    return [{ x, z: from.z }, { x: x + 0.9 + lane, z: from.z }, { x: x + 0.9 + lane, z: z - 0.8 - lane }, { x: from.x, z: z - 0.8 - lane }, { x: from.x, z }];
  }
  if (Math.abs(dx) < (from.width + to.width) / 2 + 0.35) {
    const sign = Math.sign(dz) || 1;
    const start = { x: from.x, z: from.z + sign * from.depth / 2 };
    const end = { x: to.x, z: to.z - sign * to.depth / 2 };
    if (lane !== 0 && Math.abs(dx) < 0.05) {
      const turn = Math.min(0.55, Math.abs(end.z - start.z) / 3) * sign;
      return [start, { x: start.x + lane, z: start.z + turn }, { x: end.x + lane, z: end.z - turn }, end];
    }
    const mid = (start.z + end.z) / 2 + lane;
    return [start, { x: start.x, z: mid }, { x: end.x, z: mid }, end];
  }
  const sign = Math.sign(dx);
  const start = { x: from.x + sign * from.width / 2, z: from.z };
  const end = { x: to.x - sign * to.width / 2, z: to.z };
  if (lane !== 0 && Math.abs(dz) < 0.05) {
    const turn = Math.min(0.55, Math.abs(end.x - start.x) / 3) * sign;
    return [start, { x: start.x + turn, z: start.z + lane }, { x: end.x - turn, z: end.z + lane }, end];
  }
  const mid = (start.x + end.x) / 2 + lane;
  return [start, { x: mid, z: start.z }, { x: mid, z: end.z }, end];
}

function softCorners(points: Position[]): Position[] {
  if (points.length < 3) return points;
  const smoothed: Position[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const next = points[i + 1];
    const corner = points[i];
    const a = Math.hypot(prev.x - corner.x, prev.z - corner.z);
    const b = Math.hypot(next.x - corner.x, next.z - corner.z);
    const r = Math.min(0.56, a / 3, b / 3);
    if (r < 0.02) continue;
    const from = { x: corner.x + (prev.x - corner.x) * r / a, z: corner.z + (prev.z - corner.z) * r / a };
    const to = { x: corner.x + (next.x - corner.x) * r / b, z: corner.z + (next.z - corner.z) * r / b };
    for (let j = 0; j <= 3; j++) {
      const t = j / 3;
      const u = 1 - t;
      smoothed.push({ x: u * u * from.x + 2 * u * t * corner.x + t * t * to.x, z: u * u * from.z + 2 * u * t * corner.z + t * t * to.z });
    }
  }
  smoothed.push(points.at(-1)!);
  return smoothed;
}

function along(points: Position[], t: number): Position {
  const distances = points.slice(1).map((point, i) => Math.hypot(point.x - points[i].x, point.z - points[i].z, (point.y ?? 0) - (points[i].y ?? 0)));
  let remaining = distances.reduce((a, b) => a + b, 0) * Math.max(0, Math.min(t, 1));
  for (const [i, distance] of distances.entries()) {
    if (distance > 0.001 && remaining <= distance) {
      const ratio = remaining / distance;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
        z: points[i].z + (points[i + 1].z - points[i].z) * ratio,
        y: (points[i].y ?? 0) + ((points[i + 1].y ?? 0) - (points[i].y ?? 0)) * ratio
      };
    }
    remaining -= distance;
  }
  return points.at(-1)!;
}

/** One shared mesh per open stage. Its render instances own its lifetime. */
function beveledSlabs(part: Part, device?: pc.GraphicsDevice) {
  let mesh: pc.Mesh | undefined;
  return (parent: pc.Entity, width: number, height: number, depth: number,
    x: number, y: number, z: number, material: pc.StandardMaterial): pc.Entity => {
    if (!device) return part(parent, "box", width, height, depth, x, y, z, material);
    if (!mesh) {
      const rings = [[-0.5, 0.44], [-0.32, 0.50], [0.28, 0.50], [0.50, 0.44]].map(([y, radius]) => {
        const corner = radius - 0.10;
        return [[-corner, -radius], [-radius, -corner], [-radius, corner], [-corner, radius],
          [corner, radius], [radius, corner], [radius, -corner], [corner, -radius]]
          .map(([x, z]) => [x, y, z]);
      });
      const positions: number[] = [];
      const indices: number[] = [];
      const face = (vertices: number[][]): void => {
        const first = positions.length / 3;
        for (const vertex of vertices) positions.push(...vertex);
        for (let i = 1; i < vertices.length - 1; i++) indices.push(first, first + i, first + i + 1);
      };
      face([...rings[0]].reverse());
      for (let level = 1; level < rings.length; level++) {
        for (let side = 0; side < rings[level].length; side++) {
          const next = (side + 1) % rings[level].length;
          face([rings[level - 1][side], rings[level - 1][next], rings[level][next], rings[level][side]]);
        }
      }
      face(rings[rings.length - 1]);
      mesh = new pc.Mesh(device);
      mesh.setPositions(positions);
      mesh.setNormals(pc.calculateNormals(positions, indices));
      mesh.setIndices(indices);
      mesh.update();
    }
    const entity = new pc.Entity("diagram-slab");
    entity.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, material, entity)] });
    entity.setLocalScale(width, height, depth);
    entity.setLocalPosition(x, y, z);
    parent.addChild(entity);
    return entity;
  };
}

const roleForIcon: Readonly<Record<string, string>> = {
  database: "store", cache: "store", queue: "queue", layers: "queue",
  gear: "worker", cycle: "worker", wrench: "worker", robot: "worker",
  monitor: "ui", phone: "ui", terminal: "ui", user: "actor", group: "actor",
  scales: "decision", funnel: "decision", puzzle: "decision", server: "service", chip: "service", box: "service",
  shield: "security", lock: "security", key: "security", warning: "warning",
  clock: "clock", calendar: "clock", document: "document", book: "document", folder: "document",
  truck: "transport", rocket: "transport", flag: "terminal", badge: "terminal", pin: "terminal",
  plug: "external", cloud: "external", globe: "external", chain: "external", antenna: "external",
  envelope: "message", bell: "message", speech: "message", image: "document", "grad-cap": "document",
  chart: "measurement", gauge: "measurement", coin: "measurement",
  factory: "worker", flask: "worker", bug: "warning", magnifier: "measurement", eye: "measurement"
};

function nodeRole(node: SpatialNode): string | undefined {
  if (node.kind && node.kind !== "state" && node.kind !== "service") return node.kind;
  return (node.icon && roleForIcon[node.icon]) || undefined;
}

/** Procedural role marks stand on the same mount point as a bundled model. */
function roleGlyph(parent: pc.Entity, role: string | undefined, unit: number, part: Part, material: Material): pc.Entity[] {
  const parts: pc.Entity[] = [];
  const add = (type: "box" | "sphere" | "cone" | "cylinder", w: number, h: number, d: number,
    x: number, y: number, z: number, color: string): pc.Entity => {
    const shape = part(parent, type, w * unit, h * unit, d * unit, x * unit, y * unit, z * unit, material(color));
    parts.push(shape);
    return shape;
  };
  if (role === "ui") {
    add("box", 2.28, 1.28, 0.25, 0, 1.07, 0, "#284f61");
    add("box", 1.88, 0.89, 0.035, 0, 1.08, 0.139, "#b8dce4");
    add("box", 0.28, 0.44, 0.28, 0, 0.31, 0, "#284f61");
    add("box", 1.42, 0.12, 0.72, 0, 0.06, 0, "#547d8b");
  } else if (role === "actor") {
    add("sphere", 0.83, 0.83, 0.83, 0, 1.32, 0, "#4b6a8b");
    add("sphere", 1.53, 0.86, 0.98, 0, 0.51, 0, "#728dad");
  } else if (role === "queue") {
    for (let i = 0; i < 3; i++) {
      add("box", 1.85, 0.22, 1.25, 0, 0.19 + i * 0.38, i * 0.12, "#416d84");
      add("box", 1.22, 0.13, 0.68, 0, 0.36 + i * 0.38, 0.17 + i * 0.12, "#9cc5d0");
    }
  } else if (role === "store") {
    for (let i = 0; i < 3; i++) {
      add("cylinder", 1.53, 0.36, 1.53, 0, 0.18 + i * 0.39, 0, "#3b736e");
      add("cylinder", 1.53, 0.07, 1.53, 0, 0.36 + i * 0.39, 0, "#9ac4b6");
    }
  } else if (role === "worker") {
    add("box", 1.82, 0.17, 0.93, 0, 0.09, 0.20, "#546e7b");
    add("box", 0.32, 1.41, 0.51, -0.65, 0.71, -0.26, "#486075");
    add("box", 1.45, 0.23, 0.52, -0.12, 1.31, -0.26, "#486075");
    add("box", 0.32, 0.51, 0.32, 0.43, 0.97, -0.26, "#6c8fa2");
    add("box", 0.54, 0.27, 0.59, 0.43, 0.30, 0.20, "#bcd5d9");
  } else if (role === "service") {
    add("box", 1.6, 1.43, 1.05, 0, 0.72, 0, "#496373");
    for (let i = 0; i < 3; i++) {
      add("box", 1.16, 0.12, 0.07, 0, 0.36 + i * 0.36, 0.55, "#a9c3c9");
      add("sphere", 0.14, 0.14, 0.14, 0.43, 0.36 + i * 0.36, 0.62, "#c2edc8");
    }
  } else if (role === "decision") {
    add("box", 0.20, 0.13, 0.77, 0, 0.12, 0.33, "#85613c");
    for (const side of [-1, 1]) {
      const arm = add("box", 0.19, 0.13, 0.90, side * 0.27, 0.12, -0.26, "#85613c");
      arm.setLocalEulerAngles(0, -side * 39, 0);
      add("cylinder", 0.30, 0.15, 0.30, side * 0.52, 0.12, -0.58, "#85613c");
    }
  } else if (role === "security") {
    add("box", 1.22, 0.82, 0.63, 0, 0.41, 0, "#8b6f48");
    add("box", 0.74, 0.17, 0.21, 0, 1.33, 0, "#4d626a");
    for (const side of [-1, 1]) add("box", 0.15, 0.58, 0.21, side * 0.31, 1.08, 0, "#4d626a");
    add("sphere", 0.16, 0.16, 0.10, 0, 0.46, 0.32, "#d9c49c");
  } else if (role === "warning") {
    const marker = add("cone", 1.18, 1.18, 1.18, 0, 0.64, 0, "#c58c58");
    marker.setLocalEulerAngles(18, 0, 0);
    add("cylinder", 1.04, 0.13, 1.04, 0, 0.07, 0, "#88583b");
  } else if (role === "clock") {
    const dial = add("cylinder", 1.3, 0.15, 1.3, 0, 0.68, 0, "#658795");
    dial.setLocalEulerAngles(90, 0, 0);
    add("box", 0.075, 0.38, 0.05, 0, 0.83, 0.09, "#e4edf0");
    add("box", 0.31, 0.075, 0.05, 0.12, 0.68, 0.09, "#e4edf0");
  } else if (role === "document") {
    add("box", 0.97, 1.26, 0.18, 0, 0.63, 0, "#78929e");
    for (let row = 0; row < 3; row++) add("box", 0.61, 0.066, 0.034, 0, 0.41 + row * 0.23, 0.09, "#edf0e7");
  } else if (role === "message") {
    add("box", 1.63, 1.05, 0.25, 0, 0.58, 0, "#487e7b");
    add("box", 1.44, 0.87, 0.06, 0, 0.58, 0.13, "#b7d6ca");
    for (const side of [-1, 1]) {
      const fold = add("box", 0.81, 0.095, 0.055, side * 0.345, 0.70, 0.18, "#487e7b");
      fold.setLocalEulerAngles(0, 0, side * 34);
    }
  } else if (role === "external") {
    add("cylinder", 1.45, 0.13, 1.45, 0, 0.07, 0, "#516672");
    add("cylinder", 0.19, 0.41, 0.19, 0, 0.29, 0, "#516672");
    add("sphere", 1.06, 1.06, 1.06, 0, 0.84, 0, "#80adb7");
    add("cylinder", 1.09, 0.13, 1.09, 0, 0.84, 0, "#bfd7d6");
    const axis = add("cylinder", 1.095, 0.12, 1.095, 0, 0.84, 0, "#557b86");
    axis.setLocalEulerAngles(0, 0, 48);
  } else if (role === "measurement") {
    add("box", 1.6, 0.16, 0.8, 0, 0.08, 0, "#586d72");
    for (const [index, height] of [0.37, 0.68, 1.13].entries()) {
      add("box", 0.31, height, 0.39, (index - 1) * 0.42, 0.16 + height / 2, 0, ["#81a8a2", "#629190", "#4f7e86"][index]);
    }
  } else if (role === "transport") {
    add("box", 1.54, 0.58, 0.82, 0, 0.65, 0, "#557d86");
    add("box", 0.53, 0.42, 0.81, -0.92, 0.56, 0, "#91b8c1");
    for (const x of [-0.79, 0.48]) {
      const axle = add("cylinder", 0.40, 0.92, 0.40, x, 0.23, 0, "#4b606a");
      axle.setLocalEulerAngles(90, 0, 0);
    }
  } else if (role === "initial" || role === "event") {
    add("sphere", 0.75, 0.75, 0.75, 0, 0.37, 0, "#538875");
  } else if (role === "terminal") {
    add("cylinder", 1.2, 0.17, 1.2, 0, 0.08, 0, "#5c7183");
    add("cylinder", 0.12, 1.54, 0.12, -0.34, 0.79, 0, "#5c7183");
    add("box", 0.96, 0.57, 0.14, 0.12, 1.19, 0, "#82a3b2");
  }
  return parts;
}

export function renderIconGlyph(parent: pc.Entity, icon: string, unit: number, part: Part, material: Material): pc.Entity[] {
  return roleGlyph(parent, roleForIcon[icon] ?? "service", unit, part, material);
}

/** Warm studio shell shared by all diagram stages. */
type StudioFloor = (tilesX: number, tilesZ: number) => pc.StandardMaterial;

function studio(root: pc.Entity, x: number, z: number, width: number, depth: number, backHeight: number,
  part: Part, material: Material, studioFloor?: StudioFloor): void {
  const back = z - depth / 2 - 2.2;
  // Extend the room past the graph's framing so fitting wide diagrams keeps the floor and wall in view.
  const shellWidth = width * 2.3 + 8;
  const front = z + depth / 2 + width;
  const shellDepth = front - back;
  const floorZ = (front + back) / 2;
  const wallHeight = Math.max(backHeight, width * 0.58);
  const tilesX = Math.min(30, Math.ceil(shellWidth / 2.4));
  const tilesZ = Math.min(24, Math.ceil(shellDepth / 2.4));
  part(root, "box", shellWidth, 0.3, shellDepth, x, -0.16, floorZ, studioFloor?.(tilesX, tilesZ) ?? material("#d5c6b1"));
  if (!studioFloor) {
    const tile = material("#c4b49e");
    for (let i = 1; i < tilesX; i++) part(root, "box", 0.020, 0.012, shellDepth, x - shellWidth / 2 + i * shellWidth / tilesX, 0.001, floorZ, tile);
    for (let i = 1; i < tilesZ; i++) part(root, "box", shellWidth, 0.012, 0.020, x, 0.001, back + i * shellDepth / tilesZ, tile);
  }
  const plaster = material("#d6c8b3");
  const glazing = material("#91b4bd", "#a9c7ca", 0.07);
  const frame = material("#52676d");
  part(root, "box", shellWidth, 1.35, 0.26, x, 0.675, back, plaster);
  part(root, "box", shellWidth, 0.16, 0.46, x, 1.40, back, plaster);
  part(root, "box", shellWidth, wallHeight - 1.35, 0.13, x, (wallHeight + 1.35) / 2, back, glazing);
  part(root, "box", shellWidth, 1.1, 0.07, x, 1.94, back + 0.065, material("#9ab6b7"));
  part(root, "box", shellWidth, 0.12, 0.27, x, 4.05, back, frame);
  const panes = Math.min(24, Math.ceil(shellWidth / 4.8));
  for (let i = 0; i <= panes; i++) {
    const frameX = x - shellWidth / 2 + i * shellWidth / panes;
    part(root, "box", 0.16, wallHeight - 1.35, 0.26, frameX, (wallHeight + 1.35) / 2, back, frame);
    if (i % 2 === 0) part(root, "box", 0.36, wallHeight, 0.54, frameX, wallHeight / 2, back - 0.02, plaster);
    else part(root, "box", 0.055, wallHeight - 1.52, 0.03, frameX - 0.12, (wallHeight + 1.35) / 2,
      back + 0.144, material("#a0b5b2", "#c4d5cc", 0.09));
  }
  const leaf = material("#56866c");
  for (const side of [-1, 1]) {
    const px = x + side * width * 0.36;
    part(root, "box", 0.85, 0.58, 0.75, px, 0.29, back + 0.85, plaster);
    for (const tilt of [-34, 6, 38]) {
      const foliage = part(root, "sphere", 0.40, 1.04, 0.19, px + tilt * 0.008, 1.1, back + 0.87, leaf);
      foliage.setLocalEulerAngles(13, 0, -tilt);
    }
  }
}

export function renderSpatialGraph(
  root: pc.Entity,
  nodes: SpatialNode[],
  edges: SpatialEdge[],
  part: Part,
  material: Material,
  mountIcon: (parent: pc.Entity, icon: string, height: number, fallback: pc.Entity[]) => void,
  diagramKind?: SpaceDiagram["kind"],
  device?: pc.GraphicsDevice,
  addShadow?: ContactShadow,
  studioFloor?: StudioFloor
): SpatialView {
  const minX = Math.min(0, ...nodes.map((node) => node.x - node.width / 2));
  const maxX = Math.max(0, ...nodes.map((node) => node.x + node.width / 2));
  const minZ = Math.min(0, ...nodes.map((node) => node.z - node.depth / 2));
  const maxZ = Math.max(0, ...nodes.map((node) => node.z + node.depth / 2));
  const x = (minX + maxX) / 2;
  const z = (minZ + maxZ) / 2;
  const width = Math.max(16, maxX - minX + 5);
  const depth = Math.max(10, maxZ - minZ + 6);
  studio(root, x, z, width, depth, 4.6, part, material, studioFloor);
  const slab = beveledSlabs(part, device);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const groups = new Map<string, SpatialNode[]>();
  for (const node of nodes) {
    if (!node.group) continue;
    const members = groups.get(node.group) ?? [];
    members.push(node);
    groups.set(node.group, members);
  }
  const groupLabels = [...groups].map(([label, members], index) => {
    const x0 = Math.min(...members.map((node) => node.x - node.width / 2)) - 0.55;
    const x1 = Math.max(...members.map((node) => node.x + node.width / 2)) + 0.55;
    const z0 = Math.min(...members.map((node) => node.z - node.depth / 2)) - 0.7;
    const z1 = Math.max(...members.map((node) => node.z + node.depth / 2)) + 0.5;
    const rail = material(["#84998d", "#ad9274", "#909cab"][index % 3]);
    part(root, "box", x1 - x0, 0.09, z1 - z0, (x0 + x1) / 2, 0.052, (z0 + z1) / 2, material(["#ccd8cb", "#e0d4bf", "#d0d9dd"][index % 3]));
    for (const z of [z0, z1]) part(root, "box", x1 - x0, 0.05, 0.08, (x0 + x1) / 2, 0.096, z, rail);
    for (const x of [x0, x1]) part(root, "box", 0.08, 0.05, z1 - z0, x, 0.096, (z0 + z1) / 2, rail);
    return { label, x: (x0 + x1) / 2, z: z0 - 0.4 };
  });
  const nodeShapes = new Map<string, { face: pc.Entity; foot: pc.Entity; normal: pc.StandardMaterial }>();
  const idle = material("#deceb7");
  const active = material("#77cabb", "#59dbc7", 0.12);
  const passed = material("#abc7bb");
  const footMaterial = material("#706b64");
  const activeFoot = material("#2a7067", "#50d2bc", 0.26);
  const decision = material("#dbb677");
  const terminal = material("#b1c6cd");
  const initial = material("#c2d2bd");
  const storage = material("#bccfd3");
  const contactMaterial = material("#a79781");
  const mount = material("#918b7f");
  for (const node of nodes) {
    const role = nodeRole(node);
    const normal = role === "decision" ? decision : role === "initial" ? initial : role === "terminal" ? terminal :
      role === "store" || role === "queue" ? storage : idle;
    const tile = new pc.Entity("diagram-node");
    tile.setLocalPosition(node.x, 0, node.z);
    root.addChild(tile);
    const onGroup = node.group !== undefined && groups.has(node.group);
    const baseY = onGroup ? 0.103 : 0.002;
    if (addShadow) addShadow(tile, 0.21, 0.18, node.width * 1.48, node.depth * 1.83, baseY + 0.004);
    else slab(tile, node.width * 1.075, 0.024, node.depth * 1.12, 0.035, baseY + 0.012, 0.05, contactMaterial);
    const foot = slab(tile, node.width * 1.055, 0.29, node.depth * 1.08, 0, baseY + 0.151, 0, footMaterial);
    const face = slab(tile, node.width, 0.82, node.depth, 0, baseY + 0.66, 0, normal);
    node.visualHeight = baseY + 1.07;
    if (diagramKind !== "erd" && (role || node.icon)) {
      const marker = new pc.Entity("diagram-role");
      const span = Math.min(1.22, node.depth * 0.86, node.width * 0.73);
      const glyphScale = Math.min(0.53, node.depth * 0.37, node.width * 0.23);
      slab(tile, Math.min(node.width * 0.72, span * 1.31), 0.065, span * 0.98, 0, baseY + 1.083, -0.04, mount);
      const markerY = baseY + 1.116;
      marker.setLocalPosition(0, markerY, -0.04);
      tile.addChild(marker);
      const glyph = role === "terminal" && node.icon === "warning" ? "warning" : role;
      const marks = roleGlyph(marker, glyph ?? "service", glyphScale, part, material);
      if (node.icon) mountIcon(marker, node.icon, span, marks);
      node.visualHeight = markerY + Math.max(node.icon ? span : 0, glyphScale * 1.75);
    }
    nodeShapes.set(node.id, { face, foot, normal });
  }

  const normalEdge = material("#3a4f59");
  const mutedEdge = material("#758585");
  const asyncEdge = material("#6d668f");
  const returnEdge = material("#6e7e89");
  const highlightedEdge = material("#087d70", "#51efce", 0.46);
  const passedEdge = material("#62a99e");
  const edgeMaterial = (edge: SpatialEdge): pc.StandardMaterial =>
    edge.kind === "async" ? asyncEdge : edge.kind === "return" || edge.kind === "dashed" ? returnEdge : normalEdge;
  const edgeY = 0.49;
  const parallel = new Map<string, number>();
  const pairs = new Set(edges.map(({ from, to }) => `${from}\u0000${to}`));
  const linkShapes: SpatialLink[] = edges.flatMap((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return [];
    const pair = `${edge.from}\u0000${edge.to}`;
    const index = parallel.get(pair) ?? 0;
    parallel.set(pair, index + 1);
    const reverse = from.id !== to.id && pairs.has(`${edge.to}\u0000${edge.from}`);
    const lane = from.id === to.id ? index * 0.38 :
      reverse ? (from.id < to.id ? 1 : -1) * (0.52 + index * 0.32) :
        Math.ceil(index / 2) * (index % 2 === 1 ? 0.38 : -0.38);
    const path = connector(from, to, lane).filter((point, i, all) => i === 0 || Math.hypot(point.x - all[i - 1].x, point.z - all[i - 1].z) > 0.01);
    const points = (diagramKind === "state" || !diagramKind ? softCorners(path) : path)
      .map((point) => ({ ...point, y: edgeY }));
    if (points.length < 2) return [];
    const base = edgeMaterial(edge);
    const pieces: pc.Entity[] = [];
    for (const [i, end] of points.slice(1).entries()) {
      const start = points[i];
      const length = Math.hypot(end.x - start.x, end.z - start.z);
      const piecesCount = edge.kind === "dashed" || edge.kind === "async" || edge.kind === "return" ? Math.min(12, Math.ceil(length / 0.45)) : 1;
      for (let j = 0; j < piecesCount; j++) {
        const f = (j + 0.5) / piecesCount;
        const line = part(root, "box", 0.22, 0.12, length / piecesCount * (piecesCount > 1 ? 0.66 : 1),
          start.x + (end.x - start.x) * f, edgeY, start.z + (end.z - start.z) * f, base);
        line.setLocalEulerAngles(0, Math.atan2(end.x - start.x, end.z - start.z) * 180 / Math.PI, 0);
        pieces.push(line);
      }
    }
    if (diagramKind !== "erd") {
      const start = points.at(-2)!;
      const end = points.at(-1)!;
      const yaw = Math.atan2(end.x - start.x, end.z - start.z);
      const tip = part(root, "cone", 0.53, 0.61, 0.53,
        end.x - Math.sin(yaw) * 0.26, edgeY, end.z - Math.cos(yaw) * 0.26, base);
      tip.setLocalEulerAngles(90, yaw * 180 / Math.PI, 0);
      pieces.push(tip);
    }
    return [{ edge, points, pieces, label: along(points, 0.47) }];
  });
  const sourcePort = part(root, "cylinder", 0.43, 0.16, 0.43, 0, edgeY, 0, highlightedEdge);
  const pulse = part(root, "sphere", 0.29, 0.29, 0.29, 0, edgeY + 0.07, 0, material("#dbfffb", "#94ffed", 1.3));
  sourcePort.enabled = false;
  pulse.enabled = false;
  return {
    x, z, width, depth, groupLabels, linkShapes,
    paint(selectedNode, selectedEdge, visitedNodes, visitedEdges): void {
      const selectedLink = selectedEdge === undefined ? undefined : linkShapes.find(({ edge }) => edge.id === selectedEdge);
      sourcePort.enabled = selectedLink !== undefined;
      if (selectedLink) {
        const port = along(selectedLink.points, 0.025);
        sourcePort.setLocalPosition(port.x, edgeY, port.z);
      }
      for (const node of nodes) {
        const endpoint = selectedLink?.edge.from === node.id || selectedLink?.edge.to === node.id;
        const selected = node.id === selectedNode || selectedNode === undefined && endpoint;
        const { face, foot, normal } = nodeShapes.get(node.id)!;
        face.render!.meshInstances[0].material = selected ? active : visitedNodes?.has(node.id) ? passed : normal;
        foot.render!.meshInstances[0].material = selected || endpoint ? activeFoot : footMaterial;
      }
      for (const link of linkShapes) {
        const selected = link.edge.id === selectedEdge;
        const paint = selected ? highlightedEdge : visitedEdges?.has(link.edge.id) ? passedEdge :
          visitedEdges ? mutedEdge : edgeMaterial(link.edge);
        for (let index = 0; index < link.pieces.length; index++) {
          const piece = link.pieces[index];
          piece.render!.material = paint;
          const scale = piece.getLocalScale();
          if (diagramKind !== "erd" && index === link.pieces.length - 1) {
            const diameter = selected ? 0.70 : 0.53;
            piece.setLocalScale(diameter, scale.y, diameter);
          } else {
            piece.setLocalScale(selected ? 0.32 : 0.22, selected ? 0.15 : 0.12, scale.z);
          }
        }
      }
    },
    pulse(edgeId: string | undefined, t: number): void {
      const link = edgeId === undefined ? undefined : linkShapes.find((link) => link.edge.id === edgeId);
      pulse.enabled = Boolean(link);
      if (!link) return;
      const point = along(link.points, t);
      pulse.setLocalPosition(point.x, edgeY + 0.07, point.z);
    }
  };
}

export function spatialSequence(diagram: SpaceDiagram): { nodes: SpatialNode[]; edges: SpatialEdge[] } {
  const gap = 4.8;
  return {
    nodes: diagram.nodes.map((node, i) => ({
      id: node.id, label: node.label, source: node.source ?? diagram.source, icon: node.icon, kind: node.hint,
      x: (i - (diagram.nodes.length - 1) / 2) * gap, z: 0, width: 3.1, depth: 0.58
    })),
    edges: diagram.edges.map((edge, i) => {
      const label = edge.label ?? (edge.kind === "return" ? "Return" : edge.kind === "async" ? "Async dispatch" : "Call");
      const ordinal = /^\d{1,3}[a-z]?[.)]\s+/i.test(label) ? "" : `${i + 1}. `;
      return {
        id: edge.id ?? String(i), from: edge.from, to: edge.to,
        label: `${ordinal}${label}${edge.guard ? ` · ${edge.guard}` : ""}`,
        detail: edge.guard, kind: edge.kind, source: edge.source ?? diagram.source
      };
    })
  };
}

/** A real vertical sequence with participant poles and one horizontal lane per message. */
export function renderSpatialSequence(
  root: pc.Entity, nodes: SpatialNode[], edges: SpatialEdge[], part: Part, material: Material,
  device?: pc.GraphicsDevice, addShadow?: ContactShadow, studioFloor?: StudioFloor
): SpatialView {
  const width = Math.max(13, (nodes.at(-1)?.x ?? 0) - (nodes[0]?.x ?? 0) + 4.5);
  const height = Math.max(5.2, edges.length * 0.83 + 2.5);
  const depth = 9;
  studio(root, 0, 1.5, width, depth, height + 1.3, part, material, studioFloor);
  const slab = beveledSlabs(part, device);
  const post = material("#50646b");
  const card = material("#e6d9c7");
  const plateEdge = material("#827f75");
  const active = material("#6cc5b3", "#87dcca", 0.25);
  const activeLine = material("#198b7c", "#65ebd4", 0.45);
  const call = material("#2f4b55");
  const response = material("#687a87");
  const asynchronous = material("#72658f");
  const actors = new Map<string, { plate: pc.Entity; trim: pc.Entity }>();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    node.y = height - 0.75;
    if (addShadow) addShadow(root, node.x + 0.13, 0.12, 1.72, 1.48, 0.009);
    else slab(root, 0.98, 0.04, 0.82, node.x + 0.05, 0.022, 0.08, plateEdge);
    slab(root, 0.93, 0.27, 0.80, node.x, 0.148, 0, card);
    part(root, "cylinder", 0.14, height - 0.84, 0.14, node.x, (height - 0.58) / 2, 0, post);
    const trim = slab(root, node.width * 1.025, 0.74, 0.35, node.x, node.y, -0.18, plateEdge);
    const plate = slab(root, node.width, 0.66, node.depth, node.x, node.y, 0.07, card);
    const role = nodeRole(node);
    if (role) {
      const marker = new pc.Entity("sequence-role");
      marker.setLocalPosition(node.x - node.width * 0.31, node.y - 0.22, 0.36);
      root.addChild(marker);
      roleGlyph(marker, role, 0.27, part, material);
    }
    actors.set(node.id, { plate, trim });
  }
  const edgeMaterial = (edge: SpatialEdge): pc.StandardMaterial =>
    edge.kind === "async" ? asynchronous : edge.kind === "return" || edge.kind === "dashed" ? response : call;
  const links: SpatialLink[] = edges.flatMap((edge, i) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return [];
    const y = height - 1.63 - i * 0.83;
    const base = edgeMaterial(edge);
    const self = from.id === to.id;
    const fromX = from.x;
    const toX = self ? from.x + 0.95 : to.x;
    const sign = Math.sign(toX - fromX) || 1;
    const length = Math.abs(toX - fromX);
    const dashed = edge.kind === "return" || edge.kind === "dashed" || edge.kind === "async";
    const segments = dashed ? Math.min(16, Math.ceil(length / (edge.kind === "async" ? 0.34 : 0.57))) : 1;
    const pieces: pc.Entity[] = [];
    for (let j = 0; j < segments; j++) {
      const x = fromX + (toX - fromX) * (j + 0.5) / segments;
      pieces.push(part(root, "box", length / segments * (dashed ? 0.68 : 1), 0.086, 0.115, x, y, 0.14, base));
    }
    if (self) {
      pieces.push(part(root, "box", 0.086, 0.30, 0.115, toX, y - 0.15, 0.14, base));
      pieces.push(part(root, "box", length, 0.086, 0.115, (fromX + toX) / 2, y - 0.30, 0.14, base));
    }
    const end = self ? { x: fromX, y: y - 0.3, z: 0.14 } : { x: toX, y, z: 0.14 };
    const facing = self ? -1 : sign;
    const tip = part(root, "cone", 0.33, 0.38, 0.33, end.x - 0.16 * facing, end.y, end.z, base);
    tip.setLocalEulerAngles(0, 0, -90 * facing);
    pieces.push(tip);
    const points = [{ x: fromX, y, z: 0.14 }, { x: toX, y, z: 0.14 }];
    if (self) points.push({ x: toX, y: y - 0.30, z: 0.14 }, end);
    return [{ edge, points, pieces, label: { x: (fromX + toX) / 2, y: y + 0.11, z: 0.25 } }];
  });
  const marker = part(root, "sphere", 0.22, 0.22, 0.22, 0, 0, 0, material("#d6fff3", "#a1ffe7", 1.1));
  marker.enabled = false;
  return {
    x: 0, z: 0, width, depth, height, groupLabels: [], linkShapes: links,
    paint(nodeId, edgeId, visitedNodes, visitedEdges) {
      const selected = links.find(({ edge }) => edge.id === edgeId)?.edge;
      for (const [id, { plate, trim }] of actors) {
        plate.render!.meshInstances[0].material = id === nodeId || visitedNodes?.has(id) ? active : card;
        trim.render!.meshInstances[0].material = id === selected?.from || id === selected?.to ? activeLine : plateEdge;
      }
      for (const link of links) for (const piece of link.pieces) {
        piece.render!.material = edgeId === link.edge.id ? activeLine : visitedEdges?.has(link.edge.id) ? call : edgeMaterial(link.edge);
      }
    },
    pulse(edgeId, t) {
      const link = links.find((candidate) => candidate.edge.id === edgeId);
      marker.enabled = Boolean(link);
      if (!link) return;
      const point = along(link.points, t);
      marker.setLocalPosition(point.x, point.y ?? 0, point.z + 0.04);
    }
  };
}
