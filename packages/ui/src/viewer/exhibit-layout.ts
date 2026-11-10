/** An unlit sign face stands clear of the frame and faces its own viewer. */
export function signFaceMount(backingZ: number, backingDepth: number, side: -1 | 1): { z: number; yaw: number } {
  return { z: backingZ + side * (backingDepth / 2 + 0.055), yaw: side === 1 ? 0 : 180 };
}

/** Mount display cards beyond the side-wall passage, including in saved layouts. */
export function workshopExhibits<T extends { pos: { x: number; z: number } }>(
  panels: readonly T[],
  room: { z: number; d: number },
  passageZ: number,
  passageHalfWidth: number
): { panel: T; z: number; width: number }[] {
  const start = Math.max(room.z + 0.6, passageZ + passageHalfWidth + 0.48);
  const available = Math.max(0, room.z + room.d - 0.8 - start);
  return [-1, 1].flatMap((side) => {
    const wall = panels.filter((panel) => (panel.pos.x < 0 ? -1 : 1) === side);
    const slot = Math.min(5.75, available / Math.max(1, wall.length));
    if (slot < 0.85) return [];
    return wall.map((panel, index) => ({
      panel,
      z: start + slot * (index + 0.5),
      width: Math.min(5.15, slot - 0.34)
    }));
  });
}

/** Wrap complete display copy, including a source identifier wider than one line. */
export function wrapDisplayCopy(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const character of word) {
      if (line && measure(line + character) > width) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function fitDisplayCopy(
  text: string, width: number, height: number, preferredSize: number, measure: (text: string, size: number) => number
): { lines: string[]; size: number; leading: number } {
  let size = Math.max(1, Math.floor(preferredSize));
  while (size > 1) {
    const lines = wrapDisplayCopy(text, width, (value) => measure(value, size));
    const leading = size * 1.2;
    if (leading * lines.length <= height) return { lines, size, leading };
    size--;
  }
  return { lines: wrapDisplayCopy(text, width, (value) => measure(value, size)), size, leading: size * 1.2 };
}
