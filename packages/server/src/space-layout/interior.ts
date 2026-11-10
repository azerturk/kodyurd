import type { TSpaceDocument, InteriorLayout, LCorridor, LFloor, LPoint, LStation } from "@kodyurd/scene-schema";

/**
 * Deterministic interior layouter (P3).
 *
 * The interior is its own little coordinate space per building (the engine
 * mounts it on an interior layer). Lobby template sized by content; floors as
 * open rooms with pedestal grids and wall panels; corridors as straight walks
 * with one station per flow step, forks branching off at 35°, and a
 * checkpoint gate standing BEFORE the fork it tests (V5).
 */

type InteriorT = TSpaceDocument["interiors"][number];
type FlowT = TSpaceDocument["flows"][number];

const STATION_GAP = 6;

function corridorFor(flow: FlowT): LCorridor {
  const stations: LStation[] = flow.path.map((p, i) => ({
    pos: { x: 0, z: i * STATION_GAP },
    stepIndex: i,
    caption: p.caption
  }));
  const segments = [{ from: { x: 0, z: -STATION_GAP }, to: { x: 0, z: (flow.path.length - 0.5) * STATION_GAP } }];
  const forks: LCorridor["forks"] = [];
  const gates: LCorridor["gates"] = [];
  const branchesAt = new Map<number, number>();
  (flow.branches ?? []).forEach((br) => {
    const namedFork = br.from ? flow.path.findIndex((step) => step.id === br.from) : -1;
    const at = namedFork >= 0 ? namedFork : Math.min(br.at, flow.path.length - 1);
    const sibling = branchesAt.get(at) ?? 0;
    branchesAt.set(at, sibling + 1);
    const side = sibling % 2 === 0 ? 1 : -1;
    const angle = ((28 + Math.floor(sibling / 2) * 16) * Math.PI) / 180;
    const start: LPoint = { x: 0, z: at * STATION_GAP };
    const dirX = Math.sin(angle) * side;
    const dirZ = Math.cos(angle);
    if (sibling === 0) {
      gates.push({ pos: { x: 0, z: at * STATION_GAP - STATION_GAP / 2 }, beforeForkIndex: forks.length });
    }
    forks.push({ pos: { x: dirX * 4, z: start.z + dirZ * 4 }, condition: br.condition });
    let prev = start;
    br.path.forEach((p, j) => {
      const pos: LPoint = {
        x: start.x + dirX * STATION_GAP * (j + 1),
        z: start.z + dirZ * STATION_GAP * (j + 1)
      };
      segments.push({ from: prev, to: pos });
      stations.push({ pos, stepIndex: at + j + 1, caption: p.caption, branch: br.condition });
      prev = pos;
    });
    const join = br.join ? flow.path.findIndex((step) => step.id === br.join) : -1;
    if (join >= 0 && br.path.length) {
      const next = stations[join].pos;
      const lane = prev.x + side * STATION_GAP * 0.7;
      const rejoin = [prev, { x: lane, z: prev.z }, { x: lane, z: next.z }, next];
      for (let i = 1; i < rejoin.length; i++) {
        const from = rejoin[i - 1];
        const to = rejoin[i];
        if (from.x !== to.x || from.z !== to.z) segments.push({ from, to });
      }
    }
  });
  return { flowId: flow.id, segments, stations, forks, gates };
}

function floorFor(
  floor: InteriorT["floors"][number],
  index: number
): LFloor {
  const n = floor.components.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(n, 1))));
  const rows = Math.max(1, Math.ceil(Math.max(n, 1) / cols));
  const pad = 4;
  const cell = 4;
  const w = Math.max(20, cols * cell + pad * 2 + 8);
  const d = Math.max(16, rows * cell + pad * 2 + 10, 10 + Math.ceil(floor.diagrams.length / 2) * 5.75);
  const rect = { x: -w / 2, z: 0, w, d };

  const pedestals = floor.components.map((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      label: c.label,
      icon: c.icon,
      pos: {
        x: -((cols - 1) * cell) / 2 + col * cell,
        z: pad + 4 + row * cell
      }
    };
  });

  // Panels on the side walls, alternating left/right.
  const panels = floor.diagrams.map((diagramId, i) => ({
    diagramId,
    pos: { x: (i % 2 === 0 ? -1 : 1) * (w / 2 - 0.4), z: pad + 4 + Math.floor(i / 2) * 6 },
    rot: i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2
  }));

  const infoStands = [{ pos: { x: 0, z: 2 }, rot: Math.PI }];

  // Corridor doors on the far wall.
  const corridorDoors = floor.corridors.map((flowId, i) => ({
    flowId,
    pos: { x: -((floor.corridors.length - 1) * 6) / 2 + i * 6, z: d - 0.5 }
  }));

  void index;
  return { id: floor.id, rect, pedestals, panels, infoStands, corridorDoors };
}

export function layoutInterior(interior: InteriorT, flows: FlowT[]): InteriorLayout {
  const catalogCount = Math.max(interior.lobby.catalogRefs.length, 1);
  const w = Math.max(24, Math.min(44, 18 + catalogCount * 2));
  const d = 20;
  const lobby = {
    rect: { x: -w / 2, z: 0, w, d },
    entry: { x: 0, z: 0.5 },
    reception: { x: -w * 0.22, z: 6 },
    centerpiece: interior.floors.length
      ? { x: w / 2 - 3.5, z: 3.6 }
      : { x: -3.5, z: d / 2 },
    catalogWall: { pos: { x: -w / 2 + 0.4, z: d / 2 }, rot: Math.PI / 2, width: Math.min(d - 4, 14) },
    coverageBoard: { pos: { x: w / 2 - 0.4, z: d / 2 }, rot: -Math.PI / 2 },
    elevator: { x: 0, z: d - 0.6 },
    plants: [
      { x: -w / 2 + 2, z: 2 },
      { x: w / 2 - 2, z: 2 }
    ],
    seating: [
      { x: -w / 2 + 3, z: d - 4 },
      { x: w / 2 - 3, z: d - 4 }
    ]
  };

  const floors = interior.floors.map((f, i) => floorFor(f, i));

  const flowById = new Map(flows.map((f) => [f.id, f]));
  const corridorIds = [...new Set(interior.floors.flatMap((f) => f.corridors))];
  const corridors = corridorIds
    .map((id) => flowById.get(id))
    .filter((f): f is FlowT => f !== undefined)
    .map((f) => corridorFor(f));

  return { building: interior.building, lobby, floors, corridors };
}
