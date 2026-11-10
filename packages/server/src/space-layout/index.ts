import type { TSpaceDocument, SpaceLayout, DiagramLayout, InteriorLayout } from "@kodyurd/scene-schema";
import { layoutCity, usesCampusLayout } from "./city.js";
import { layoutDiagram, usesCompactGraphLayout } from "./diagram.js";
import { layoutInterior } from "./interior.js";

/**
 * P3 — build the full deterministic layout for a Space (D5: geometry is
 * code's responsibility). Pure function: same document in, same layout out.
 */
export function buildSpaceLayout(space: TSpaceDocument): SpaceLayout {
  const diagrams: Record<string, DiagramLayout> = {};
  for (const d of space.diagrams) diagrams[d.id] = layoutDiagram(d);

  return { city: layoutCity(space), interiors: layoutsForInteriors(space), diagrams };
}

function layoutsForInteriors(space: TSpaceDocument): Record<string, InteriorLayout> {
  return Object.fromEntries(space.interiors.map((interior) => [interior.building, layoutInterior(interior, space.flows)]));
}

/** Deterministic interior navigation upgrades apply to previously saved spaces, too. */
export function refreshInteriors(space: TSpaceDocument, layout: SpaceLayout): SpaceLayout {
  return { ...layout, interiors: layoutsForInteriors(space) };
}

/** Apply updated small-graph geometry to saved spaces without regenerating content. */
export function refreshCompactDiagrams(space: TSpaceDocument, layout: SpaceLayout): SpaceLayout {
  const compact = space.diagrams.filter(usesCompactGraphLayout);
  if (!compact.length) return layout;
  const diagrams = { ...layout.diagrams };
  for (const diagram of compact) diagrams[diagram.id] = layoutDiagram(diagram);
  return { ...layout, diagrams };
}

/** Upgrade generated courtyard geometry while preserving saved lesson data. */
export function refreshCampus(space: TSpaceDocument, layout: SpaceLayout): SpaceLayout {
  return !layout.city.campus && usesCampusLayout(space) ? { ...layout, city: layoutCity(space) } : layout;
}

export { layoutCity, layoutDiagram, layoutInterior };
