import type { TSpaceDocument, CityLayout, LBuilding, LPoint, LRoad, LRoute } from "@kodyurd/scene-schema";

/**
 * Deterministic city layouter (P3).
 *
 * Plan: one main avenue along +X from the gate; districts sit as blocks on
 * alternating sides of the avenue, in document order (P1 orders them by
 * meaning). Buildings fill their district in a grid, biggest first. The plaza
 * (master diagram + fountain) sits across the avenue from the first district.
 * Flow routes travel the avenue and the district spurs, so traffic is visible
 * where the walker walks.
 */

const AVENUE_W = 8;
const SPUR_W = 5;
const DISTRICT_GAP = 14;

function footprint(b: TSpaceDocument["city"]["buildings"][number]): { w: number; d: number; h: number } {
  const files = b.metrics.files || 1;
  const loc = b.metrics.loc || files * 40;
  const base = Math.max(8, Math.min(20, 6 + Math.sqrt(files) * 1.2));
  const h =
    b.archetype === "landmark"
      ? 24
      : b.archetype === "tower"
        ? Math.max(16, Math.min(30, 8 + Math.log2(loc + 1) * 1.6))
        : b.archetype === "slab"
          ? Math.max(10, Math.min(16, 6 + Math.log2(loc + 1)))
          : b.archetype === "hall"
            ? 9
            : Math.max(5, Math.min(9, 4 + Math.log2(loc + 1) * 0.5));
  const w = b.archetype === "slab" || b.archetype === "hall" ? base * 1.6 : base;
  const d = b.archetype === "hall" ? base * 1.3 : base;
  return { w: round1(w), d: round1(d), h: round1(h) };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function usesCampusLayout(space: TSpaceDocument): boolean {
  return space.city.buildings.length <= 12 && space.city.districts.length <= 6 &&
    space.city.buildings.some((building) => building.id === space.presentation?.start?.building);
}

function layoutRoutes(space: TSpaceDocument, buildings: LBuilding[], gate: LPoint, corridorZ: number): LRoute[] {
  const byId = new Map(buildings.map((building) => [building.id, building]));
  const routes: LRoute[] = [];
  for (const flow of space.flows) {
    if (flow.scope !== "system") continue;
    const points: LPoint[] = [{ x: gate.x + 4, z: corridorZ }];
    const push = (point: LPoint): void => {
      const last = points.at(-1)!;
      if (last.x !== point.x || last.z !== point.z) points.push(point);
    };
    for (const step of flow.path) {
      const building = byId.get(step.ref);
      if (!building) continue;
      const { pos, size, doorDir } = building;
      push({ x: pos.x, z: corridorZ });
      push({ x: pos.x, z: pos.z + doorDir.z * (size.d / 2 + 1.5) });
      push({ x: pos.x, z: corridorZ });
    }
    if (points.length > 1) routes.push({ flowId: flow.id, points, routeNumber: routes.length + 1 });
  }
  return routes;
}

function layoutCampus(space: TSpaceDocument, focus: TSpaceDocument["city"]["buildings"][number]): CityLayout {
  const buildings: LBuilding[] = [];
  const districts: CityLayout["districts"] = [];
  const props: CityLayout["props"] = [];
  const gap = 4.2;
  const groups = space.city.districts.map((district) => ({
    id: district.id,
    members: space.city.buildings.filter((building) => building.district === district.id).sort((a, b) =>
      Number(b.id === focus.id) - Number(a.id === focus.id) || b.metrics.files - a.metrics.files)
  })).filter((group) => group.members.length).sort((a, b) => Number(b.id === focus.district) - Number(a.id === focus.district));

  const buildWing = (group: typeof groups[number], anchorX: number, side: -1 | 0 | 1, south: boolean): void => {
    const cells = group.members.map((building) => {
      const size = footprint(building);
      const primary = building.id === focus.id;
      return { id: building.id, size: {
        w: round1(primary ? Math.max(15.5, Math.min(19, size.w)) : Math.max(9.5, Math.min(13.5, size.w))),
        d: round1(primary ? Math.max(10.8, Math.min(14, size.d)) : Math.max(8.4, Math.min(12, size.d))),
        h: round1(primary ? Math.max(10.8, Math.min(13.5, size.h)) : Math.max(6.2, Math.min(10.2, size.h)))
      } };
    });
    const cols = Math.min(3, cells.length);
    const cellW = Math.max(...cells.map(({ size }) => size.w)) + gap;
    const cellD = Math.max(...cells.map(({ size }) => size.d)) + gap;
    const width = cols * cellW;
    const facing = south ? -1 : 1;
    const front = south ? 26 : 0;
    const x = side === -1 ? anchorX - width : side === 1 ? anchorX : anchorX - width / 2;
    const columnOrder = cols === 3 ? [1, 0, 2] : cols === 2 && side === -1 ? [1, 0] : [0, 1];
    const wingBuildings = cells.map((cell, i) => {
      const col = columnOrder[i % cols];
      const row = Math.floor(i / cols);
      return {
        ...cell,
        pos: { x: round1(x + (col + 0.5) * cellW), z: round1(front - facing * (row * cellD + cell.size.d / 2)) },
        rot: 0,
        doorDir: { x: 0, z: facing }
      };
    });
    const minX = Math.min(...wingBuildings.map((building) => building.pos.x - building.size.w / 2)) - 1.65;
    const maxX = Math.max(...wingBuildings.map((building) => building.pos.x + building.size.w / 2)) + 1.65;
    const minZ = Math.min(...wingBuildings.map((building) => building.pos.z - building.size.d / 2)) - 1.65;
    const maxZ = Math.max(...wingBuildings.map((building) => building.pos.z + building.size.d / 2)) + 1.65;
    districts.push({ id: group.id, rect: { x: minX, z: minZ, w: maxX - minX, d: maxZ - minZ }, markerPos: { x: minX + 0.75, z: front + facing * 2 } });
    buildings.push(...wingBuildings);
  };

  buildWing(groups[0], 0, 0, false);
  const core = districts[0].rect;
  if (groups[1]) buildWing(groups[1], core.x - gap, -1, false);
  if (groups[3]) buildWing(groups[3], core.x + core.w + gap, 1, false);
  if (groups[2]) {
    buildWing(groups[2], 0, 0, true);
    const south = districts.at(-1)!.rect;
    if (groups[4]) buildWing(groups[4], south.x - gap, -1, true);
    if (groups[5]) buildWing(groups[5], south.x + south.w + gap, 1, true);
  }

  const anchor = buildings.find(({ id }) => id === focus.id)!;
  const minX = Math.min(...districts.map(({ rect }) => rect.x), anchor.pos.x - 17) - 3.4;
  const maxX = Math.max(...districts.map(({ rect }) => rect.x + rect.w), anchor.pos.x + 17) + 3.4;
  const campus = { x: minX, z: -1.7, w: maxX - minX, d: 29.4 };
  const gate = { pos: { x: minX + 2.2, z: 13 }, rot: Math.PI / 2 };
  const plaza = { pos: { x: anchor.pos.x + 4.7, z: 20.2 }, radius: 3.4 };
  const roads: LRoad[] = [{ points: [{ x: minX + 1, z: 13 }, { x: maxX - 1, z: 13 }], width: 6 }];
  for (const building of buildings) {
    const { pos, size, doorDir } = building;
    const front = pos.z + doorDir.z * size.d / 2;
    if (front < -0.2 || front > 26.2) continue;
    const side = pos.x <= anchor.pos.x ? -1 : 1;
    const x = round1(pos.x + side * Math.max(3.5, size.w / 2 - 0.6));
    props.push({ role: "tree-round", pos: { x, z: front + doorDir.z * 4.5 }, rot: 0 });
    props.push({ role: "bench", pos: { x: x - side * 1.7, z: front + doorDir.z * 6 }, rot: Math.PI / 2 });
    props.push({ role: "street-lamp", pos: { x: x + side * 1.6, z: front + doorDir.z * 2.4 }, rot: 0 });
  }
  const minZ = Math.min(...districts.map(({ rect }) => rect.z), campus.z) - 4;
  const maxZ = Math.max(...districts.map(({ rect }) => rect.z + rect.d), campus.z + campus.d) + 4;
  const bounds = { x: minX - 2.6, z: minZ, w: campus.w + 5.2, d: maxZ - minZ };
  return { campus, bounds, gate, plaza, districts, buildings, roads, props, routes: layoutRoutes(space, buildings, gate.pos, 13) };
}

export function layoutCity(space: TSpaceDocument): CityLayout {
  const buildingsByDistrict = new Map<string, TSpaceDocument["city"]["buildings"]>();
  const focus = space.city.buildings.find((building) => building.id === space.presentation?.start?.building);
  if (focus && usesCampusLayout(space)) return layoutCampus(space, focus);
  for (const b of space.city.buildings) {
    const list = buildingsByDistrict.get(b.district) ?? [];
    list.push(b);
    buildingsByDistrict.set(b.district, list);
  }

  const gate = { pos: { x: -24, z: 0 }, rot: Math.PI / 2 };
  const buildings: LBuilding[] = [];
  const districts: CityLayout["districts"] = [];
  const roads: LRoad[] = [];
  const props: CityLayout["props"] = [];

  let cursorX = 0;
  let maxSide = 0;

  const districtsByFocus = focus
    ? [...space.city.districts].sort((a, b) => Number(b.id === focus.district) - Number(a.id === focus.district))
    : space.city.districts;
  districtsByFocus.forEach((district, di) => {
    const members = (buildingsByDistrict.get(district.id) ?? [])
      .map((b) => ({ b, fp: footprint(b) }))
      .sort((a, b) =>
        Number(b.b.id === focus?.id) - Number(a.b.id === focus?.id) || b.fp.w * b.fp.d - a.fp.w * a.fp.d
      );
    const side = di % 2 === 0 ? 1 : -1; // alternate above/below the avenue

    const cols = Math.max(1, Math.ceil(Math.sqrt(members.length || 1)));
    const cellW = Math.max(...members.map((m) => m.fp.w), 10) + 8;
    const cellD = Math.max(...members.map((m) => m.fp.d), 10) + 8;
    const rows = Math.max(1, Math.ceil((members.length || 1) / cols));
    const rectW = cols * cellW + 6;
    const rectD = rows * cellD + 10;
    const rect = {
      x: cursorX,
      z: side > 0 ? AVENUE_W / 2 + 6 : -(AVENUE_W / 2 + 6) - rectD,
      w: rectW,
      d: rectD
    };
    districts.push({
      id: district.id,
      rect,
      markerPos: { x: rect.x + 3, z: side > 0 ? rect.z - 3 : rect.z + rect.d + 3 }
    });

    members.forEach((m, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = rect.x + 4 + col * cellW + cellW / 2;
      const cz =
        side > 0
          ? rect.z + 5 + row * cellD + cellD / 2
          : rect.z + rect.d - 5 - row * cellD - cellD / 2;
      buildings.push({
        id: m.b.id,
        pos: { x: round1(cx), z: round1(cz) },
        size: m.fp,
        rot: 0,
        doorDir: { x: 0, z: side > 0 ? -1 : 1 } // doors face the avenue
      });
    });

    // Spur road from the avenue into the district.
    const spurX = rect.x + rectW / 2;
    roads.push({
      points: [
        { x: spurX, z: 0 },
        { x: spurX, z: side > 0 ? rect.z + rectD / 2 : rect.z + rectD / 2 }
      ],
      width: SPUR_W
    });

    cursorX += rectW + DISTRICT_GAP;
    maxSide = Math.max(maxSide, rectD + AVENUE_W / 2 + 6);
  });

  const endX = Math.max(cursorX - DISTRICT_GAP + 10, 40);
  roads.unshift({ points: [{ x: gate.pos.x, z: 0 }, { x: endX, z: 0 }], width: AVENUE_W });

  const plaza = { pos: { x: Math.min(26, endX / 3), z: 0 }, radius: 7 };

  // Street props along the avenue — deterministic rhythm, no randomness.
  for (let x = -16; x <= endX - 6; x += 12) {
    props.push({ role: "street-lamp", pos: { x, z: AVENUE_W / 2 + 1.2 }, rot: 0 });
    props.push({ role: "street-lamp", pos: { x: x + 6, z: -(AVENUE_W / 2 + 1.2) }, rot: Math.PI });
    if (x % 24 === 8) {
      props.push({ role: "tree-round", pos: { x, z: -(AVENUE_W / 2 + 3) }, rot: 0 });
      props.push({ role: "bench", pos: { x: x + 2, z: AVENUE_W / 2 + 2 }, rot: Math.PI });
    }
  }
  props.push({ role: "plaza-fountain", pos: plaza.pos, rot: 0 });
  props.push({ role: "signpost", pos: { x: gate.pos.x + 6, z: AVENUE_W / 2 + 1 }, rot: 0 });

  const bounds = {
    x: gate.pos.x - 8,
    z: -maxSide - 4,
    w: endX - gate.pos.x + 20,
    d: maxSide * 2 + 8
  };

  return { bounds, gate, plaza, districts, buildings, roads, routes: layoutRoutes(space, buildings, gate.pos, 0), props };
}
