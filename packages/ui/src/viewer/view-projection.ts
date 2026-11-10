export interface Position3 {
  x: number;
  y: number;
  z: number;
}

export interface ViewInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ViewRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Keep a label near its anchor while leaving model silhouettes and accepted labels uncovered. */
export function placeWorldLabel(
  x: number, y: number, halfWidth: number, height: number, viewport: ViewRect,
  protectedRects: readonly ViewRect[], anchorModel?: ViewRect
): { x: number; y: number; rect: ViewRect } | undefined {
  const gap = 7;
  const candidates = anchorModel ? [
    [x, anchorModel.top - gap],
    [anchorModel.right + halfWidth + gap, y + height / 2],
    [anchorModel.left - halfWidth - gap, y + height / 2],
    [x, anchorModel.bottom + gap + height]
  ] : [[x, y - gap], [x, y + height + gap], [x, y - height - gap]];
  for (const [cx, bottom] of candidates) {
    const left = cx - halfWidth;
    const right = cx + halfWidth;
    const top = bottom - height;
    if (left < viewport.left || right > viewport.right || top < viewport.top || bottom > viewport.bottom) continue;
    if (protectedRects.some((rect) => left < rect.right + 3 && right > rect.left - 3 && top < rect.bottom + 3 && bottom > rect.top - 3)) continue;
    return { x: cx, y: bottom, rect: { left, right, top, bottom } };
  }
  return undefined;
}

export function viewRect(width: number, height: number, insets: ViewInsets, padding = 0): ViewRect {
  const axis = (start: number, end: number, size: number, min: number): [number, number] => {
    const first = Math.max(0, Number.isFinite(start) ? start : 0) + padding;
    const last = Math.max(0, Number.isFinite(end) ? end : 0) + padding;
    const scale = Math.min(1, size * (1 - min) / Math.max(1, first + last));
    return [first * scale, size - last * scale];
  };
  const [left, right] = axis(insets.left, insets.right, width, 0.45);
  const [top, bottom] = axis(insets.top, insets.bottom, height, 0.42);
  return { left, right, top, bottom };
}

function cameraAxes(yaw: number, pitch: number): { right: Position3; up: Position3; back: Position3 } {
  const x = Math.sin(yaw);
  const z = Math.cos(yaw);
  const sin = Math.sin(pitch);
  const cos = Math.cos(pitch);
  return {
    right: { x: z, y: 0, z: -x },
    up: { x: -x * sin, y: cos, z: -z * sin },
    back: { x: x * cos, y: sin, z: z * cos }
  };
}

const dot = (a: Position3, b: Position3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** Half-height and target that fit stage-local geometry in the unobstructed canvas. */
export function fitOrthographic(
  points: readonly Position3[], width: number, height: number, rect: ViewRect, yaw: number, pitch: number, zoom = 1
): { target: Position3; halfHeight: number; back: Position3; distance: number } {
  const { right, up, back } = cameraAxes(yaw, pitch);
  let left = Infinity;
  let rightmost = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  let far = Infinity;
  let near = -Infinity;
  for (const point of points) {
    const x = dot(point, right);
    const y = dot(point, up);
    left = Math.min(left, x);
    rightmost = Math.max(rightmost, x);
    bottom = Math.min(bottom, y);
    top = Math.max(top, y);
    const z = dot(point, back);
    far = Math.min(far, z);
    near = Math.max(near, z);
  }
  const halfHeight = zoom * Math.max(4.2,
    (rightmost - left) * height / (2 * (rect.right - rect.left)),
    (top - bottom) * height / (2 * (rect.bottom - rect.top))
  );
  const centerX = (left + rightmost) / 2 - (rect.left + rect.right - width) * halfHeight / height;
  const centerY = (bottom + top) / 2 + (rect.top + rect.bottom - height) * halfHeight / height;
  const centerZ = (near + far) / 2;
  return {
    target: {
      x: right.x * centerX + up.x * centerY + back.x * centerZ,
      y: up.y * centerY + back.y * centerZ,
      z: right.z * centerX + up.z * centerY + back.z * centerZ
    },
    halfHeight,
    back,
    distance: Math.max(30, (near - far) / 2 + 18)
  };
}

/** Perspective camera fit for points relative to the entrance in a fixed viewing direction. */
export function fitArrivalView(
  points: readonly Position3[], width: number, height: number, rect: ViewRect, yaw: number, pitch: number, fov: number
): { position: Position3; back: Position3 } {
  const { right, up, back } = cameraAxes(yaw, pitch);
  const tanY = Math.tan(fov * Math.PI / 360);
  const tanX = tanY * width / height;
  const lowX = (2 * rect.left / width - 1) * tanX;
  const highX = (2 * rect.right / width - 1) * tanX;
  const lowY = (1 - 2 * rect.bottom / height) * tanY;
  const highY = (1 - 2 * rect.top / height) * tanY;
  let left = -Infinity;
  let rightmost = Infinity;
  let bottom = -Infinity;
  let top = Infinity;
  let closest = -Infinity;
  for (const point of points) {
    const x = dot(point, right);
    const y = dot(point, up);
    const z = dot(point, back);
    left = Math.max(left, x + highX * z);
    rightmost = Math.min(rightmost, x + lowX * z);
    bottom = Math.max(bottom, y + highY * z);
    top = Math.min(top, y + lowY * z);
    closest = Math.max(closest, z);
  }
  const distance = Math.max(closest + 4.2, (left - rightmost) / (highX - lowX), (bottom - top) / (highY - lowY));
  const x = (left + rightmost - (highX + lowX) * distance) / 2;
  const y = (bottom + top - (highY + lowY) * distance) / 2;
  return {
    position: { x: right.x * x + up.x * y + back.x * distance, y: up.y * y + back.y * distance, z: right.z * x + up.z * y + back.z * distance },
    back
  };
}

/** Frame the avatar and entrance without looking through a foreground solid. */
export function fitClearArrivalView(options: {
  points: readonly Position3[];
  width: number;
  height: number;
  rect: ViewRect;
  yaws: readonly number[];
  fov: number;
  avatar: Position3;
  entrance: Position3;
  canSee: (from: Position3, to: Position3) => boolean;
}): ReturnType<typeof fitArrivalView> | undefined {
  const { points, width, height, rect, yaws, fov, avatar, entrance, canSee } = options;
  let best: ReturnType<typeof fitArrivalView> | undefined;
  let bestCost = Infinity;
  const shoulderWeight = yaws.length > 1 ? 1.65 : 0.44;
  for (const yaw of yaws) for (const pitch of [-0.42, -0.36, -0.3, -0.2, -0.1, 0, 0.12]) {
    const fit = fitArrivalView(points, width, height, rect, yaw, pitch, fov);
    const { position } = fit;
    if (position.y < 1.25 || !canSee(avatar, position) || !canSee(entrance, position)) continue;
    const distance = Math.hypot(position.x - avatar.x, position.z - avatar.z);
    const cost = distance + Math.abs(position.y - 2.2) * shoulderWeight + Math.abs(yaw - yaws[0]) * 1.7;
    if (cost >= bestCost) continue;
    best = fit;
    bestCost = cost;
  }
  return best;
}

/** Screen x/y from PlayCanvas are CSS pixels. Its screen z is clip-space. */
export function labelPosition(
  position: Position3,
  camera: Position3,
  forward: Position3,
  near: number,
  far: number,
  cssWidth: number,
  cssHeight: number,
  screen: Pick<Position3, "x" | "y">
): { xPct: number; yPct: number } | null {
  const depth = (position.x - camera.x) * forward.x + (position.y - camera.y) * forward.y + (position.z - camera.z) * forward.z;
  if (depth < near || depth > far || !Number.isFinite(depth) || cssWidth <= 0 || cssHeight <= 0) return null;
  if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y) || screen.x < 0 || screen.x > cssWidth || screen.y < 0 || screen.y > cssHeight) return null;
  return { xPct: 100 * screen.x / cssWidth, yPct: 100 * screen.y / cssHeight };
}

export function distanceToSegment(x: number, y: number, from: Pick<Position3, "x" | "y">, to: Pick<Position3, "x" | "y">): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const t = Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / Math.max(0.001, dx * dx + dy * dy)));
  return Math.hypot(x - from.x - dx * t, y - from.y - dy * t);
}
