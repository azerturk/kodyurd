import { promises as fs } from "node:fs";
import { createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { parseSpace, type SpaceLayout, type TSpaceDocument } from "@kodyurd/scene-schema";
import archiver from "archiver";
import { overlaysPath, projectDir, spacePath, type ProjectRow } from "./jobs.js";
import { overlayBuilding, type OverlayRecord } from "./overlay-records.js";
import { readAuthoredDiagrams } from "./authored-diagrams.js";
import { buildSpaceLayout, layoutDiagram, refreshCampus, refreshCompactDiagrams, refreshInteriors } from "./space-layout/index.js";
import { cityTitle } from "./space-pipeline.js";
import { tripoCacheGlb } from "./tripo.js";
import { AgentError } from "./agents.js";
import { createSourceReader, markStaleClaimEvidence } from "./source-evidence.js";
import { tryAcquireWorkspaceOperation } from "./workspace-operation.js";
import { installedPackRoles, packAssetPath, packDirectory } from "./asset-registry.js";

/**
 * Static export of the knowledge city: the same walkable world, zero servers.
 * The bundle carries the space document + deterministic layout, the export
 * build of the viewer, ONLY the pack models this city actually uses, and any
 * personal overlay models the user generated. Guide Q&A and source reading
 * stay in the local app — the bundle ships no source code and calls no AI
 * (export parity, honest edition).
 */

export interface ExportResult {
  dir: string;
  zipPath: string;
}

const BUNDLE_README = [
  "Kodyurd — knowledge city bundle",
  "===============================",
  "",
  "This folder is a self-contained walkable knowledge city. No server, no AI,",
  "no Kodyurd install is needed to view it — it is plain static files.",
  "",
  "To view locally:",
  "  npx serve .        (or any static file server)",
  "",
  "Note: opening index.html via file:// will NOT work — browsers block",
  "fetching space.json from disk. Serve the folder over HTTP, or upload it",
  "to any static host (GitHub Pages, Netlify, your own server...).",
  "",
  "Files:",
  "  index.html   — the viewer (third-person character, interiors, tour)",
  "  assets/      — engine + UI bundle",
  "  space.json   — the city (every text is grounded in the source repo",
  "                 or marked pending; nothing is invented)",
  "  models/      — model files used by this city and its visible overlays",
  "",
  "What works offline: walking (manual or tour autopilot), interiors, live",
  "diagrams, scenario replay, the menu, search, the tour, practice, exams,",
  "the city map and relative source locations.",
  "The in-scene guide (Q&A) and source reading need the local Kodyurd app.",
  "Review generated scene text, relative file names and model rights before sharing.",
  "",
  "Made with Kodyurd — turn any codebase into a walkable knowledge city."
].join("\n");

interface AnySpaceDoc {
  city?: { buildings?: { id?: string; archetype?: string }[] };
  presentation?: { start?: { building?: string } };
  diagrams?: { nodes: { icon?: string }[] }[];
  interiors?: unknown[];
}

interface AnySpaceLayout {
  city?: {
    campus?: unknown;
    buildings?: { id?: string; size?: { w?: number; d?: number; h?: number } }[];
    props?: { role?: string }[];
  };
  interiors?: Record<
    string,
    { floors?: { pedestals?: { icon?: string }[] }[] }
  >;
}

const CHARACTER_ROLES = [
  "character-default.anim.idle",
  "character-default.anim.walk",
  "character-default.anim.run",
  "character-default.anim.jump",
  "character-default.rigged",
  "character-default"
];

const CITY_FIXED_ROLES = ["gate-arch", "obelisk-marker", "door-frame"];
const INTERIOR_ROLES = ["reception-desk", "lobby-plant", "sofa", "elevator-doors", "pedestal"];

/** Every pack role this space's geometry can mount (mirrors space-engine.ts). */
export function collectPackRoles(space: AnySpaceDoc, layout: AnySpaceLayout): string[] {
  const roles = new Set<string>([...CITY_FIXED_ROLES, ...CHARACTER_ROLES]);
  const archetypeById = new Map<string, string | undefined>();
  for (const b of space.city?.buildings ?? []) {
    if (b.id) archetypeById.set(b.id, b.archetype);
  }
  for (const lb of layout.city?.buildings ?? []) {
    if (layout.city?.campus) break;
    const { w = Infinity, d = Infinity, h = 10 } = lb.size ?? {};
    const narrowOffice = lb.id !== undefined && lb.id === space.presentation?.start?.building && h >= 16 && Math.max(w, d) / h <= 0.54;
    const archetype = narrowOffice ? "tower" :
      (lb.id ? archetypeById.get(lb.id) : undefined) ?? (h >= 16 ? "tower" : h >= 10 ? "slab" : "low");
    roles.add(`building-${archetype}`);
    if (archetype === "hall" && h <= 10 && Math.min(w, d) >= h * 0.72) roles.add("building-low");
  }
  for (const prop of layout.city?.props ?? []) {
    if (prop.role) roles.add(prop.role);
  }
  for (const diagram of space.diagrams ?? []) {
    for (const node of diagram.nodes) {
      if (node.icon) roles.add(`icon-${node.icon}`);
    }
  }
  const interiors = layout.interiors ?? {};
  if (Object.keys(interiors).length > 0) {
    for (const role of INTERIOR_ROLES) roles.add(role);
    for (const il of Object.values(interiors)) {
      for (const floor of il.floors ?? []) {
        for (const ped of floor.pedestals ?? []) {
          if (ped.icon) roles.add(`icon-${ped.icon}`);
        }
      }
    }
  }
  return [...roles].sort();
}

/** Read current or legacy Scene JSON and derive geometry when no current layout was stored. */
export async function readSavedSpace(
  dataDir: string,
  projectId: string,
  sourceDir?: string
): Promise<{ space: TSpaceDocument; layout: SpaceLayout }> {
  return readSavedSpaceFile(spacePath(dataDir, projectId), sourceDir);
}

export async function readSavedSpaceFile(file: string, sourceDir?: string): Promise<{ space: TSpaceDocument; layout: SpaceLayout }> {
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
  if (!sourceDir) return { space, layout };

  const read = createSourceReader(sourceDir);
  await markStaleClaimEvidence(space, read);
  const authored = await readAuthoredDiagrams(space, read);
  if (!authored.length) return { space, layout };

  // This supplement is assembled on read for the local viewer and explicit export.
  // The accepted space and its saved coverage stay intact.
  space.diagrams.push(...authored);
  const diagrams = { ...layout.diagrams };
  for (const diagram of authored) {
    diagrams[diagram.id] = layoutDiagram(diagram);
    if (space.navigation.searchIndex.length < 2000) {
      space.navigation.searchIndex.push({ label: diagram.title, kind: "diagram", ref: diagram.id,
        keywords: ["authored", "mermaid", diagram.kind], sourcePath: diagram.source?.path });
    }
  }
  return { space, layout: { ...layout, diagrams } };
}

export async function buildSpaceExport(
  dataDir: string,
  project: ProjectRow,
  uiDist: string | undefined
): Promise<ExportResult> {
  if (!existsSync(spacePath(dataDir, project.id))) {
    throw new Error("Knowledge city not generated yet — build it first.");
  }
  if (!uiDist || !existsSync(path.join(uiDist, "export.html"))) {
    throw new Error("UI build is missing export.html — run `npm run build` and restart.");
  }

  const dir = projectDir(dataDir, project.id);
  const release = tryAcquireWorkspaceOperation(project.id);
  if (!release) throw new AgentError("WORKSPACE_BUSY", "This workspace has an active operation. Wait before exporting.");
  let staging: string | undefined;
  try {
    const payload = await readSavedSpace(dataDir, project.id, project.source_dir);
    staging = await fs.mkdtemp(path.join(dir, "export-"));
    const outDir = path.join(staging, "bundle");
    await fs.mkdir(outDir);
    await writeBundle(dataDir, project.id, uiDist, outDir, payload);

    const stagingZip = path.join(staging, "bundle.zip");
    const archive = archiver("zip", { zlib: { level: 6 } });
    const writing = pipeline(archive, createWriteStream(stagingZip));
    archive.directory(outDir, false);
    await Promise.all([archive.finalize(), writing]);

    const publishedDir = path.join(dir, "export");
    await fs.rm(publishedDir, { recursive: true, force: true });
    await fs.rename(outDir, publishedDir);
    const zipPath = exportZipPath(dataDir, project.id);
    await fs.rename(stagingZip, zipPath);
    return { dir: publishedDir, zipPath };
  } finally {
    if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    release();
  }
}

async function writeBundle(
  dataDir: string,
  projectId: string,
  uiDist: string,
  outDir: string,
  payload: Awaited<ReturnType<typeof readSavedSpace>>
): Promise<void> {
  // export.html becomes the bundle's index.html
  await fs.copyFile(path.join(uiDist, "export.html"), path.join(outDir, "index.html"));

  // Copy the built assets (shared chunks include the engine).
  const assetsSrc = path.join(uiDist, "assets");
  if (existsSync(assetsSrc)) {
    await fs.cp(assetsSrc, path.join(outDir, "assets"), { recursive: true });
  }

  const modelsDir = path.join(outDir, "models");
  await fs.mkdir(modelsDir, { recursive: true });

  // Copy ONLY the pack models this city uses.
  const packDir = packDirectory();
  const packRoles: string[] = [];
  if (packDir) {
    const installed = new Set(installedPackRoles(packDir));
    const wanted = collectPackRoles(payload.space, payload.layout);
    for (const role of wanted) {
      if (!installed.has(role)) continue;
      const src = packAssetPath(packDir, role);
      if (!src) continue;
      await fs.copyFile(src, path.join(modelsDir, `${role}.glb`));
      packRoles.push(role);
    }
  }

  // Personal overlays (generated with the user's key) travel with the bundle.
  const overlaysOut: { building: string; class: string; url: string }[] = [];
  try {
    const rawOverlays = JSON.parse(await fs.readFile(overlaysPath(dataDir, projectId), "utf8")) as {
      items?: OverlayRecord[];
    };
    for (const it of rawOverlays.items ?? []) {
      if (it.hidden || !/^[a-f0-9]{16,64}$/.test(it.id)) continue;
      const building = overlayBuilding(it, payload.space.city.buildings);
      if (!building) continue;
      const src = tripoCacheGlb(dataDir, it.id);
      if (!existsSync(src)) continue;
      const name = `overlay-${it.id}.glb`;
      await fs.copyFile(src, path.join(modelsDir, name));
      overlaysOut.push({ building, class: it.class, url: `models/${name}` });
    }
  } catch {
    /* no overlays */
  }

  const portableSpace = { ...payload.space, meta: { ...payload.space.meta, sourceDir: "." } };
  await fs.writeFile(
    path.join(outDir, "space.json"),
    JSON.stringify({ space: portableSpace, layout: payload.layout, packRoles, overlays: overlaysOut })
  );
  await fs.writeFile(path.join(outDir, "README.txt"), BUNDLE_README);
}

export function exportZipPath(dataDir: string, projectId: string): string {
  return path.join(projectDir(dataDir, projectId), "export.zip");
}
