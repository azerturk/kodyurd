import type { CityRelationship } from "./city-relations";
import type { WalkPoint, WalkSolid } from "./walk-path";

interface Footprint {
  id: string;
  pos: WalkPoint;
  size: { w: number; d: number };
}

/** The map opens as an architectural view. Request a neighborhood or one exact link. */
export function visibleOverviewLinks<T extends Pick<CityRelationship, "id" | "from" | "to">>(
  links: readonly T[], buildingId?: string, linkId?: string
): T[] {
  if (linkId) return links.filter((link) => link.id === linkId);
  return buildingId ? links.filter((link) => link.from === buildingId || link.to === buildingId).slice(0, 8) : [];
}

function ports(building: Footprint, toward: WalkPoint, lane: number): WalkPoint[] {
  const dx = toward.x - building.pos.x;
  const dz = toward.z - building.pos.z;
  const directions = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]
    .sort((a, b) => (b.x - a.x) * dx + (b.z - a.z) * dz);
  return directions.map((dir) => {
    const side = dir.x ? building.size.w / 2 : building.size.d / 2;
    const along = Math.min(dir.x ? building.size.d * 0.24 : building.size.w * 0.24, Math.abs(lane)) * Math.sign(lane);
    return {
      x: building.pos.x + dir.x * (side + 0.62) - dir.z * along,
      z: building.pos.z + dir.z * (side + 0.62) + dir.x * along
    };
  });
}

/** Route a visual connector just outside the shell and around intervening footprints. */
export function overviewLinkRoute(from: Footprint, to: Footprint, solids: readonly WalkSolid[],
  walk: (start: WalkPoint, end: WalkPoint, solids: readonly WalkSolid[]) => WalkPoint[] | null, lane = 0
): WalkPoint[] | null {
  const starts = ports(from, to.pos, lane);
  const ends = ports(to, from.pos, -lane);
  // A blocked preferred port may try an adjacent face without drawing through a building.
  for (const [start, end] of [[0, 0], [1, 0], [0, 1], [2, 0], [0, 2], [1, 1]]) {
    const startPoint = starts[start];
    const endPoint = ends[end];
    if (Math.hypot(startPoint.x - endPoint.x, startPoint.z - endPoint.z) < 0.42) continue;
    const route = walk(startPoint, endPoint, solids);
    if (route) return [startPoint, ...route];
  }
  return null;
}
