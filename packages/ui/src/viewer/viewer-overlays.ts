/** The building directory and proximity actions share one world-HUD slot. */
export function worldHudPanel(directory: boolean, nearby: boolean, actionable: boolean, pinned: boolean): "directory" | "nearby" | undefined {
  if (directory && (!nearby || pinned || !actionable)) return "directory";
  return nearby ? "nearby" : undefined;
}
