import { lstatSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const requireModule = createRequire(import.meta.url);
export const modelRolePattern = /^[a-z0-9][a-z0-9.-]{0,80}$/;

export function packDirectory(): string | undefined {
  const configured = process.env.KODYURD_MODEL_PACK?.trim();
  if (configured) return path.resolve(configured);
  try {
    return path.dirname(requireModule.resolve("@kodyurd/assets/package.json"));
  } catch {
    return undefined;
  }
}

export function packAssetPath(directory: string, role: string): string | undefined {
  if (!modelRolePattern.test(role)) return undefined;
  const models = path.join(directory, "models");
  const file = path.join(models, `${role}.glb`);
  try {
    if (lstatSync(models).isDirectory() && lstatSync(file).isFile()) return file;
  } catch {
    // Missing assets use procedural geometry.
  }
  return undefined;
}

export function installedPackRoles(directory = packDirectory()): string[] {
  if (!directory) return [];
  try {
    const file = path.join(directory, "manifest.json");
    if (!lstatSync(file).isFile()) return [];
    const manifest = JSON.parse(readFileSync(file, "utf8")) as { schemaVersion?: unknown; assets?: unknown };
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets)) return [];
    const roles = manifest.assets.slice(0, 240).flatMap((entry): string[] => {
      const role = entry?.role;
      return typeof role === "string" && packAssetPath(directory, role) ? [role] : [];
    });
    return [...new Set(roles)];
  } catch {
    return [];
  }
}
