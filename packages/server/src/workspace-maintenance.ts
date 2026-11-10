import { promises as fs } from "node:fs";
import path from "node:path";
import { AgentError } from "./agents.js";
import type { SqliteDb } from "./db.js";
import type { ProjectRow } from "./jobs.js";

const PROJECT_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

async function directoryExists(dir: string): Promise<boolean> {
  const stat = await fs.lstat(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return false;
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new AgentError("WORKSPACE_STORAGE", "Workspace storage is not an app-owned directory.");
  }
  return true;
}

async function storagePaths(dataDir: string, projectId: string) {
  if (!PROJECT_ID.test(projectId)) {
    throw new AgentError("WORKSPACE_STORAGE", "Workspace storage identity is invalid.");
  }
  const root = await fs.realpath(dataDir);
  const parent = path.join(root, "projects");
  if (await directoryExists(parent) && path.relative(root, await fs.realpath(parent)) !== "projects") {
    throw new AgentError("WORKSPACE_STORAGE", "Workspace storage is outside the local application folder.");
  }
  return {
    dir: path.join(parent, projectId),
    quarantine: path.join(parent, `.removing-${projectId}`)
  };
}

function inside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function assertOutsideSource(dir: string, project: ProjectRow): Promise<void> {
  const source = await fs.realpath(project.source_dir).catch(() => path.resolve(project.source_dir));
  if (inside(dir, source)) {
    throw new AgentError("WORKSPACE_STORAGE", "The selected source overlaps this workspace's generated storage.");
  }
}

export async function clearWorkspaceCache(dataDir: string, project: ProjectRow): Promise<void> {
  const { dir } = await storagePaths(dataDir, project.id);
  await assertOutsideSource(dir, project);
  if (!await directoryExists(dir)) return;
  const cache = path.join(dir, "cache");
  const hasCache = await directoryExists(cache);
  await fs.rm(path.join(dir, "analysis.json"), { force: true });
  if (hasCache) await fs.rm(cache, { recursive: true, force: true, maxRetries: 2 });
}

function forgetRemoval(db: SqliteDb, projectId: string): void {
  db.prepare("DELETE FROM workspace_removals WHERE project_id = ?").run(projectId);
}

/** Recover an interrupted move without deleting any live workspace's data. */
export async function recoverWorkspaceRemovals(db: SqliteDb, dataDir: string): Promise<void> {
  const pending = db.prepare("SELECT project_id FROM workspace_removals").all() as { project_id: string }[];
  for (const { project_id: projectId } of pending) {
    try {
      const { dir, quarantine } = await storagePaths(dataDir, projectId);
      const project = db.prepare("SELECT source_dir FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
      const moved = await directoryExists(quarantine);
      if (moved && project) {
        await assertOutsideSource(quarantine, project);
        if (await directoryExists(dir)) continue;
        await fs.rename(quarantine, dir);
      } else if (moved) {
        await fs.rm(quarantine, { recursive: true, force: true, maxRetries: 2 });
      }
      forgetRemoval(db, projectId);
    } catch {
      /* Keep the recovery record if a local filesystem operation can be retried. */
    }
  }
}

export async function removeWorkspace(
  db: SqliteDb,
  dataDir: string,
  project: ProjectRow
): Promise<{ cleanupPending?: boolean }> {
  const { dir, quarantine } = await storagePaths(dataDir, project.id);
  await assertOutsideSource(dir, project);
  await assertOutsideSource(quarantine, project);
  if (await directoryExists(quarantine)) {
    throw new AgentError("WORKSPACE_STORAGE", "Restart Kodyurd to recover this workspace before removing it again.");
  }
  const hasDir = await directoryExists(dir);
  db.prepare("INSERT OR IGNORE INTO workspace_removals (project_id) VALUES (?)").run(project.id);
  try {
    if (hasDir) await fs.rename(dir, quarantine);
  } catch (error) {
    forgetRemoval(db, project.id);
    throw error;
  }
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM project_generation WHERE project_id = ?").run(project.id);
      db.prepare("DELETE FROM jobs WHERE project_id = ?").run(project.id);
      db.prepare("DELETE FROM projects WHERE id = ?").run(project.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    if (hasDir) await fs.rename(quarantine, dir);
    forgetRemoval(db, project.id);
    throw error;
  }
  try {
    if (hasDir) await fs.rm(quarantine, { recursive: true, force: true, maxRetries: 2 });
    forgetRemoval(db, project.id);
    return {};
  } catch {
    return { cleanupPending: true };
  }
}
