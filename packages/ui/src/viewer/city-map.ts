/** Shared ground and legend colors, assigned in the deterministic district order. */
const DISTRICT_STYLES = [
  { ground: "#bad7d2", border: "#39766e" },
  { ground: "#d8c8a3", border: "#8a642f" },
  { ground: "#bbcfe2", border: "#426d98" },
  { ground: "#d5c4dc", border: "#80558f" },
  { ground: "#c6d6ae", border: "#5e7839" },
  { ground: "#dfc3b8", border: "#945a48" }
] as const;

export function districtStyle(index: number): { ground: string; border: string } {
  return DISTRICT_STYLES[Math.max(0, Math.floor(index)) % DISTRICT_STYLES.length];
}

/** A single fallback district should identify the workspace, rather than label its buildings "City". */
export function mapDistrictTitle(title: string, workspaceName: string, districtCount: number): string {
  return districtCount === 1 && /^(?:city|main|workspace)$/i.test(title.trim()) ? `${workspaceName} modules` : title;
}
