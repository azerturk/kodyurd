import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const allowedFiles = {
  city: "05-08-city-and-navigation.png",
  lesson: "09-12-diagrams-and-replay.png"
} as const;

export type SceneReferenceRole = keyof typeof allowedFiles;

export interface SceneReference {
  id: string;
  version: number;
  sha256: string;
  file: string;
  bytes: Buffer;
}

const manifestSchema = z.object({
  version: z.literal(1),
  references: z.array(z.object({
    id: z.string().min(1).max(48),
    role: z.enum(["city", "lesson"]),
    file: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/)
  })).length(2)
});

const referenceRoot = new URL("../scene-references/", import.meta.url);

export async function loadSceneReference(role: SceneReferenceRole): Promise<SceneReference | undefined> {
  try {
    const manifest = manifestSchema.parse(JSON.parse(await fs.readFile(new URL("manifest.json", referenceRoot), "utf8")));
    const entry = manifest.references.find((item) => item.role === role && item.file === allowedFiles[role]);
    if (!entry) return undefined;
    const url = new URL(allowedFiles[role], referenceRoot);
    const stat = await fs.lstat(url);
    if (!stat.isFile() || stat.size > 3 * 1024 * 1024) return undefined;
    const bytes = await fs.readFile(url);
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!bytes.subarray(0, 8).equals(signature) || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) return undefined;
    return { id: entry.id, version: manifest.version, sha256: entry.sha256, file: fileURLToPath(url), bytes };
  } catch {
    return undefined;
  }
}

export const sceneVisualContract = (role: SceneReferenceRole): string => [
  role === "city"
    ? "Spatial guidance: use a clear focus entrance, legible districts, restrained accents and a distinct overview. Keep walking paths distinct from real technical links."
    : "Spatial guidance: use meaningful component boundaries, explicit participant lanes, directed links, distinct sync/async/response edges, visible decisions and one active replay step. Keep labels concise and cite sources on nodes, links and steps.",
  "An attached reference illustrates spatial hierarchy and emphasis. All labels, relationships and behavior claims must come from the workspace evidence. Return only typed scene data."
].join(" ");
