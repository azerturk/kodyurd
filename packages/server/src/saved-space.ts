import { promises as fs } from "node:fs";
import { parseSpace, type SpaceLayout, type TSpaceDocument } from "@kodyurd/scene-schema";
import { readAuthoredDiagrams } from "./authored-diagrams.js";
import { applyDiagramEdits, diagramEditStatuses, readDiagramEditStore, type DiagramEditStatus, type DiagramEditStore } from "./diagram-edits.js";
import { spacePath } from "./project-files.js";
import { createSourceReader, markStaleClaimEvidence } from "./source-evidence.js";
import { buildSpaceLayout, layoutDiagram, refreshCampus, refreshCompactDiagrams, refreshInteriors } from "./space-layout/index.js";
import { cityTitle } from "./space-pipeline.js";

interface SavedSpace {
  space: TSpaceDocument;
  layout: SpaceLayout;
  diagramEdits?: DiagramEditStatus[];
}

/** The published city, including authored diagrams and the user's corrections. */
export async function readSavedSpace(dataDir: string, projectId: string, sourceDir?: string): Promise<SavedSpace> {
  return readSpaceFile(spacePath(dataDir, projectId), sourceDir, await readDiagramEditStore(dataDir, projectId));
}

/** A generated file or draft, with authored diagrams but without workspace-wide corrections. */
export async function readSavedSpaceFile(file: string, sourceDir?: string): Promise<SavedSpace> {
  return readSpaceFile(file, sourceDir);
}

async function readSpaceFile(file: string, sourceDir?: string, edits?: DiagramEditStore): Promise<SavedSpace> {
  const raw: unknown = JSON.parse(await fs.readFile(file, "utf8"));
  const saved = typeof raw === "object" && raw !== null && "space" in raw
    ? raw as { space: unknown; layout?: SpaceLayout }
    : { space: raw };
  const parsed = parseSpace(saved.space);
  if (!parsed.success) throw new Error("The saved city is invalid.");
  const space = parsed.data;
  for (const building of space.city.buildings) building.title = cityTitle(building.id, building.title, "b-", building.moduleRef);
  for (const district of space.city.districts) district.title = cityTitle(district.id, district.title, "d-");
  const layout = !parsed.upgradedFrom && saved.layout?.city
    ? refreshInteriors(space, refreshCampus(space, refreshCompactDiagrams(space, saved.layout)))
    : buildSpaceLayout(space);
  const read = sourceDir ? createSourceReader(sourceDir) : undefined;
  let payload: SavedSpace = { space, layout };
  if (read) {
    const authored = await readAuthoredDiagrams(space, read);
    if (authored.length) {
      const diagrams = { ...layout.diagrams };
      for (const diagram of authored) {
        space.diagrams.push(diagram);
        diagrams[diagram.id] = layoutDiagram(diagram);
        if (space.navigation.searchIndex.length < 2000) {
          space.navigation.searchIndex.push({ label: diagram.title, kind: "diagram", ref: diagram.id,
            keywords: ["authored", "mermaid", diagram.kind], sourcePath: diagram.source?.path });
        }
      }
      payload = { space, layout: { ...layout, diagrams } };
    }
  }
  if (edits?.diagrams.length) {
    const diagramEdits = diagramEditStatuses(payload.space, edits);
    payload = { ...applyDiagramEdits(payload, edits.diagrams), diagramEdits };
  }
  // Check the final composition: a saved correction must not restore an old fresh flag.
  if (read) await markStaleClaimEvidence(payload.space, read);
  return payload;
}
