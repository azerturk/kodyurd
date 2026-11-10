export interface WalkPoint { x: number; z: number }
export interface WalkSolid extends WalkPoint { halfW: number; halfD: number; height?: number; label?: string; active?: boolean }
interface CameraPoint extends WalkPoint { y: number }
type Surface = (x: number, z: number) => boolean;
export type WalkGait = "idle" | "walk" | "run" | "jump";
export const WALKER_RADIUS = 0.26;

interface WalkContact {
  fraction: number;
  nx: number;
  nz: number;
  solid: WalkSolid;
}

/** Rounded player footprint against the same solid bounds used for navigation. */
export function intersectsWalker(x: number, z: number, solid: WalkSolid, radius = WALKER_RADIUS): boolean {
  if (solid.active === false) return false;
  const dx = Math.max(0, Math.abs(x - solid.x) - solid.halfW);
  const dz = Math.max(0, Math.abs(z - solid.z) - solid.halfD);
  return dx * dx + dz * dz < radius * radius;
}

function sweepWalker(from: WalkPoint, dx: number, dz: number, solids: readonly WalkSolid[]): WalkContact | null {
  const r = WALKER_RADIUS;
  const a = dx * dx + dz * dz;
  if (a < 1e-12) return null;
  let nearest: WalkContact | null = null;
  for (const solid of solids) {
    if (solid.active === false) continue;
    const x = from.x - solid.x;
    const z = from.z - solid.z;
    const w = solid.halfW;
    const d = solid.halfD;
    if (Math.min(x, x + dx) > w + r || Math.max(x, x + dx) < -w - r ||
      Math.min(z, z + dz) > d + r || Math.max(z, z + dz) < -d - r) continue;

    const consider = (fraction: number, nx: number, nz: number): void => {
      if (fraction < -1e-8 || fraction > (nearest?.fraction ?? 1) || dx * nx + dz * nz >= -1e-8) return;
      nearest = { fraction: Math.max(0, fraction), nx, nz, solid };
    };
    if (Math.abs(dx) > 1e-8) {
      const side = -Math.sign(dx);
      const t = (side * (w + r) - x) / dx;
      if (Math.abs(z + t * dz) <= d) consider(t, side, 0);
    }
    if (Math.abs(dz) > 1e-8) {
      const side = -Math.sign(dz);
      const t = (side * (d + r) - z) / dz;
      if (Math.abs(x + t * dx) <= w) consider(t, 0, side);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const offsetX = x - sx * w;
      const offsetZ = z - sz * d;
      const b = offsetX * dx + offsetZ * dz;
      const c = offsetX * offsetX + offsetZ * offsetZ - r * r;
      const discriminant = b * b - a * c;
      if (discriminant < 0) continue;
      const t = (-b - Math.sqrt(discriminant)) / a;
      const hitX = offsetX + dx * t;
      const hitZ = offsetZ + dz * t;
      if (hitX * sx >= 0 && hitZ * sz >= 0) consider(t, hitX / r, hitZ / r);
    }
  }
  return nearest;
}

/** Fraction before the segment first leaves the connected room or passage. */
export function clearSurface(from: WalkPoint, to: WalkPoint, onSurface: Surface, stride = 0.15): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const samples = Math.max(1, Math.ceil(Math.hypot(dx, dz) / stride));
  for (let i = 1; i <= samples; i++) {
    let outside = i / samples;
    if (onSurface(from.x + outside * dx, from.z + outside * dz)) continue;
    let inside = (i - 1) / samples;
    for (let j = 0; j < 7; j++) {
      const mid = (inside + outside) / 2;
      if (onSurface(from.x + mid * dx, from.z + mid * dz)) inside = mid;
      else outside = mid;
    }
    return inside;
  }
  return 1;
}

export function walkMove(
  from: WalkPoint, move: WalkPoint, solids: readonly WalkSolid[], onSurface?: Surface
): { position: WalkPoint; contact: "wall" | "surface" | null; solid?: WalkSolid } {
  let position = from;
  let { x: dx, z: dz } = move;
  let contact: "wall" | "surface" | null = null;
  let solid: WalkSolid | undefined;
  for (let i = 0; i < 3 && dx * dx + dz * dz > 1e-10; i++) {
    const target = { x: position.x + dx, z: position.z + dz };
    const hit = sweepWalker(position, dx, dz, solids);
    const fraction = hit?.fraction ?? 1;
    const advance = hit ? Math.max(0, fraction - 0.0005 / Math.hypot(dx, dz)) : 1;
    const next = hit ? { x: position.x + advance * dx, z: position.z + advance * dz } : target;
    const floor = onSurface ? clearSurface(position, next, onSurface) : 1;
    position = { x: position.x + advance * dx * floor, z: position.z + advance * dz * floor };
    if (floor < 1) {
      contact = "surface";
      break;
    }
    if (!hit) break;
    contact = "wall";
    solid = hit.solid;
    const normalSpeed = dx * hit.nx + dz * hit.nz;
    dx = (dx - normalSpeed * hit.nx) * (1 - fraction);
    dz = (dz - normalSpeed * hit.nz) * (1 - fraction);
  }
  return { position, contact, solid };
}

/** Analytic easing keeps acceleration and travel equivalent across frame rates. */
export function advanceVelocity(current: number, desired: number, dt: number, response: number): { velocity: number; travel: number } {
  const blend = 1 - Math.exp(-response * dt);
  return { velocity: current + (desired - current) * blend, travel: desired * dt + (current - desired) * blend / response };
}

/** Classify the resolved movement, with hysteresis across contact and braking. */
export function walkGait(speed: number, previous: WalkGait, airborne: boolean): WalkGait {
  if (airborne) return "jump";
  if (speed > (previous === "run" ? 2.75 : 3.1)) return "run";
  return speed > (previous === "idle" ? 0.14 : 0.075) ? "walk" : "idle";
}

/** Match grounded clip travel to the distance actually covered during an app update. */
export function groundedClipRate(gait: Exclude<WalkGait, "jump">, displacement: number, appDt: number, scale: number): number {
  if (gait === "idle") return 1;
  if (appDt <= 0 || scale <= 0) return 0;
  const nominal = (gait === "run" ? 2.00 : 0.558) * scale;
  return Math.max(0, Math.min(2.65, displacement / appDt / nominal));
}

/** Look back at the entrance from an open place, with a shorter setback in a tight block. */
export function streetExitPoint(door: WalkPoint, outward: WalkPoint, available: Surface): WalkPoint | undefined {
  for (const distance of [7.2, 5.8, 4.5, 3.1]) {
    const point = { x: door.x + outward.x * distance, z: door.z + outward.z * distance };
    if (available(point.x, point.z)) return point;
  }
}

function hitsSolid(from: WalkPoint, to: WalkPoint, solid: WalkSolid, margin: number): boolean {
  if (solid.active === false) return false;
  let entry = 0;
  let exit = 1;
  for (const [start, end, middle, half] of [
    [from.x, to.x, solid.x, solid.halfW + margin],
    [from.z, to.z, solid.z, solid.halfD + margin]
  ]) {
    const delta = end - start;
    if (Math.abs(delta) < 1e-8) {
      if (Math.abs(start - middle) > half) return false;
      continue;
    }
    const low = (middle - half - start) / delta;
    const high = (middle + half - start) / delta;
    entry = Math.max(entry, Math.min(low, high));
    exit = Math.min(exit, Math.max(low, high));
    if (entry > exit) return false;
  }
  return true;
}

export const STREET_EXHIBIT_SIZE = { w: 2.64, d: 1.86 };

/** Imported display models use +Z as front, or +X when their broad face is along Z. */
export function streetExhibitYaw(worldWidth: number, worldDepth: number, site: WalkPoint, outward: WalkPoint, visitor: WalkPoint): number {
  const alongX = Math.abs(outward.x) > Math.abs(outward.z);
  const width = alongX ? worldDepth : worldWidth;
  const depth = alongX ? worldWidth : worldDepth;
  const dx = visitor.x - site.x;
  const dz = visitor.z - site.z;
  const forward = outward.x * dx + outward.z * dz;
  const across = outward.z * dx - outward.x * dz;
  const angle = forward > 0 ? Math.atan2(across, forward) * 180 / Math.PI : 0;
  return (depth > width * 1.15 ? 90 : 180) + Math.max(-18, Math.min(18, angle));
}

/** Reserve a grounded side site while protecting the open entrance route. */
export function streetExhibitSite(
  door: WalkPoint, outward: WalkPoint, facadeWidth: number, blockers: readonly WalkSolid[],
  approach: readonly WalkPoint[], onLot: (site: WalkSolid) => boolean
): WalkSolid | undefined {
  const { w, d } = STREET_EXHIBIT_SIZE;
  const halfW = (Math.abs(outward.z) * w + Math.abs(outward.x) * d) / 2;
  const halfD = (Math.abs(outward.x) * w + Math.abs(outward.z) * d) / 2;
  const side = Math.max(3.85, facadeWidth * 0.31);
  for (const distance of [3.05, 4.65, 6.3]) for (const lateral of [-side, side, -side - 1.8, side + 1.8]) {
    const site = {
      x: door.x + outward.x * distance + outward.z * lateral,
      z: door.z + outward.z * distance - outward.x * lateral,
      halfW, halfD
    };
    if (!onLot(site) || blockers.some((blocker) => blocker.active !== false &&
      Math.abs(site.x - blocker.x) < halfW + blocker.halfW + 0.48 &&
      Math.abs(site.z - blocker.z) < halfD + blocker.halfD + 0.48)) continue;
    if (approach.some((point, i) => i > 0 && hitsSolid(approach[i - 1], point, site, 1.12))) continue;
    return site;
  }
}

/** Bounded visibility graph around nearby solid corners, in walking coordinates. */
export function walkPath(from: WalkPoint, to: WalkPoint, solids: readonly WalkSolid[], onSurface?: Surface): WalkPoint[] | null {
  const clear = (a: WalkPoint, b: WalkPoint): boolean => {
    if (solids.some((solid) => intersectsWalker(a.x, a.z, solid) || intersectsWalker(b.x, b.z, solid))) return false;
    if (sweepWalker(a, b.x - a.x, b.z - a.z, solids)) return false;
    return !onSurface || onSurface(a.x, a.z) && clearSurface(a, b, onSurface, 0.4) === 1;
  };
  if (clear(from, to)) return [to];
  const nearby = solids.filter((solid) => hitsSolid(from, to, solid, 9)).slice(0, 18);
  const points = [from, to];
  for (const solid of nearby) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const point = { x: solid.x + sx * (solid.halfW + 0.56), z: solid.z + sz * (solid.halfD + 0.56) };
      if (clear(point, point)) points.push(point);
    }
  }
  const distance = points.map((_, i) => i === 0 ? 0 : Infinity);
  const previous = points.map(() => -1);
  const visited = new Set<number>();
  for (;;) {
    let current = -1;
    for (let i = 0; i < points.length; i++) {
      if (!visited.has(i) && Number.isFinite(distance[i]) && (current < 0 || distance[i] < distance[current])) current = i;
    }
    if (current < 0) return null;
    if (current === 1) {
      const route: WalkPoint[] = [];
      for (let i = current; i > 0; i = previous[i]) route.push(points[i]);
      return route.reverse();
    }
    visited.add(current);
    for (let i = 1; i < points.length; i++) {
      if (visited.has(i)) continue;
      const cost = distance[current] + Math.hypot(points[i].x - points[current].x, points[i].z - points[current].z);
      if (cost < distance[i] && clear(points[current], points[i])) {
        distance[i] = cost;
        previous[i] = current;
      }
    }
  }
}

/** Fraction of a camera boom that clears a swept sphere against world solids. */
export function clearBoom(from: CameraPoint, to: CameraPoint, solids: readonly WalkSolid[], radius: number): number {
  let fraction = 1;
  for (const solid of solids) {
    if (solid.active === false) continue;
    let entry = 0;
    let exit = fraction;
    for (const [start, end, lo, hi] of [
      [from.x, to.x, solid.x - solid.halfW - radius, solid.x + solid.halfW + radius],
      [from.y, to.y, -radius, (solid.height ?? Infinity) + radius],
      [from.z, to.z, solid.z - solid.halfD - radius, solid.z + solid.halfD + radius]
    ]) {
      const delta = end - start;
      if (Math.abs(delta) < 1e-8) {
        if (start < lo || start > hi) {
          entry = 1;
          exit = 0;
          break;
        }
        continue;
      }
      const a = (lo - start) / delta;
      const b = (hi - start) / delta;
      entry = Math.max(entry, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (entry > exit) break;
    }
    if (entry <= exit) fraction = Math.min(fraction, entry);
  }
  return fraction;
}

export function followBoom(previous: number, clearDistance: number, dt: number, snap: boolean): number {
  if (snap || clearDistance <= previous) return clearDistance;
  return previous + (clearDistance - previous) * (1 - Math.exp(-dt * 6));
}

export function avatarVisibleAt(distance: number, wasVisible: boolean): boolean {
  return distance > (wasVisible ? 0.66 : 0.92);
}
